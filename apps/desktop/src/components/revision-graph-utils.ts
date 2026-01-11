import type { Revision } from "@/tauri-commands";

/** Recency map: commit_id (hex) -> timestamp_millis when last WC */
export type CommitRecency = Record<string, number>;

/**
 * Ancestry information for a revision within the visible revset.
 * Used to determine graph edges and lane allocation.
 */
export interface RevisionAncestry {
	/** commit_id -> Set of ancestor commit_ids within the visible revset */
	ancestors: Map<string, Set<string>>;
	/** commit_id -> Set of descendant commit_ids within the visible revset */
	descendants: Map<string, Set<string>>;
	/** commit_id -> direct parent commit_ids within the visible revset */
	parents: Map<string, string[]>;
	/** commit_id -> direct child commit_ids within the visible revset */
	children: Map<string, string[]>;
}

/**
 * Computes ancestor/descendant relationships for all revisions within the visible revset.
 * This is used to determine which revisions are actually related and should be connected by edges.
 */
export function computeRevisionAncestry(revisions: Revision[]): RevisionAncestry {
	if (revisions.length === 0) {
		return {
			ancestors: new Map(),
			descendants: new Map(),
			parents: new Map(),
			children: new Map(),
		};
	}

	const commitIds = new Set(revisions.map((r) => r.commit_id));
	
	// Build direct parent/child relationships (only within visible revset)
	const parents = new Map<string, string[]>();
	const children = new Map<string, string[]>();
	
	for (const rev of revisions) {
		const visibleParents: string[] = [];
		for (const edge of rev.parent_edges) {
			// Only consider non-missing edges where parent is in visible set
			if (edge.edge_type === "missing") continue;
			if (!commitIds.has(edge.parent_id)) continue;
			visibleParents.push(edge.parent_id);
			
			// Build children map
			const parentChildren = children.get(edge.parent_id) ?? [];
			parentChildren.push(rev.commit_id);
			children.set(edge.parent_id, parentChildren);
		}
		parents.set(rev.commit_id, visibleParents);
	}
	
	// Ensure all commits have entries even if they have no children/parents
	for (const rev of revisions) {
		if (!children.has(rev.commit_id)) {
			children.set(rev.commit_id, []);
		}
	}

	// Compute transitive ancestors for each commit using BFS
	const ancestors = new Map<string, Set<string>>();
	for (const rev of revisions) {
		const ancestorSet = new Set<string>();
		const queue = [...(parents.get(rev.commit_id) ?? [])];
		
		while (queue.length > 0) {
			const parentId = queue.shift()!;
			if (ancestorSet.has(parentId)) continue;
			ancestorSet.add(parentId);
			queue.push(...(parents.get(parentId) ?? []));
		}
		
		ancestors.set(rev.commit_id, ancestorSet);
	}

	// Compute transitive descendants for each commit using BFS
	const descendants = new Map<string, Set<string>>();
	for (const rev of revisions) {
		const descendantSet = new Set<string>();
		const queue = [...(children.get(rev.commit_id) ?? [])];
		
		while (queue.length > 0) {
			const childId = queue.shift()!;
			if (descendantSet.has(childId)) continue;
			descendantSet.add(childId);
			queue.push(...(children.get(childId) ?? []));
		}
		
		descendants.set(rev.commit_id, descendantSet);
	}

	return { ancestors, descendants, parents, children };
}

/**
 * Checks if two revisions are related (one is ancestor/descendant of the other).
 */
export function areRevisionsRelated(
	commitIdA: string,
	commitIdB: string,
	ancestry: RevisionAncestry,
): boolean {
	if (commitIdA === commitIdB) return true;
	const ancestorsA = ancestry.ancestors.get(commitIdA);
	const ancestorsB = ancestry.ancestors.get(commitIdB);
	if (ancestorsA?.has(commitIdB)) return true;
	if (ancestorsB?.has(commitIdA)) return true;
	return false;
}

