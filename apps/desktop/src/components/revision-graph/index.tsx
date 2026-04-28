import { useAtom } from "@effect-atom/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Route } from "@/routes/project.$projectId";
import { traceEnd, traceLog, traceStart } from "@/lib/trace";
import {
	debugOverlayEnabledAtom,
	expandedStacksAtom,
	hoveredStackIdAtom,
	aceJumpQueryAtom,
	revisionGraphScrollTopAtom,
} from "@/atoms";
import {
	reorderForGraph,
	detectStacks,
	computeRevisionAncestry,
	type RevisionStack,
} from "@/components/revision-graph-utils";
import { getRevisionKey } from "@/db";
import { useFocusWithin } from "@/hooks/useFocusWithin";
import { usePrefetch } from "@/hooks/useRevisionData";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { useRevisionGraphNavigation } from "@/hooks/useRevisionGraphNavigation";
import type { Revision } from "@/tauri-commands";

import { DebugOverlay } from "./DebugOverlay";
import { EdgeLayer } from "./EdgeLayer";
import { RevisionRow } from "./RevisionRow";
import { ROW_HEIGHT, LANE_WIDTH, LANE_PADDING, NODE_RADIUS, MAX_LANES } from "./constants";
import type { EdgeBinding, GraphNode, GraphRow, GraphData, GraphEdgeType } from "./types";

// Re-export types and constants for consumers
export type { EdgeBinding, GraphNode, GraphRow, GraphData, GraphEdgeType } from "./types";
export {
	ROW_HEIGHT,
	LANE_WIDTH,
	LANE_PADDING,
	NODE_RADIUS,
	MAX_LANES,
	laneToX,
	laneColor,
} from "./constants";

export interface RevisionGraphHandle {
	scrollToChangeId: (
		changeId: string,
		options?: { align?: "auto" | "center"; smooth?: boolean },
	) => void;
}

interface RevisionGraphProps {
	revisions: Revision[];
	selectedRevision: Revision | null;
	onSelectRevision: (revision: Revision) => void;
	isLoading: boolean;
	errorMessage?: string | null;
	onRetry?: () => void;
	flash?: { changeId: string; key: number } | null;
	repoPath: string | null;
	pendingAbandon?: Revision | null;
	editingChangeId: string | null;
	onDescribe: (changeId: string, description: string) => void;
	onCancelDescribe: () => void;
	rebaseSourceChangeId: string | null;
	onPickRebaseDestination: (revision: Revision) => void;
	diffPanelRef: RefObject<HTMLElement | null>;
}

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
	const traceId = traceStart("build-graph", { revisionCount: revisions.length });
	if (revisions.length === 0) {
		traceEnd(traceId, { rowCount: 0, edgeCount: 0 });
		return { nodes: [], laneCount: 1, rows: [], edgeBindings: [] };
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

	traceEnd(traceId, { rowCount: rows.length, edgeCount: edgeBindings.length });
	return { nodes, laneCount: globalMaxLane + 1, rows, edgeBindings };
}

