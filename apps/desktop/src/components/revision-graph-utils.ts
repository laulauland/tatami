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
			const parentId = queue.shift();
			if (!parentId || ancestorSet.has(parentId)) continue;
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
			const childId = queue.shift();
			if (!childId || descendantSet.has(childId)) continue;
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
			const commitId = queue.shift();
			if (!commitId || commitToComponent.has(commitId)) continue;

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

/**
 * Reorders revisions for optimal graph rendering in a 2-lane layout.
 *
 * The graph uses lane 0 for trunk commits and lane 1 for all feature branches.
 * This creates a challenge: edges from branch commits to their trunk merge-base
 * are drawn as vertical lines in lane 1, then elbows to lane 0. If branches are
 * ordered poorly, these vertical segments can pass through unrelated branch nodes,
 * creating a false visual impression that the branches are connected.
 *
 * ## Algorithm
 *
 * 1. **Identify trunk vs branch commits** using the `is_trunk` flag from backend
 *    (commits in `::trunk()`)
 *
 * 2. **Compute trunk merge-base for each branch** - the first trunk commit
 *    encountered when walking down from the branch head
 *
 * 3. **Sort branches by merge-base position in trunk** - branches connecting to
 *    similar areas of trunk are grouped together. This prevents edge crossings
 *    where a branch with a deep merge-base would have its edge pass through
 *    other branches.
 *
 * 4. **Output branches in sorted order**, each branch fully (head to merge-base)
 *    before moving to the next
 *
 * 5. **Output trunk commits last** in topological order
 *
 * ## Sort Priority
 * - Working copy's branch always first
 * - Then by trunk merge-base position (earlier = first)
 * - Then by recency (most recently touched first)
 * - Then by change_id (stable tiebreaker)
 *
 * @param revisions - All revisions to display
 * @param recency - Optional map of commit_id -> timestamp for recency sorting
 * @returns Reordered revisions for graph rendering
 */