/**
 * Groups revisions into connected components based on ancestry relationships.
 * Each component contains revisions that are related (share ancestor/descendant relationships).
 */
export function groupIntoConnectedComponents(
	revisions: Revision[],
	ancestry: RevisionAncestry,
): Map<string, string[]> {
	const components = new Map<string, string[]>(); // componentId -> commit_ids
	const commitToComponent = new Map<string, string>();
	
	for (const rev of revisions) {
		if (commitToComponent.has(rev.commit_id)) continue;
		
		// Start a new component with this revision as the root
		const componentId = rev.commit_id;
		const componentMembers: string[] = [];
		const queue = [rev.commit_id];
		
		while (queue.length > 0) {
			const commitId = queue.shift()!;
			if (commitToComponent.has(commitId)) continue;
			
			commitToComponent.set(commitId, componentId);
			componentMembers.push(commitId);
			
			// Add all ancestors and descendants to the component
			const ancestorSet = ancestry.ancestors.get(commitId) ?? new Set();
			const descendantSet = ancestry.descendants.get(commitId) ?? new Set();
			
			for (const ancestorId of ancestorSet) {
				if (!commitToComponent.has(ancestorId)) {
					queue.push(ancestorId);
				}
			}
			for (const descendantId of descendantSet) {
				if (!commitToComponent.has(descendantId)) {
					queue.push(descendantId);
				}
			}
		}
		
		components.set(componentId, componentMembers);
	}
	
	return components;
}

/**
 * A linear stack of revisions that can be collapsed.
 * Stacks are detected when revisions form a linear chain without branches.
 */
export interface RevisionStack {
	/** Unique ID for this stack (based on top revision's change_id) */
	id: string;
	/** All change_ids in this stack, from top (newest) to bottom (oldest) */
	changeIds: string[];
	/** The top revision of the stack (most recent) */
	topChangeId: string;
	/** The bottom revision of the stack (oldest, often has a bookmark) */
	bottomChangeId: string;
	/** Intermediate revisions that can be hidden when collapsed */
	intermediateChangeIds: string[];
}

/**
 * Detects linear stacks in the revision graph.
 * A stack is a linear sequence where:
 * - Each revision has exactly one "linear" parent in the sequence (a parent with only 1 child)
 * - Merge commits ("merge main into branch") are allowed as intermediates - they have multiple
 *   parents but only one forms the linear chain (the branch parent has 1 child, main has many)
 * - Top revision can have any children (or none)
 * - Bottom revision can have any parents
 * - Minimum 3 revisions to form a collapsible stack (so we have at least 1 hidden)
 */