export const RevisionGraph = forwardRef<RevisionGraphHandle, RevisionGraphProps>(
	function RevisionGraph(
		{
			revisions,
			selectedRevision,
			onSelectRevision,
			isLoading,
			errorMessage,
			onRetry,
			flash,
			repoPath,
			pendingAbandon,
			editingChangeId,
			onDescribe,
			onCancelDescribe,
			rebaseSourceChangeId,
			onPickRebaseDestination,
			diffPanelRef,
		},
		ref,
	) {
		const parentRef = useRef<HTMLDivElement>(null);
		const containerRef = useRef<HTMLDivElement>(null);
		const prefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

		// Stabilize revisions array - only update ref when content changes (by length + endpoints)
		const stableRevisionsRef = useRef(revisions);
		if (
			revisions.length !== stableRevisionsRef.current.length ||
			revisions[0]?.change_id !== stableRevisionsRef.current[0]?.change_id
		) {
			stableRevisionsRef.current = revisions;
		}
		const stableRevisions = stableRevisionsRef.current;

		// Use native focus tracking
		const hasFocus = useFocusWithin(containerRef);
		const {
			nodes,
			laneCount,
			rows: allRows,
			edgeBindings,
		} = useMemo(() => buildGraph(stableRevisions), [stableRevisions]);
		const search = useSearch({ from: Route.fullPath });
		const navigate = useNavigate({ from: Route.fullPath });
		const [aceJumpQuery, setAceJumpQuery] = useAtom(aceJumpQueryAtom);
		const aceJumpMode = aceJumpQuery !== null;
		const isRebaseDestinationPickMode = rebaseSourceChangeId !== null;
		const rebaseSourceRevision = isRebaseDestinationPickMode
			? (stableRevisions.find((revision) => revision.change_id === rebaseSourceChangeId) ?? null)
			: null;

		// Detect collapsible stacks
		const stacks = useMemo(() => detectStacks(stableRevisions), [stableRevisions]);

		// Setup prefetch hooks for visible revision data
		const { prefetchDiffs, prefetchChanges, flushDiffs, flushChanges } = usePrefetch(
			repoPath ?? "",
		);

		// Track which stacks are expanded (empty = all collapsed by default)
		const [expandedStacks, setExpandedStacks] = useAtom(expandedStacksAtom);
		// Track hovered stack for coordinated edge highlighting
		const [, setHoveredStackId] = useAtom(hoveredStackIdAtom);

		// Read focused stack and selection from URL params
		const focusedStackId = useSearch({ from: Route.fullPath, select: (s) => s.stack ?? null });
		const selectedParam = useSearch({ from: Route.fullPath, select: (s) => s.selected ?? "" });
		const selectedRevisions = useMemo(() => {
			if (!selectedParam) return new Set<string>();
			return new Set(selectedParam.split(",").filter(Boolean));
		}, [selectedParam]);

		// Update URL with new selection
		function setSelectedRevisions(updater: Set<string> | ((prev: Set<string>) => Set<string>)) {
			const newSelection = typeof updater === "function" ? updater(selectedRevisions) : updater;
			const selected = newSelection.size > 0 ? [...newSelection].join(",") : undefined;
			navigate({
				search: { ...search, selected },
				replace: true,
			});
		}

		// Toggle a revision's checked state (uses revision key)
		function toggleRevisionCheck(revisionKey: string) {
			const next = new Set(selectedRevisions);
			if (next.has(revisionKey)) {
				next.delete(revisionKey);
			} else {
				next.add(revisionKey);
			}
			setSelectedRevisions(next);
		}

		// Build lookup maps for stacks
		const { stackByChangeId, stackById, intermediateChangeIds } = useMemo(() => {
			const byChangeId = new Map<string, RevisionStack>();
			const byId = new Map<string, RevisionStack>();
			const intermediates = new Set<string>();

			for (const stack of stacks) {
				byId.set(stack.id, stack);
				for (const changeId of stack.changeIds) {
					byChangeId.set(changeId, stack);
				}
				for (const changeId of stack.intermediateChangeIds) {
					intermediates.add(changeId);
				}
			}
			return { stackByChangeId: byChangeId, stackById: byId, intermediateChangeIds: intermediates };
		}, [stacks]);

		// Build node lane lookup by change_id (needed for display row construction)
		const changeIdToLane = useMemo(() => {
			const map = new Map<string, number>();
			for (const node of nodes) {
				map.set(node.revision.change_id, node.lane);
			}
			return map;
		}, [nodes]);

		// Display row can be either a revision row or a collapsed stack row
		type DisplayRow =
			| { type: "revision"; row: GraphRow }
			| { type: "collapsed-stack"; stack: RevisionStack; lane: number };

		// Filter rows to hide collapsed intermediate revisions and replace with a single collapsed stack row
		const displayRows = useMemo(() => {
			const traceId = traceStart("compute-display-rows", {
				allRowsCount: allRows.length,
			});

			const result: DisplayRow[] = [];

			for (const row of allRows) {
				const changeId = row.revision.change_id;
				const stack = stackByChangeId.get(changeId);

				if (stack && intermediateChangeIds.has(changeId)) {
					// This is an intermediate revision in a stack
					if (expandedStacks.has(stack.id)) {
						// Stack is expanded - show the revision
						result.push({ type: "revision", row });
					}
					// If collapsed, skip this row
				} else {
					// Not an intermediate or not in a stack - always show
					result.push({ type: "revision", row });

					// If this is the top of a collapsed stack, insert a collapsed stack row after it
					if (stack && changeId === stack.topChangeId && !expandedStacks.has(stack.id)) {
						const lane = changeIdToLane.get(changeId) ?? 0;
						result.push({ type: "collapsed-stack", stack, lane });
					}
				}
			}

			traceEnd(traceId, { displayRowCount: result.length });
			return result;
		}, [allRows, stackByChangeId, intermediateChangeIds, expandedStacks, changeIdToLane]);

		// Extract just revision rows for edge positioning and other logic
		const rows = useMemo(
			() =>
				displayRows
					.filter((d): d is { type: "revision"; row: GraphRow } => d.type === "revision")
					.map((d) => d.row),
			[displayRows],
		);

		// Toggle stack expansion
		function toggleStackExpansion(stackId: string) {
			// Clear hover state since stack structure is changing
			setHoveredStackId(null);
			setExpandedStacks((prev) => {
				const next = new Set(prev);
				if (next.has(stackId)) {
					next.delete(stackId);
				} else {
					next.add(stackId);
				}
				return next;
			});
		}

		// Toggle stack expansion and focus the top of newly revealed revisions when expanding
		async function handleToggleStack(stackId: string) {
			const stack = stackById.get(stackId);
			const isCurrentlyExpanded = expandedStacks.has(stackId);
			const traceId = traceStart(isCurrentlyExpanded ? "collapseStack" : "expandStack", {
				stackId,
				revisionCount: stack?.intermediateChangeIds.length ?? 0,
			});

			// If expanding (not currently expanded), prefetch the target diff FIRST
			// This ensures the diff is cached before we navigate, avoiding UI freeze
			if (!isCurrentlyExpanded && stack && stack.intermediateChangeIds.length > 0) {
				const targetChangeId = stack.intermediateChangeIds[0];
				prefetchDiffs([targetChangeId]);
				prefetchChanges([targetChangeId]);
				await Promise.all([flushDiffs(), flushChanges()]);
			}

			toggleStackExpansion(stackId);

			// If expanding (not currently expanded), focus the first intermediate revision
			// (the top of the newly revealed revisions, not the already-visible top of the stack)
			if (!isCurrentlyExpanded && stack && stack.intermediateChangeIds.length > 0) {
				const targetChangeId = stack.intermediateChangeIds[0];
				navigate({
					search: {
						...search,
						stack: undefined,
						rev: targetChangeId,
						selected: undefined,
						selectionAnchor: undefined,
					},
					replace: true,
				});
			}
			traceEnd(traceId);
		}

		// Maps for lookups - by revision key for UI, by commit_id for graph edges
		const revisionMapByKey = new Map(stableRevisions.map((r) => [getRevisionKey(r), r]));
		const revisionMapByCommitId = new Map(stableRevisions.map((r) => [r.commit_id, r]));

		// Build revision key -> displayRow index map for scrolling and edge positioning
		// IMPORTANT: Use displayRows indices (not rows) to match virtualizer positioning
		// Uses getRevisionKey() to handle divergent revisions (same change_id, different divergent_index)
		const changeIdToIndex = new Map<string, number>();
		const commitToRowIndex = new Map<string, number>();
		for (let i = 0; i < displayRows.length; i++) {
			const displayRow = displayRows[i];
			if (displayRow.type === "revision") {
				changeIdToIndex.set(getRevisionKey(displayRow.row.revision), i);
				commitToRowIndex.set(displayRow.row.revision.commit_id, i);
			}
		}

		// Create a mapping of change_id -> commit_id for edge remapping
		const changeIdToCommitId = useMemo(() => {
			const map = new Map<string, string>();
			for (const rev of stableRevisions) {
				map.set(rev.change_id, rev.commit_id);
			}
			return map;
		}, [stableRevisions]);

		// Filter edge bindings to handle collapsed/expanded stacks
		// When a stack is collapsed, edges from/to intermediates should be remapped
		// When a stack is expanded, edges within it should be clickable to collapse
		const filteredEdgeBindings = useMemo(() => {
			// Maps for collapsed stacks: intermediate commits -> bottom commit
			const hiddenToVisible = new Map<string, { targetCommitId: string; stack: RevisionStack }>();
			const topCommitToStack = new Map<string, RevisionStack>();
			// Map for expanded stacks: all commits in expanded stacks
			const commitToExpandedStack = new Map<string, RevisionStack>();

			for (const stack of stacks) {
				const isExpanded = expandedStacks.has(stack.id);

				if (isExpanded) {
					for (const changeId of stack.changeIds) {
						const commitId = changeIdToCommitId.get(changeId);
						if (commitId) commitToExpandedStack.set(commitId, stack);
					}
				} else {
					const bottomCommitId = changeIdToCommitId.get(stack.bottomChangeId);
					const topCommitId = changeIdToCommitId.get(stack.topChangeId);
					if (!bottomCommitId || !topCommitId) continue;

					topCommitToStack.set(topCommitId, stack);
					for (const intermediateChangeId of stack.intermediateChangeIds) {
						const intermediateCommitId = changeIdToCommitId.get(intermediateChangeId);
						if (intermediateCommitId) {
							hiddenToVisible.set(intermediateCommitId, { targetCommitId: bottomCommitId, stack });
						}
					}
				}
			}

			const remapped: EdgeBinding[] = [];
			const seen = new Set<string>();

			for (const binding of edgeBindings) {
				const { sourceRevisionId, targetRevisionId } = binding;
				const sourceExpandedStack = commitToExpandedStack.get(sourceRevisionId);

				// Skip hidden intermediates (unless in an expanded stack)
				if (hiddenToVisible.has(sourceRevisionId) && !sourceExpandedStack) continue;

				let targetId = targetRevisionId;
				let collapsedStackId: string | undefined;
				let collapsedCount: number | undefined;
				let expandedStackId: string | undefined;

				if (sourceExpandedStack) {
					// Source is in expanded stack - check if edge is within same stack
					const targetExpandedStack = commitToExpandedStack.get(targetRevisionId);
					if (targetExpandedStack?.id === sourceExpandedStack.id) {
						expandedStackId = sourceExpandedStack.id;
					}
				} else {
					// Source not in expanded stack - apply collapsed stack remapping
					const hiddenInfo = hiddenToVisible.get(targetId);
					if (hiddenInfo) {
						const isFromStackTop = topCommitToStack.has(sourceRevisionId);
						targetId = hiddenInfo.targetCommitId;
						if (isFromStackTop) {
							collapsedStackId = hiddenInfo.stack.id;
							collapsedCount = hiddenInfo.stack.intermediateChangeIds.length;
						}
					}
				}

				// Deduplicate
				const key = `${sourceRevisionId}->${targetId}`;
				if (seen.has(key)) continue;
				seen.add(key);

				remapped.push({
					...binding,
					targetRevisionId: targetId,
					collapsedStackId,
					collapsedCount,
					expandedStackId,
				});
			}

			return remapped;
		}, [edgeBindings, stacks, expandedStacks, changeIdToCommitId]);

		const [debugEnabled, setDebugEnabled] = useAtom(debugOverlayEnabledAtom);

		// Ref to hold scroll function - only scrolls if item is outside visible range
		const scrollToIndexIfNeededRef = useRef<((index: number) => void) | null>(null);

		// Keyboard navigation (j/k/J/K/arrows/g/G/Home/End/l/Space/Enter/Escape)
		useRevisionGraphNavigation({
			revisions: stableRevisions,
			displayRows,
			changeIdToIndex,
			selectedRevision,
			enabled: !aceJumpMode,
			scrollToIndex: (index) => scrollToIndexIfNeededRef.current?.(index),
			onToggleStack: handleToggleStack,
			hasFocus,
			diffPanelRef,
		});

		// Toggle debug overlay with Ctrl+Shift+D
		useKeyboardShortcut({
			key: "D",
			modifiers: { ctrl: true, shift: true },
			onPress: () => setDebugEnabled((prev) => !prev),
		});

		// Track if we just activated jump mode to ignore the same 'f' keypress
		const justActivatedRef = useRef(false);

		// Activate AceJump mode with 'f' key
		useKeyboardShortcut({
			key: "f",
			modifiers: {},
			onPress: () => {
				justActivatedRef.current = true;
				setAceJumpQuery("");
				// Clear the flag after a short delay (same event loop tick protection)
				requestAnimationFrame(() => {
					justActivatedRef.current = false;
				});
			},
			enabled: !aceJumpMode,
		});

		// Cancel AceJump mode with Escape
		useKeyboardShortcut({
			key: "Escape",
			modifiers: {},
			onPress: () => setAceJumpQuery(null),
			enabled: aceJumpMode,
		});

		const COLLAPSED_STACK_HEIGHT = 32;

		const getItemKey = useCallback(
			(index: number) => {
				const displayRow = displayRows[index];
				if (displayRow.type === "collapsed-stack") {
					return `collapsed-${displayRow.stack.id}`;
				}
				return `revision-${displayRow.row.revision.change_id}`;
			},
			[displayRows],
		);

		const rowVirtualizer = useVirtualizer({
			count: displayRows.length,
			getScrollElement: () => parentRef.current,
			estimateSize: (index: number) => {
				const displayRow = displayRows[index];
				if (displayRow.type === "collapsed-stack") {
					return COLLAPSED_STACK_HEIGHT;
				}
				return ROW_HEIGHT;
			},
			getItemKey,
			overscan: 5,
			debug: debugEnabled,
		});

		// Persist scroll position across view mode changes
		const [savedScrollTop, setSavedScrollTop] = useAtom(revisionGraphScrollTopAtom);

		// Restore scroll position on mount
		// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally restore only once on mount using persisted scroll state.
		useEffect(() => {
			const scrollEl = parentRef.current;
			if (!scrollEl || savedScrollTop === 0) return;

			// Use requestAnimationFrame to ensure the DOM is ready
			requestAnimationFrame(() => {
				scrollEl.scrollTop = savedScrollTop;
			});
			// Only run on mount - savedScrollTop is intentionally not in deps
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);

		// Save scroll position on scroll (DOM event subscription)
		// ast-grep-ignore: no-useeffect-state-sync
		useEffect(() => {
			const scrollEl = parentRef.current;
			if (!scrollEl) return;

			const handleScroll = () => {
				setSavedScrollTop(scrollEl.scrollTop);
			};

			scrollEl.addEventListener("scroll", handleScroll, { passive: true });
			return () => scrollEl.removeEventListener("scroll", handleScroll);
		}, [setSavedScrollTop]);

		// scrollToIndexIfNeededRef is updated below after virtualItems is computed

		// Expose scrollToChangeId method via ref
		useImperativeHandle(ref, () => ({
			scrollToChangeId: (
				changeId: string,
				options?: { align?: "auto" | "center"; smooth?: boolean },
			) => {
				const index = changeIdToIndex.get(changeId);
				if (index === undefined) {
					return;
				}

				const scrollElement = parentRef.current;
				if (!scrollElement) {
					return;
				}

				const scrollTop = scrollElement.scrollTop;
				const viewportHeight = scrollElement.clientHeight;
				const itemTop = index * ROW_HEIGHT;
				const itemBottom = itemTop + ROW_HEIGHT;

				// For jump commands (smooth/center), always scroll
				if (options?.smooth || options?.align === "center") {
					rowVirtualizer.scrollToIndex(index, {
						align: "center",
						behavior: "smooth",
					});
					return;
				}

				// For step navigation, manually scroll only if item is outside viewport
				const isAboveViewport = itemTop < scrollTop;
				const isBelowViewport = itemBottom > scrollTop + viewportHeight;

				if (isAboveViewport) {
					scrollElement.scrollTop = itemTop;
				} else if (isBelowViewport) {
					scrollElement.scrollTop = itemBottom - viewportHeight;
				}
			},
		}));

		function handleSelect(revisionKey: string, modifiers: { shift: boolean; meta: boolean }) {
			traceLog("handle-select", { revisionKey, shift: modifiers.shift, meta: modifiers.meta });

			const revision = revisionMapByKey.get(revisionKey);
			if (!revision) return;

			if (isRebaseDestinationPickMode && !modifiers.meta && !modifiers.shift) {
				if (revision.change_id !== rebaseSourceChangeId) {
					onPickRebaseDestination(revision);
				}
				return;
			}

			// Cmd/Ctrl+click: toggle selection
			if (modifiers.meta) {
				toggleRevisionCheck(revisionKey);
				return;
			}

			// Shift+click: range select from focused to clicked
			if (modifiers.shift && selectedRevision) {
				const focusedIndex = changeIdToIndex.get(getRevisionKey(selectedRevision));
				const clickedIndex = changeIdToIndex.get(revisionKey);
				if (focusedIndex !== undefined && clickedIndex !== undefined) {
					const startIdx = Math.min(focusedIndex, clickedIndex);
					const endIdx = Math.max(focusedIndex, clickedIndex);
					const newSelection = new Set<string>();
					for (let i = startIdx; i <= endIdx; i++) {
						const displayRow = displayRows[i];
						if (displayRow.type === "revision") {
							newSelection.add(getRevisionKey(displayRow.row.revision));
						}
					}
					// Update selection in URL
					const selected = newSelection.size > 0 ? [...newSelection].join(",") : undefined;
					navigate({
						search: { ...search, selected, stack: undefined },
						replace: true,
					});
				}
				return;
			}

			// Plain click: focus revision (clear selection, anchor, and stack focus)
			navigate({
				search: (prev) => ({
					...prev,
					selected: undefined,
					selectionAnchor: undefined,
					stack: undefined,
					rev: revisionKey,
				}),
				replace: true,
			});
		}

		const virtualItems = rowVirtualizer.getVirtualItems();
		const visibleStartRow = virtualItems[0]?.index ?? 0;
		const visibleEndRow = virtualItems[virtualItems.length - 1]?.index ?? 0;
		const totalHeight = rowVirtualizer.getTotalSize();

		// Update scroll ref - compute actually visible range based on scroll position
		scrollToIndexIfNeededRef.current = (index: number) => {
			const scrollEl = parentRef.current;
			if (!scrollEl) return;

			const scrollTop = scrollEl.scrollTop;
			const clientHeight = scrollEl.clientHeight;

			// Calculate which rows are fully visible (not just rendered with overscan)
			// Use ceil for start (first fully visible) and floor-1 for end (last fully visible)
			const visibleStart = Math.ceil(scrollTop / ROW_HEIGHT);
			const visibleEnd = Math.floor((scrollTop + clientHeight) / ROW_HEIGHT) - 1;

			const shouldScroll = index < visibleStart || index > visibleEnd;

			// Only scroll if the item is outside the fully visible range
			if (shouldScroll) {
				rowVirtualizer.scrollToIndex(index, { align: "auto" });
			}
		};
		const rowOffsets = new Map<number, number>();
		for (const item of virtualItems) {
			rowOffsets.set(item.index, item.start);
		}

		// Prefetch diffs and changes for visible and nearby revisions
		// Uses a buffer to prefetch ahead of scroll for smoother experience
		const PREFETCH_BUFFER = 20;
		// ast-grep-ignore: no-useeffect-state-sync
		useEffect(() => {
			if (!repoPath || displayRows.length === 0) return;

			// Clear previous timer
			if (prefetchDebounceRef.current) {
				clearTimeout(prefetchDebounceRef.current);
			}

			// Debounce prefetch by 200ms to avoid jitter during rapid navigation
			prefetchDebounceRef.current = setTimeout(() => {
				// Calculate range including buffer
				const startIdx = Math.max(0, visibleStartRow - PREFETCH_BUFFER);
				const endIdx = Math.min(displayRows.length - 1, visibleEndRow + PREFETCH_BUFFER);

				// Collect change IDs from display rows in the prefetch range
				const changeIds: string[] = [];
				for (let i = startIdx; i <= endIdx; i++) {
					const displayRow = displayRows[i];
					if (displayRow.type === "revision") {
						changeIds.push(displayRow.row.revision.change_id);
					} else if (displayRow.type === "collapsed-stack") {
						// Only prefetch representative revision from collapsed stack
						// (user hasn't expanded it, so don't load all)
						if (displayRow.stack.changeIds.length > 0) {
							changeIds.push(displayRow.stack.changeIds[0]);
						}
					}
				}

				// Also prefetch the selected revision if it exists
				if (selectedRevision) {
					changeIds.push(selectedRevision.change_id);
				}

				// Dedupe and cap to avoid overwhelming IPC with large repos
				const uniqueIds = [...new Set(changeIds)].slice(0, 50);
				prefetchDiffs(uniqueIds);
				prefetchChanges(uniqueIds);
			}, 200);

			// Cleanup on unmount or when deps change
			return () => {
				if (prefetchDebounceRef.current) {
					clearTimeout(prefetchDebounceRef.current);
				}
			};
		}, [
			repoPath,
			visibleStartRow,
			visibleEndRow,
			displayRows,
			selectedRevision,
			prefetchDiffs,
			prefetchChanges,
		]);

		// Compute jump hints for visible rows based on change ID prefix matching
		const { jumpHintsMap, matchingRevisions } = useMemo(() => {
			const hints = new Map<string, string>();
			const matches: Array<{ changeId: string; shortId: string }> = [];

			if (aceJumpMode && revisions.length > 0) {
				const query = aceJumpQuery ?? "";

				// First, collect all visible revisions that match the current query
				for (const item of virtualItems) {
					const row = rows[item.index];
					if (row) {
						const shortId = row.revision.change_id_short.toLowerCase();
						if (shortId.startsWith(query.toLowerCase())) {
							matches.push({
								changeId: row.revision.change_id,
								shortId: row.revision.change_id_short,
							});
						}
					}
				}

				// Assign hints based on the next character in the change ID
				if (query === "") {
					// Initial state: show first letter of each change ID
					for (const { changeId, shortId } of matches) {
						hints.set(changeId, shortId[0].toLowerCase());
					}
				} else {
					// After typing: show the next letter to type, or secondary hints if needed
					const nextCharIndex = query.length;
					const nextChars = new Map<string, Array<{ changeId: string; shortId: string }>>();

					// Group by next character
					for (const rev of matches) {
						const nextChar = rev.shortId[nextCharIndex]?.toLowerCase() ?? "";
						if (nextChar) {
							const group = nextChars.get(nextChar) ?? [];
							group.push(rev);
							nextChars.set(nextChar, group);
						}
					}

					// Assign hints
					for (const { changeId, shortId } of matches) {
						const nextChar = shortId[nextCharIndex]?.toLowerCase() ?? "";
						if (nextChar) {
							hints.set(changeId, nextChar);
						}
					}
				}
			}

			return { jumpHintsMap: hints, matchingRevisions: matches };
		}, [aceJumpMode, aceJumpQuery, revisions.length, virtualItems, rows]);

		// Store matching revisions in a ref for use in the effect
		const matchingRevisionsRef = useRef(matchingRevisions);
		matchingRevisionsRef.current = matchingRevisions;

		// Handle AceJump letter key presses (DOM event subscription)
		// ast-grep-ignore: no-useeffect-state-sync
		useEffect(() => {
			if (!aceJumpMode) return;

			function handleJumpKey(event: KeyboardEvent) {
				const activeElement = document.activeElement;
				if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
					return;
				}

				const key = event.key.toLowerCase();

				// Ignore the activation key 'f' if we just activated (prevents same event capture)
				if (key === "f" && justActivatedRef.current) {
					return;
				}

				// Handle backspace to remove last character
				if (event.key === "Backspace") {
					event.preventDefault();
					const currentQuery = aceJumpQuery ?? "";
					if (currentQuery.length > 0) {
						setAceJumpQuery(currentQuery.slice(0, -1));
					} else {
						setAceJumpQuery(null); // Cancel if already empty
					}
					return;
				}

				// Only accept alphanumeric characters for the query
				if (/^[a-z0-9]$/i.test(key)) {
					event.preventDefault();
					const newQuery = (aceJumpQuery ?? "") + key;

					// Find matching revisions with the new query
					const matches = matchingRevisionsRef.current.filter(({ shortId }) =>
						shortId.toLowerCase().startsWith(newQuery.toLowerCase()),
					);

					if (matches.length === 1) {
						// Single match - jump directly
						setAceJumpQuery(null);
						// Look up revision by change_id (matchingRevisions stores change_id)
						const revision = revisions.find((r) => r.change_id === matches[0].changeId);
						if (revision) {
							onSelectRevision(revision);
						}
					} else if (matches.length === 0) {
						// No matches - cancel
						setAceJumpQuery(null);
					} else {
						// Multiple matches - update query to filter
						setAceJumpQuery(newQuery);
					}
					return;
				}

				// Any other non-modifier key cancels jump mode
				if (!["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) {
					setAceJumpQuery(null);
				}
			}

			window.addEventListener("keydown", handleJumpKey);
			return () => window.removeEventListener("keydown", handleJumpKey);
		}, [aceJumpMode, aceJumpQuery, setAceJumpQuery, revisions, onSelectRevision]);

		if (errorMessage) {
			return (
				<div
					ref={containerRef}
					tabIndex={-1}
					className="flex h-full items-center justify-center bg-background outline-none"
				>
					<div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-center">
						<p className="text-sm text-destructive">Failed to load revisions</p>
						<p className="mt-1 text-xs text-muted-foreground">{errorMessage}</p>
						{onRetry ? (
							<button
								type="button"
								onClick={onRetry}
								className="mt-3 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
							>
								Retry
							</button>
						) : null}
					</div>
				</div>
			);
		}

		if (revisions.length === 0) {
			return (
				<div
					ref={containerRef}
					tabIndex={-1}
					className="flex items-center justify-center h-full bg-background text-muted-foreground text-sm outline-none"
				>
					{isLoading ? "Loading revisions..." : "Select a project to view revisions"}
				</div>
			);
		}

		const selectedIndex = selectedRevision
			? changeIdToIndex.get(getRevisionKey(selectedRevision))
			: undefined;

		const workingCopy = revisions.find((r) => r.is_working_copy);
		const wcIndex = workingCopy ? changeIdToIndex.get(getRevisionKey(workingCopy)) : undefined;

		// Calculate edge layer dimensions and row center positions
		const getRowStart = (row: number) => {
			const offset = rowOffsets.get(row) ?? row * ROW_HEIGHT;
			return offset;
		};
		const getRowCenter = (row: number) => {
			const displayRow = displayRows[row];
			const height = displayRow?.type === "collapsed-stack" ? COLLAPSED_STACK_HEIGHT : ROW_HEIGHT;
			const start = getRowStart(row);
			const center = start + height / 2;
			return center;
		};
		const graphWidth = LANE_PADDING + laneCount * LANE_WIDTH + NODE_RADIUS + 2;

		return (
			<div ref={containerRef} tabIndex={-1} className="h-full outline-none">
				<div
					ref={parentRef}
					className="h-full overflow-auto ascii-bg pt-4"
					style={{ overflowAnchor: "none" }}
				>
					{isRebaseDestinationPickMode && rebaseSourceRevision ? (
						<div className="sticky top-0 z-30 border-y border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
							Rebase mode: choose destination for
							<code className="mx-1 rounded bg-primary/20 px-1 py-0.5 font-mono text-[10px]">
								{rebaseSourceRevision.change_id_short}
							</code>
							(Enter or click revision, Esc to cancel)
						</div>
					) : null}
					<div
						className="relative"
						style={{
							height: `${totalHeight}px`,
							width: "100%",
						}}
					>
						{/* Edge layer - semantic edge components positioned absolutely */}
						{/* Key includes expandedStacks to force remount when stack state changes */}
						<EdgeLayer
							key={`edges-${[...expandedStacks].sort().join(",")}`}
							bindings={filteredEdgeBindings}
							commitToRow={commitToRowIndex}
							revisionMap={revisionMapByCommitId}
							getRowCenter={getRowCenter}
							totalHeight={totalHeight}
							width={graphWidth}
							visibleStartRow={visibleStartRow}
							visibleEndRow={visibleEndRow}
							stackById={stackById}
							changeIdToCommitId={changeIdToCommitId}
							onToggleStack={handleToggleStack}
						/>

						{/* Virtualized rows with inline graph nodes */}
						<div className="relative z-10">
							{virtualItems.map((virtualRow) => {
								const displayRow = displayRows[virtualRow.index];

								// Collapsed stack row - styled as stacked cards
								if (displayRow.type === "collapsed-stack") {
									const { stack, lane } = displayRow;
									const nodeAreaWidth = LANE_PADDING + (lane + 1) * LANE_WIDTH;
									const count = stack.intermediateChangeIds.length;

									const isStackDimmed = false;
									const isStackFocused = focusedStackId === stack.id;

									return (
										<div
											key={`collapsed-${stack.id}`}
											data-index={virtualRow.index}
											className="absolute left-0 w-full"
											style={{
												transform: `translateY(${virtualRow.start}px)`,
												height: COLLAPSED_STACK_HEIGHT,
											}}
										>
											<div className="flex relative" style={{ height: COLLAPSED_STACK_HEIGHT }}>
												{/* Spacer for graph area */}
												<div className="shrink-0" style={{ width: nodeAreaWidth + 8 }} />
												<button
													type="button"
													onClick={() => {
														// Focus the stack (similar to keyboard navigation)
														navigate({
															search: {
																...search,
																stack: stack.id,
																rev: undefined,
																selected: undefined,
																selectionAnchor: undefined,
															},
															replace: true,
														});
													}}
													onDoubleClick={() => handleToggleStack(stack.id)}
													className={`relative flex-1 mr-2 min-w-0 py-1 flex items-center justify-center outline-none border-b ${
														isStackFocused
															? "bg-accent/40 rounded-md border-transparent"
															: "border-border/30"
													} ${isStackDimmed ? "opacity-40" : ""}`}
													ref={(el) => {
														// Programmatically focus when stack becomes focused
														if (isStackFocused && el && document.activeElement !== el) {
															el.focus({ preventScroll: true });
														}
													}}
													data-stack-id={stack.id}
												>
													{/* Content */}
													<div className="flex items-center justify-center gap-2">
														<svg
															className="w-3.5 h-3.5 text-muted-foreground"
															fill="none"
															viewBox="0 0 24 24"
															stroke="currentColor"
															aria-hidden="true"
														>
															<path
																strokeLinecap="round"
																strokeLinejoin="round"
																strokeWidth={2}
																d="M7 10l5-5 5 5M7 14l5 5 5-5"
															/>
														</svg>
														<span className="text-xs text-muted-foreground">
															{count} elided revision{count !== 1 ? "s" : ""}
														</span>
													</div>
												</button>
											</div>
										</div>
									);
								}

								// Regular revision row
								const { row } = displayRow;
								const lane = changeIdToLane.get(row.revision.change_id) ?? 0;
								const isFlashing = flash?.changeId === row.revision.change_id;
								const isDimmed = false;
								// Only show focus if no stack is focused
								const isFocused =
									!focusedStackId &&
									!!selectedRevision &&
									getRevisionKey(selectedRevision) === getRevisionKey(row.revision);
								const isSelected = isFocused;

								return (
									<div
										key={getRevisionKey(row.revision)}
										data-index={virtualRow.index}
										className="absolute left-0 w-full"
										style={{
											transform: `translateY(${virtualRow.start}px)`,
											height: ROW_HEIGHT,
										}}
									>
										<RevisionRow
											revision={row.revision}
											lane={lane}
											maxLaneOnRow={row.maxLaneOnRow}
											isSelected={isSelected}
											isChecked={selectedRevisions.has(getRevisionKey(row.revision))}
											isFocused={isFocused}
											onSelect={handleSelect}
											isFlashing={isFlashing}
											isDimmed={isDimmed}
											isPendingAbandon={pendingAbandon?.change_id === row.revision.change_id}
											isEditing={editingChangeId === getRevisionKey(row.revision)}
											onDescribe={onDescribe}
											onCancelDescribe={onCancelDescribe}
											jumpModeActive={aceJumpMode}
											jumpQuery={aceJumpQuery ?? ""}
											jumpHint={jumpHintsMap.get(row.revision.change_id) ?? null}
											hasFocus={hasFocus}
										/>
									</div>
								);
							})}
						</div>
					</div>

					{/* Debug overlay - toggle with Ctrl+Shift+D */}
					<DebugOverlay
						scrollRef={parentRef}
						selectedIndex={selectedIndex}
						visibleStartRow={visibleStartRow}
						visibleEndRow={visibleEndRow}
						totalRows={rows.length}
						wcIndex={wcIndex}
						selectedChangeId={selectedRevision?.change_id}
						wcChangeId={workingCopy?.change_id}
					/>
				</div>
			</div>
		);
	},
);