export function reorderForGraph(revisions: Revision[], recency?: CommitRecency): Revision[] {
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

	// Identify trunk commits (is_trunk flag from backend)
	const trunkCommitIds = new Set(revisions.filter((r) => r.is_trunk).map((r) => r.commit_id));

	// Find the head that contains the working copy in its ancestry
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const wcAncestorHeadId = (() => {
		if (!workingCopy) return null;
		// Walk up from WC to find which head contains it
		const visited = new Set<string>();
		const queue = [workingCopy.commit_id];
		while (queue.length > 0) {
			const id = queue.shift();
			if (!id || visited.has(id)) continue;
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
			const id = queue.shift();
			if (!id || visited.has(id)) continue;
			visited.add(id);
			const ts = recency[id] ?? 0;
			if (ts > maxRecency) maxRecency = ts;
			const parents = parentMap.get(id) ?? [];
			queue.push(...parents);
		}
		return maxRecency;
	}

	// Find all branch commits for a head (commits from head down to but not including trunk)
	// Also returns the trunk merge-base (first trunk commit encountered)
	function getBranchCommitsAndMergeBase(headCommitId: string): {
		commits: string[];
		mergeBase: string | null;
	} {
		const branchCommits: string[] = [];
		const visited = new Set<string>();
		const stack = [headCommitId];
		let mergeBase: string | null = null;

		while (stack.length > 0) {
			const id = stack.pop();
			if (!id || visited.has(id)) continue;
			visited.add(id);

			// Stop at trunk commits - record as merge base
			if (trunkCommitIds.has(id)) {
				if (!mergeBase) mergeBase = id;
				continue;
			}

			branchCommits.push(id);

			// Add parents to continue traversal
			const parents = parentMap.get(id) ?? [];
			for (const parentId of parents) {
				if (!visited.has(parentId)) {
					stack.push(parentId);
				}
			}
		}

		return { commits: branchCommits, mergeBase };
	}

	// Wrapper for backward compatibility
	function getBranchCommits(headCommitId: string): string[] {
		return getBranchCommitsAndMergeBase(headCommitId).commits;
	}

	// Find heads (commits with no children in our revset)
	const heads = revisions.filter((r) => {
		const children = childrenMap.get(r.commit_id) ?? [];
		return children.filter((c) => commitIds.has(c)).length === 0;
	});

	// Separate branch heads from trunk heads
	const branchHeads = heads.filter((h) => !trunkCommitIds.has(h.commit_id));

	// First, compute trunk order (topological sort of trunk commits)
	// We need this to sort branches by their merge-base position
	const trunkOrder = new Map<string, number>();
	{
		const trunkCommits = revisions.filter((r) => trunkCommitIds.has(r.commit_id));
		const trunkChildCount = new Map<string, number>();

		for (const rev of trunkCommits) {
			const parents = parentMap.get(rev.commit_id) ?? [];
			for (const parentId of parents) {
				if (trunkCommitIds.has(parentId)) {
					trunkChildCount.set(parentId, (trunkChildCount.get(parentId) ?? 0) + 1);
				}
			}
		}

		// Topological sort
		const ready = trunkCommits.filter((r) => (trunkChildCount.get(r.commit_id) ?? 0) === 0);
		let orderIdx = 0;
		const visited = new Set<string>();

		while (ready.length > 0) {
			const rev = ready.shift();
			if (!rev || visited.has(rev.commit_id)) continue;
			visited.add(rev.commit_id);

			trunkOrder.set(rev.commit_id, orderIdx++);

			const parents = parentMap.get(rev.commit_id) ?? [];
			for (const parentId of parents) {
				if (trunkCommitIds.has(parentId) && !visited.has(parentId)) {
					const newCount = (trunkChildCount.get(parentId) ?? 1) - 1;
					trunkChildCount.set(parentId, newCount);
					if (newCount === 0) {
						const parentRev = commitMap.get(parentId);
						if (parentRev) ready.push(parentRev);
					}
				}
			}
		}
	}

	// Compute merge-base for each branch head
	const branchMergeBase = new Map<string, string | null>();
	for (const head of branchHeads) {
		const { mergeBase } = getBranchCommitsAndMergeBase(head.commit_id);
		branchMergeBase.set(head.commit_id, mergeBase);
	}

	// Sort branch heads by:
	// 1. WC's branch first
	// 2. Trunk merge-base position (branches connecting to same trunk area are grouped)
	// 3. Recency as tiebreaker within same merge-base area
	// 4. Stable tiebreaker: change_id
	branchHeads.sort((a, b) => {
		// WC's branch always first
		const aIsWcBranch = a.commit_id === wcAncestorHeadId;
		const bIsWcBranch = b.commit_id === wcAncestorHeadId;
		if (aIsWcBranch && !bIsWcBranch) return -1;
		if (!aIsWcBranch && bIsWcBranch) return 1;

		// Sort by merge-base position in trunk (earlier merge-base = higher in graph = first)
		const aMergeBase = branchMergeBase.get(a.commit_id);
		const bMergeBase = branchMergeBase.get(b.commit_id);
		const aMergeBaseOrder = aMergeBase ? (trunkOrder.get(aMergeBase) ?? Infinity) : Infinity;
		const bMergeBaseOrder = bMergeBase ? (trunkOrder.get(bMergeBase) ?? Infinity) : Infinity;
		if (aMergeBaseOrder !== bMergeBaseOrder) {
			return aMergeBaseOrder - bMergeBaseOrder; // Ascending (earlier merge-base first)
		}

		// Within same merge-base area, sort by recency (most recent first)
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

	const result: Revision[] = [];
	const output = new Set<string>();

	// Phase 1: Output each branch fully (head to merge-base, excluding trunk)
	// This groups all commits of a branch together
	// Branches are sorted by merge-base position, so branches connecting to similar
	// trunk areas are adjacent, preventing edge crossings
	for (const head of branchHeads) {
		if (output.has(head.commit_id)) continue;

		// Get all commits in this branch
		const branchCommits = getBranchCommits(head.commit_id);

		// Sort branch commits topologically (children before parents)
		// We need to respect the parent-child ordering within the branch
		const branchSet = new Set(branchCommits);
		const branchChildCount = new Map<string, number>();

		for (const id of branchCommits) {
			const parents = parentMap.get(id) ?? [];
			for (const parentId of parents) {
				if (branchSet.has(parentId)) {
					branchChildCount.set(parentId, (branchChildCount.get(parentId) ?? 0) + 1);
				}
			}
		}

		// Topological sort within the branch
		const sorted: string[] = [];
		const ready = branchCommits.filter((id) => (branchChildCount.get(id) ?? 0) === 0);

		while (ready.length > 0) {
			const id = ready.shift();
			if (!id || output.has(id)) continue;

			sorted.push(id);
			output.add(id);

			const parents = parentMap.get(id) ?? [];
			for (const parentId of parents) {
				if (branchSet.has(parentId) && !output.has(parentId)) {
					const newCount = (branchChildCount.get(parentId) ?? 1) - 1;
					branchChildCount.set(parentId, newCount);
					if (newCount === 0) {
						ready.push(parentId);
					}
				}
			}
		}

		// Add sorted branch commits to result
		for (const id of sorted) {
			const rev = commitMap.get(id);
			if (rev) result.push(rev);
		}
	}

	// Phase 2: Output trunk commits (shared ancestors)
	// Sort trunk commits topologically as well
	const trunkCommits = revisions.filter(
		(r) => trunkCommitIds.has(r.commit_id) && !output.has(r.commit_id),
	);

	// Build child counts for trunk commits
	const trunkChildCount = new Map<string, number>();
	for (const rev of trunkCommits) {
		const parents = parentMap.get(rev.commit_id) ?? [];
		for (const parentId of parents) {
			if (trunkCommitIds.has(parentId) && !output.has(parentId)) {
				trunkChildCount.set(parentId, (trunkChildCount.get(parentId) ?? 0) + 1);
			}
		}
	}

	// Start with trunk heads or commits with no unprocessed children
	const trunkReady = trunkCommits.filter((r) => (trunkChildCount.get(r.commit_id) ?? 0) === 0);

	while (trunkReady.length > 0) {
		const rev = trunkReady.shift();
		if (!rev || output.has(rev.commit_id)) continue;

		result.push(rev);
		output.add(rev.commit_id);

		const parents = parentMap.get(rev.commit_id) ?? [];
		for (const parentId of parents) {
			if (trunkCommitIds.has(parentId) && !output.has(parentId)) {
				const newCount = (trunkChildCount.get(parentId) ?? 1) - 1;
				trunkChildCount.set(parentId, newCount);
				if (newCount === 0) {
					const parentRev = commitMap.get(parentId);
					if (parentRev) trunkReady.push(parentRev);
				}
			}
		}
	}

	// Phase 3: Any remaining commits (shouldn't happen, but safety net)
	for (const rev of revisions) {
		if (!output.has(rev.commit_id)) {
			result.push(rev);
			output.add(rev.commit_id);
		}
	}

	return result;
}