export function detectStacks(revisions: Revision[]): RevisionStack[] {
	if (revisions.length < 3) return [];

	const commitIds = new Set(revisions.map((r) => r.commit_id));
	const changeIdByCommitId = new Map(revisions.map((r) => [r.commit_id, r.change_id]));
	const revisionByChangeId = new Map(revisions.map((r) => [r.change_id, r]));

	// Build parent/children maps (only for edges within our revset)
	const childrenMap = new Map<string, string[]>(); // commit_id -> child commit_ids
	const parentMap = new Map<string, string[]>(); // commit_id -> parent commit_ids

	for (const rev of revisions) {
		const parents: string[] = [];
		for (const edge of rev.parent_edges) {
			if (edge.edge_type === "missing") continue;
			if (!commitIds.has(edge.parent_id)) continue;
			parents.push(edge.parent_id);
			const children = childrenMap.get(edge.parent_id) ?? [];
			children.push(rev.commit_id);
			childrenMap.set(edge.parent_id, children);
		}
		parentMap.set(rev.commit_id, parents);
	}

	// Check if a revision should NOT be collapsed (needs to stay visible)
	function shouldRemainVisible(rev: Revision): boolean {
		if (rev.is_working_copy) return true;
		if (rev.is_trunk) return true;
		if (rev.bookmarks.length > 0) return true;
		if (rev.is_divergent) return true;
		return false;
	}

	const stacks: RevisionStack[] = [];
	const usedInStack = new Set<string>();

	// Walk through revisions and find stack starts
	for (const rev of revisions) {
		if (usedInStack.has(rev.change_id)) continue;
		if (rev.is_immutable) continue; // Don't collapse immutable commits

		const commitId = rev.commit_id;

		// A stack starts at a revision that:
		// - Is not immutable
		// - Has at least one parent in our view that forms a linear chain
		//   (i.e., that parent has exactly 1 child - this revision)
		// This handles merge commits: we follow the "linear" parent
		const parents = parentMap.get(commitId) ?? [];
		if (parents.length === 0) continue;

		// Find the linear parent (has exactly 1 child - this revision)
		const linearParents = parents.filter((parentId) => {
			const parentChildren = childrenMap.get(parentId) ?? [];
			return parentChildren.length === 1;
		});
		// Need exactly one linear parent to start a chain
		if (linearParents.length !== 1) continue;

		// Walk down the chain to find all linear descendants
		const chain: string[] = [rev.change_id];
		let current = rev;

		while (true) {
			const currentParents = parentMap.get(current.commit_id) ?? [];
			if (currentParents.length === 0) break;

			// Find the "linear" parent - the one that has exactly 1 child (current)
			// This handles merge commits: the branch parent has 1 child, while
			// the "main being merged in" parent typically has multiple children
			let linearParentId: string | null = null;
			for (const parentId of currentParents) {
				const parentChildren = childrenMap.get(parentId) ?? [];
				if (parentChildren.length === 1) {
					if (linearParentId !== null) {
						// Multiple parents with single child - ambiguous, stop
						linearParentId = null;
						break;
					}
					linearParentId = parentId;
				}
			}

			if (!linearParentId) break;

			const parentChangeId = changeIdByCommitId.get(linearParentId);
			if (!parentChangeId) break;

			const parentRev = revisionByChangeId.get(parentChangeId);
			if (!parentRev) break;

			// Stop if parent is immutable
			if (parentRev.is_immutable) break;

			chain.push(parentChangeId);
			current = parentRev;

			// If parent should remain visible and we have enough in chain, stop
			if (shouldRemainVisible(parentRev) && chain.length >= 2) break;
		}

		// Only create stack if we have at least 3 revisions (1+ intermediate)
		if (chain.length >= 3) {
			const topChangeId = chain[0];
			const bottomChangeId = chain[chain.length - 1];
			const intermediateChangeIds = chain.slice(1, -1);

			stacks.push({
				id: topChangeId,
				changeIds: chain,
				topChangeId,
				bottomChangeId,
				intermediateChangeIds,
			});

			for (const changeId of chain) {
				usedInStack.add(changeId);
			}
		}
	}

	return stacks;
}

