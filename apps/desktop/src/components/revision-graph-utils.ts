import type { Revision } from "@/tauri-commands";

export function reorderForGraph(revisions: Revision[]): Revision[] {
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

	// Priority score for a revision (lower = higher priority)
	function getPriority(rev: Revision): number {
		if (rev.is_working_copy) return 0;
		if (rev.is_mine && !rev.is_immutable) return 1;
		if (rev.bookmarks.length > 0 && !rev.is_immutable) return 2;
		if (!rev.is_immutable) return 3;
		if (rev.bookmarks.length > 0) return 4;
		return 5;
	}

	// Find heads and sort by priority
	const heads = revisions
		.filter((r) => {
			const children = childrenMap.get(r.commit_id) ?? [];
			return children.filter((c) => commitIds.has(c)).length === 0;
		})
		.sort((a, b) => getPriority(a) - getPriority(b));

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
