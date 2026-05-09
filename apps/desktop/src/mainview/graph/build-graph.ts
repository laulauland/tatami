import type { RevisionStub as Revision } from "../../../src-electrobun/shared/rpc.ts";
import { MAX_LANES } from "./constants.ts";
import type { EdgeBinding, GraphData, GraphEdgeType, GraphNode, GraphRow } from "./types.ts";
import { buildEdgeIntervalIndex, computeRevisionAncestry, reorderForGraph } from "./utils.ts";

// Get the set of commit IDs in the working copy's ancestor chain (for lane 0)
function getWorkingCopyChain(revisions: Revision[]): Set<string> {
	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const chain = new Set<string>();

	if (workingCopy) {
		const queue = [workingCopy.commit_id];
		while (queue.length > 0) {
			const id = queue.shift();
			if (!id || chain.has(id)) continue;
			chain.add(id);
			const rev = commitMap.get(id);
			if (rev) {
				// Follow first non-missing parent edge for the main chain
				const firstEdge = rev.parent_edges.find((e) => e.edge_type !== "missing");
				if (firstEdge && commitMap.has(firstEdge.parent_id)) {
					queue.push(firstEdge.parent_id);
				}
			}
		}
	}

	return chain;
}

export function buildGraph(revisions: Revision[]): GraphData {
	if (revisions.length === 0) {
		return {
			nodes: [],
			laneCount: 1,
			rows: [],
			edgeBindings: [],
			edgeIntervalIndex: buildEdgeIntervalIndex([], new Map()),
		};
	}

	// Map commit_id -> Revision for ancestry lookups
	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));

	// Compute ancestry relationships within the visible revset
	// This determines which revisions are actually related and should be connected
	const ancestry = computeRevisionAncestry(revisions);

	// Create rows for all revisions (no elision)
	const orderedRevisions = reorderForGraph(revisions);
	const rows: GraphRow[] = orderedRevisions.map((rev) => ({
		revision: rev,
		lane: 0,
		maxLaneOnRow: 0,
	}));

	// Get working copy chain - these commits should all be in lane 0
	const workingCopyChain = getWorkingCopyChain(revisions);

	// Build row index map
	const commitToRow = new Map<string, number>();
	rows.forEach((row, idx) => {
		commitToRow.set(row.revision.commit_id, idx);
	});

	const commitToLane = new Map<string, number>();
	const nodes: GraphNode[] = [];

	// Simple 2-lane system:
	// Lane 0: trunk commits and working copy chain
	// Lane 1: everything else (all feature branches)
	for (const rev of orderedRevisions) {
		const isOnWorkingCopyChain = workingCopyChain.has(rev.commit_id);
		if (rev.is_trunk || isOnWorkingCopyChain) {
			commitToLane.set(rev.commit_id, 0);
		} else {
			commitToLane.set(rev.commit_id, 1);
		}
	}

	// Second pass: build nodes with parent connections
	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
		const row = rows[rowIdx];
		const revision = row.revision;
		const lane = commitToLane.get(revision.commit_id) ?? 0;

		const parentConnections: GraphNode["parentConnections"] = [];

		// Use ancestry.parents which only includes parents within the visible revset
		// This ensures we only draw edges to actual ancestors, not to unrelated revisions
		const visibleParents = ancestry.parents.get(revision.commit_id) ?? [];

		// Also check original parent_edges for edge type info and missing edges
		const parentEdgeMap = new Map(revision.parent_edges.map((e) => [e.parent_id, e]));

		// Detect "main merges into branch" scenario
		const isMerge = visibleParents.length > 1;
		const isMutableCommit = !revision.is_immutable;

		// Process visible parents (ancestors within our revset)
		for (let i = 0; i < visibleParents.length; i++) {
			const parentId = visibleParents[i];
			const parentEdge = parentEdgeMap.get(parentId);
			const edgeType: GraphEdgeType = parentEdge?.edge_type ?? "direct";

			const parentRow = commitToRow.get(parentId);
			if (parentRow === undefined) continue;

			let parentLane = commitToLane.get(parentId);
			if (parentLane === undefined) {
				// This shouldn't happen after first pass, but handle gracefully
				parentLane = lane;
				commitToLane.set(parentId, parentLane);
			}

			// Check if parent is immutable (look up the actual parent revision)
			const parentRev = commitMap.get(parentId);
			const parentIsImmutable = parentRev?.is_immutable ?? false;

			// De-emphasize if: merge commit, mutable commit, immutable parent
			// IMPORTANT: Don't de-emphasize first parent (i === 0) - that's the mainline
			const isDeemphasized = isMerge && isMutableCommit && parentIsImmutable && i > 0;

			parentConnections.push({ parentRow, parentLane, edgeType, isDeemphasized });
		}

		// Handle missing edges (parents outside our revset)
		// Only show stub if we have original parents but no visible parents
		const hasMissingParents = revision.parent_edges.some((e) => e.edge_type === "missing");
		const hasParentsOutsideView = revision.parent_edges.length > visibleParents.length;

		if ((hasMissingParents || hasParentsOutsideView) && parentConnections.length === 0) {
			// All parents are outside the view - show a stub
			parentConnections.push({
				parentRow: rowIdx + 1, // Just one row down for the stub
				parentLane: lane,
				edgeType: "missing",
				isMissingStub: true,
			});
		} else if (hasMissingParents && parentConnections.length > 0) {
			// Some parents are visible, some are missing - add stub for missing ones
			parentConnections.push({
				parentRow: rowIdx + 1,
				parentLane: lane,
				edgeType: "missing",
				isMissingStub: true,
			});
		}

		nodes.push({
			revision,
			row: rowIdx,
			lane,
			parentConnections,
		});
	}

	// Update rows with computed lane info from nodes
	let maxLaneUsed = 0;
	for (const node of nodes) {
		const row = rows[node.row];
		if (row) {
			row.lane = node.lane;
			row.maxLaneOnRow = node.lane; // Initialize with node's lane
		}
		maxLaneUsed = Math.max(maxLaneUsed, node.lane);
	}

	// Calculate maxLaneOnRow using sweep line algorithm O(n log n) instead of O(n³)
	// Collect edge spans as events for efficient processing
	type SpanEvent = { row: number; isStart: boolean; lane: number };
	const events: SpanEvent[] = [];

	for (const node of nodes) {
		for (const conn of node.parentConnections) {
			const nodeRow = node.row;
			const parentRow = conn.parentRow;
			const nodeLane = node.lane;
			const parentLane = conn.parentLane;

			// Cross-lane edge: horizontal segment at node's row uses both lanes
			if (nodeLane !== parentLane) {
				const row = rows[nodeRow];
				if (row) {
					row.maxLaneOnRow = Math.max(row.maxLaneOnRow, nodeLane, parentLane);
				}
			}

			// Vertical segment: create start/end events instead of iterating rows
			const minRow = Math.min(nodeRow, parentRow);
			const maxRow = Math.max(nodeRow, parentRow);
			if (maxRow > minRow + 1) {
				// Edge spans rows [minRow+1, maxRow-1] inclusive
				events.push({ row: minRow + 1, isStart: true, lane: parentLane });
				events.push({ row: maxRow, isStart: false, lane: parentLane });
			}
		}
	}

	// Sort events: by row, with starts before ends at same row
	events.sort((a, b) => a.row - b.row || (a.isStart ? -1 : 1));

	// Sweep through rows, tracking active lane counts
	const laneCounts = new Array(MAX_LANES).fill(0);
	let eventIdx = 0;

	for (let r = 0; r < rows.length; r++) {
		// Process all events at this row
		while (eventIdx < events.length && events[eventIdx].row === r) {
			const { isStart, lane } = events[eventIdx];
			laneCounts[lane] += isStart ? 1 : -1;
			eventIdx++;
		}

		// Find max active lane for this row (check from highest lane down)
		for (let lane = MAX_LANES - 1; lane >= 0; lane--) {
			if (laneCounts[lane] > 0) {
				rows[r].maxLaneOnRow = Math.max(rows[r].maxLaneOnRow, lane);
				break;
			}
		}
	}

	// Ensure global consistency - propagate lane usage through connected sections
	// This handles cases where disconnected branches exist
	const globalMaxLane = maxLaneUsed;
	for (const row of rows) {
		// Ensure every row accounts for at least its own node's lane
		row.maxLaneOnRow = Math.max(row.maxLaneOnRow, row.lane);
	}

	// Generate semantic edge bindings from nodes' parent connections
	const edgeBindings: EdgeBinding[] = [];
	let edgeCounter = 0;

	for (const node of nodes) {
		for (const conn of node.parentConnections) {
			// For missing stubs, use commit_id of source and empty target
			const targetCommitId = conn.isMissingStub
				? ""
				: (rows[conn.parentRow]?.revision.commit_id ?? "");

			edgeBindings.push({
				id: `edge-${node.revision.commit_id}-${edgeCounter++}`,
				sourceRevisionId: node.revision.commit_id,
				targetRevisionId: targetCommitId,
				sourceLane: node.lane,
				targetLane: conn.parentLane,
				edgeType: conn.edgeType,
				isDeemphasized: conn.isDeemphasized,
				isMissingStub: conn.isMissingStub,
			});
		}
	}

	const edgeIntervalIndex = buildEdgeIntervalIndex(edgeBindings, commitToRow);

	return { nodes, laneCount: globalMaxLane + 1, rows, edgeBindings, edgeIntervalIndex };
}