export function reorderForGraph(
	revisions: Revision[],
	recency?: CommitRecency,
): Revision[] {
	if (revisions.length === 0) return [];

	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));
	const commitIds = new Set(revisions.map((r) => r.commit_id));

	// Build parent/children maps (only for edges within our revset)
	const childrenMap = new Map<string, string[]>();
	const parentMap = new Map<string, string[]>();
	for (const rev of revisions) {
		const parents: string[] = [];
		for (const edge of rev.parent_edges) {
			if (edge.edge_type === "missing") continue;
			if (!commitIds.has(edge.parent_id)) continue;
			parents.push(edge.parent_id);
			const children = childrenMap.get(edge.parent_id) ?? [];
			children.push(rev.commit_id);
			childrenMap.set(edge.parent_id, children);
		}
		parentMap.set(rev.commit_id, parents);
	}

	// Find the head that contains the working copy in its ancestry
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const wcAncestorHeadId = (() => {
		if (!workingCopy) return null;
		// Walk up from WC to find which head contains it
		const visited = new Set<string>();
		const queue = [workingCopy.commit_id];
		while (queue.length > 0) {
			const id = queue.shift()!;
			if (visited.has(id)) continue;
			visited.add(id);
			const children = childrenMap.get(id) ?? [];
			const validChildren = children.filter((c) => commitIds.has(c));
			if (validChildren.length === 0) {
				// This is a head
				return id;
			}
			queue.push(...validChildren);
		}
		return null;
	})();

	// Get max recency for a branch (walk down from head to find most recent touch)
	function getBranchRecency(headCommitId: string): number {
		if (!recency) return 0;
		let maxRecency = recency[headCommitId] ?? 0;
		// Walk ancestors to find any that were touched more recently
		const visited = new Set<string>();
		const queue = [headCommitId];
		while (queue.length > 0) {
			const id = queue.shift()!;
			if (visited.has(id)) continue;
			visited.add(id);
			const ts = recency[id] ?? 0;
			if (ts > maxRecency) maxRecency = ts;
			const parents = parentMap.get(id) ?? [];
			queue.push(...parents);
		}
		return maxRecency;
	}

	// Find heads
	const heads = revisions.filter((r) => {
		const children = childrenMap.get(r.commit_id) ?? [];
		return children.filter((c) => commitIds.has(c)).length === 0;
	});

	// Sort heads: WC's branch first, then by recency (most recent first), then stable tiebreaker
	heads.sort((a, b) => {
		// WC's branch always first
		const aIsWcBranch = a.commit_id === wcAncestorHeadId;
		const bIsWcBranch = b.commit_id === wcAncestorHeadId;
		if (aIsWcBranch && !bIsWcBranch) return -1;
		if (!aIsWcBranch && bIsWcBranch) return 1;

		// Sort by recency (higher timestamp = more recent = should come first)
		if (recency) {
			const aRecency = getBranchRecency(a.commit_id);
			const bRecency = getBranchRecency(b.commit_id);
			if (aRecency !== bRecency) {
				return bRecency - aRecency; // Descending (most recent first)
			}
		}

		// Stable tiebreaker: use change_id
		return a.change_id.localeCompare(b.change_id);
	});

	// Track which commits have been output
	const output = new Set<string>();
	// Track remaining children count for each commit
	const remainingChildren = new Map<string, number>();
	for (const rev of revisions) {
		const children = childrenMap.get(rev.commit_id) ?? [];
		const childCount = children.filter((c) => commitIds.has(c)).length;
		remainingChildren.set(rev.commit_id, childCount);
	}

	const result: Revision[] = [];

	// Process each head's branch using DFS
	// This ensures we exhaust a branch before moving to the next
	function processBranch(startId: string) {
		const stack = [startId];

		while (stack.length > 0) {
			const id = stack[stack.length - 1]; // Peek

			if (output.has(id)) {
				stack.pop();
				continue;
			}

			const remaining = remainingChildren.get(id) ?? 0;
			if (remaining > 0) {
				// This commit still has unprocessed children
				// They must be from other branches - we'll come back to this commit
				stack.pop();
				continue;
			}

			// All children processed, we can output this commit
			output.add(id);
			const rev = commitMap.get(id);
			if (rev) result.push(rev);
			stack.pop();

			// Decrease remaining children count for parents and add to stack
			const parents = parentMap.get(id) ?? [];
			for (const parentId of parents) {
				if (!output.has(parentId)) {
					const newRemaining = (remainingChildren.get(parentId) ?? 1) - 1;
					remainingChildren.set(parentId, newRemaining);
					// Add parent to stack to continue DFS
					stack.push(parentId);
				}
			}
		}
	}

	// Process heads in priority order
	for (const head of heads) {
		if (!output.has(head.commit_id)) {
			processBranch(head.commit_id);
		}
	}

	return result;
}
