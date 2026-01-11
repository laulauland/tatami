import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChangedFilesList } from "@/components/ChangedFilesList";
import { reorderForGraph } from "@/components/revision-graph-utils";
import { Badge } from "@/components/ui/badge";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { getRevisionChanges, type Revision } from "@/tauri-commands";

// Debug overlay - toggle with Ctrl+Shift+D
const DEBUG_OVERLAY_DEFAULT = false;

function DebugOverlay({
	enabled,
	scrollRef,
	selectedIndex,
	visibleStartRow,
	visibleEndRow,
	totalRows,
}: {
	enabled: boolean;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	selectedIndex: number | undefined;
	visibleStartRow: number;
	visibleEndRow: number;
	totalRows: number;
}) {
	// Force re-render on scroll/resize/focus
	const [, forceUpdate] = useState(0);

	useEffect(() => {
		if (!enabled) return;
		const el = scrollRef.current;
		if (!el) return;

		const update = () => forceUpdate((n) => n + 1);
		el.addEventListener("scroll", update);
		window.addEventListener("resize", update);
		document.addEventListener("focusin", update);
		return () => {
			el.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			document.removeEventListener("focusin", update);
		};
	}, [scrollRef, enabled]);

	if (!enabled) return null;

	const el = scrollRef.current;
	const scrollTop = el?.scrollTop ?? 0;
	const clientHeight = el?.clientHeight ?? 0;
	const scrollHeight = el?.scrollHeight ?? 0;

	const selectedItemTop = selectedIndex !== undefined ? selectedIndex * ROW_HEIGHT : 0;
	const selectedItemBottom = selectedItemTop + ROW_HEIGHT;
	const distanceFromTop = selectedItemTop - scrollTop;
	const distanceFromBottom = scrollTop + clientHeight - selectedItemBottom;
	const isInViewport = distanceFromTop >= 0 && distanceFromBottom >= 0;

	const active = document.activeElement;
	const activeElement = active
		? `${active.tagName}${active.className ? `.${active.className.split(" ")[0]}` : ""}`
		: "none";

	const info = {
		scrollTop,
		clientHeight,
		scrollHeight,
		viewportEnd: scrollTop + clientHeight,
		selectedIndex,
		itemTop: selectedItemTop,
		itemBottom: selectedItemBottom,
		distFromTop: distanceFromTop,
		distFromBottom: distanceFromBottom,
		isInViewport,
		virtualRange: `${visibleStartRow}-${visibleEndRow}`,
		totalRows,
		ROW_HEIGHT,
		activeElement,
	};

	return (
		<div
			className="fixed bottom-12 right-4 z-50 bg-black/90 text-green-400 font-mono text-xs p-3 rounded-lg shadow-lg max-w-xs cursor-pointer hover:bg-black/95 active:scale-95 transition-transform"
			onClick={() => navigator.clipboard.writeText(JSON.stringify(info, null, 2))}
			title="Click to copy"
		>
			<div className="font-bold text-green-300 mb-2">
				Debug Info <span className="text-green-600">(click to copy)</span>
			</div>
			<div className="space-y-1">
				<div>scrollTop: {scrollTop.toFixed(0)}</div>
				<div>clientHeight: {clientHeight.toFixed(0)}</div>
				<div>scrollHeight: {scrollHeight}</div>
				<div>viewportEnd: {(scrollTop + clientHeight).toFixed(0)}</div>
				<div className="border-t border-green-800 my-2" />
				<div>selectedIndex: {selectedIndex ?? "none"}</div>
				<div>itemTop: {selectedItemTop}</div>
				<div>itemBottom: {selectedItemBottom}</div>
				<div className="border-t border-green-800 my-2" />
				<div>distFromTop: {distanceFromTop.toFixed(0)}</div>
				<div>distFromBottom: {distanceFromBottom.toFixed(0)}</div>
				<div className={isInViewport ? "text-green-400" : "text-red-400"}>
					inViewport: {isInViewport ? "YES" : "NO"}
				</div>
				<div className="border-t border-green-800 my-2" />
				<div>
					virtualRange: {visibleStartRow}-{visibleEndRow}
				</div>
				<div>totalRows: {totalRows}</div>
				<div>ROW_HEIGHT: {ROW_HEIGHT}</div>
				<div className="border-t border-green-800 my-2" />
				<div className="truncate" title={activeElement}>
					focus: {activeElement}
				</div>
			</div>
		</div>
	);
}

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
	flash?: { changeId: string; key: number } | null;
	repoPath: string | null;
}

const ROW_HEIGHT = 64;
const LANE_WIDTH = 20;
const LANE_PADDING = 8;
const NODE_RADIUS = 5;
const MAX_LANES = 3;

const LANE_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
	"var(--primary)",
];

type GraphEdgeType = "direct" | "indirect" | "missing";

interface ParentConnection {
	parentRow: number;
	parentLane: number;
	edgeType: GraphEdgeType;
	isDeemphasized?: boolean;
	isMissingStub?: boolean;
}

interface GraphNode {
	revision: Revision;
	row: number;
	lane: number;
	parentConnections: ParentConnection[];
}

interface GraphRow {
	revision: Revision;
	lane: number;
	maxLaneOnRow: number; // Rightmost lane occupied by any graph element (node or edge) on this row
}

interface GraphData {
	nodes: GraphNode[];
	laneCount: number;
	rows: GraphRow[];
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

function buildGraph(revisions: Revision[]): GraphData {
	if (revisions.length === 0) return { nodes: [], laneCount: 1, rows: [] };

	// Map commit_id -> Revision for ancestry lookups
	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));

	// Create rows for all revisions (no elision)
	const orderedRevisions = reorderForGraph(revisions);
	const rows: GraphRow[] = orderedRevisions.map((rev) => ({
		revision: rev,
		lane: 0,
		maxLaneOnRow: 0,
	}));

	// Get working copy chain - these commits should all be in lane 0
	const workingCopyChain = getWorkingCopyChain(revisions);

	// Check if we have trunk commits or working copy (determines if lane 0 is reserved)
	const hasLane0Commits = workingCopyChain.size > 0 || revisions.some((r) => r.is_trunk);

	// Build row index map
	const commitToRow = new Map<string, number>();
	rows.forEach((row, idx) => {
		commitToRow.set(row.revision.commit_id, idx);
	});

	const commitToLane = new Map<string, number>();
	const nodes: GraphNode[] = [];
	// Start at lane 1 if lane 0 is reserved for trunk/working copy
	let nextLane = hasLane0Commits ? 1 : 0;

	function claimLane(id: string, preferredLane?: number): number {
		// If already assigned (e.g., working copy chain), return that lane
		const existing = commitToLane.get(id);
		if (existing !== undefined) return existing;

		if (preferredLane !== undefined) {
			return Math.min(preferredLane, MAX_LANES - 1);
		}

		// Assign next available lane
		const lane = Math.min(nextLane, MAX_LANES - 1);
		nextLane = Math.min(nextLane + 1, MAX_LANES);
		return lane;
	}

	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
		const row = rows[rowIdx];
		const revision = row.revision;

		let lane = commitToLane.get(revision.commit_id);
		if (lane === undefined) {
			// Trunk commits and working copy chain always go on lane 0
			const isOnWorkingCopyChain = workingCopyChain.has(revision.commit_id);
			if (revision.is_trunk || isOnWorkingCopyChain) {
				lane = 0;
			} else {
				lane = claimLane(revision.commit_id);
			}
			commitToLane.set(revision.commit_id, lane);
		}

		const parentConnections: ParentConnection[] = [];

		// Detect "main merges into branch" scenario
		const isMerge = revision.parent_edges.length > 1;
		const isMutableCommit = !revision.is_immutable;

		// Use parent_edges from backend which contains edge type info
		for (let i = 0; i < revision.parent_edges.length; i++) {
			const parentEdge = revision.parent_edges[i];
			const parentId = parentEdge.parent_id;
			const edgeType = parentEdge.edge_type;

			// Handle missing edges (parents outside our revset)
			if (edgeType === "missing") {
				// Draw a short stub to indicate ancestry exists outside current view
				parentConnections.push({
					parentRow: rowIdx + 1, // Just one row down for the stub
					parentLane: lane,
					edgeType: "missing",
					isMissingStub: true,
				});
				continue;
			}

			const parentRow = commitToRow.get(parentId);
			if (parentRow === undefined) continue;

			let parentLane = commitToLane.get(parentId);
			if (parentLane === undefined) {
				// Check if parent is a trunk commit or on working copy chain
				const parentRev = commitMap.get(parentId);
				const parentIsTrunk = parentRev?.is_trunk ?? false;
				const parentOnWorkingCopyChain = workingCopyChain.has(parentId);

				if (parentIsTrunk || parentOnWorkingCopyChain) {
					// Trunk commits and working copy chain always go on lane 0
					parentLane = 0;
				} else {
					// First parent inherits our lane; other parents get their own
					parentLane = i === 0 ? lane : claimLane(parentId);
				}
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

		// Fallback: if node has parents but no connections drawn, add a stub
		// This handles cases where all edges were filtered/missing
		if (parentConnections.length === 0 && revision.parent_ids.length > 0) {
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

	// Calculate maxLaneOnRow by analyzing which edges pass through each row
	// With horizontal-first edges: horizontal segment at node's row, vertical segment to parent
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

			// Vertical segment passes through all rows between node and parent
			const minRow = Math.min(nodeRow, parentRow);
			const maxRow = Math.max(nodeRow, parentRow);
			for (let r = minRow + 1; r < maxRow; r++) {
				const row = rows[r];
				if (row) {
					row.maxLaneOnRow = Math.max(row.maxLaneOnRow, parentLane);
				}
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

	return { nodes, laneCount: globalMaxLane + 1, rows };
}

function laneToX(lane: number): number {
	return LANE_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function laneColor(lane: number): string {
	return LANE_COLORS[lane % LANE_COLORS.length];
}

interface GraphColumnProps {
	nodes: GraphNode[];
	laneCount: number;
	visibleStartRow: number;
	visibleEndRow: number;
	totalHeight: number;
	rowOffsets: Map<number, number>;
}

function GraphColumn({
	nodes,
	laneCount,
	visibleStartRow,
	visibleEndRow,
	totalHeight,
	rowOffsets,
}: GraphColumnProps) {
	const getRowStart = (row: number) => rowOffsets.get(row) ?? row * ROW_HEIGHT;
	const getRowCenter = (row: number) => getRowStart(row) + ROW_HEIGHT / 2;

	const { rev: selectedChangeId } = useSearch({ strict: false });
	// Minimal right padding - tight fit for the rightmost node
	const width = LANE_PADDING + laneCount * LANE_WIDTH + NODE_RADIUS + 2;

	// Add overscan for edges that might span across viewport boundary
	const overscan = 5;
	const startRow = Math.max(0, visibleStartRow - overscan);
	const endRow = Math.min(nodes.length - 1, visibleEndRow + overscan);

	// Filter nodes that are in the visible range
	const visibleNodes = nodes.filter((node) => node.row >= startRow && node.row <= endRow);

	// Also include nodes whose edges pass through the visible area
	const nodesWithVisibleEdges = nodes.filter((node) => {
		if (node.row >= startRow && node.row <= endRow) return false; // Already included
		return node.parentConnections.some((conn) => {
			const minRow = Math.min(node.row, conn.parentRow);
			const maxRow = Math.max(node.row, conn.parentRow);
			return maxRow >= startRow && minRow <= endRow;
		});
	});

	const allVisibleNodes = [...visibleNodes, ...nodesWithVisibleEdges];

	return (
		<svg
			width={width}
			height={totalHeight}
			className="shrink-0 absolute top-0 left-0 pointer-events-none"
			role="img"
			aria-label="Revision graph"
		>
			<title>Revision graph</title>
			{/* Edges */}
			{allVisibleNodes.map((node) => {
				const y = getRowCenter(node.row);
				const x = laneToX(node.lane);
				const color = laneColor(node.lane);
				const nodeKey = node.revision.change_id;

				return (
					<g key={`edges-${nodeKey}`}>
						{node.parentConnections.map((conn, idx) => {
							const edgeColor = laneColor(conn.parentLane);

							// Style based on edge type from backend
							const isDashed = conn.edgeType === "indirect";
							const isMissing = conn.edgeType === "missing";

							// Apply de-emphasis styling for "main merges into branch" edges
							const strokeWidth = conn.isDeemphasized ? 1 : 2;
							const strokeOpacity = conn.isDeemphasized ? 0.4 : isMissing ? 0.3 : 0.8;
							const strokeColor = conn.isDeemphasized ? "var(--muted-foreground)" : edgeColor;

							// Missing stub: short dashed vertical line indicating parent outside view
							if (conn.isMissingStub) {
								const stubLength = ROW_HEIGHT * 0.4;
								return (
									<line
										key={idx}
										x1={x}
										y1={y + NODE_RADIUS}
										x2={x}
										y2={y + NODE_RADIUS + stubLength}
										stroke={color}
										strokeWidth={1.5}
										strokeOpacity={0.4}
										strokeDasharray="3 3"
									/>
								);
							}

							const parentY = getRowCenter(conn.parentRow);
							const parentX = laneToX(conn.parentLane);

							if (node.lane === conn.parentLane) {
								return (
									<line
										key={idx}
										x1={x}
										y1={y + NODE_RADIUS}
										x2={parentX}
										y2={parentY - NODE_RADIUS}
										stroke={conn.isDeemphasized ? strokeColor : color}
										strokeWidth={strokeWidth}
										strokeOpacity={strokeOpacity}
										strokeDasharray={isDashed ? "4 4" : undefined}
									/>
								);
							}

							// Cross-lane connections: horizontal from child, curve down into parent's lane
							const goingRight = parentX > x;
							const arcRadius = 10;

							return (
								<path
									key={idx}
									d={`M ${x} ${y + NODE_RADIUS}
										L ${parentX - arcRadius * (goingRight ? 1 : -1)} ${y + NODE_RADIUS}
										Q ${parentX} ${y + NODE_RADIUS} ${parentX} ${y + NODE_RADIUS + arcRadius}
										L ${parentX} ${parentY - NODE_RADIUS}`}
									fill="none"
									stroke={strokeColor}
									strokeWidth={strokeWidth}
									strokeOpacity={strokeOpacity}
									strokeDasharray={isDashed ? "4 4" : undefined}
								/>
							);
						})}
					</g>
				);
			})}

			{/* Nodes - only render visible ones */}
			{visibleNodes.map((node) => {
				const y = getRowCenter(node.row);
				const x = laneToX(node.lane);
				const color = laneColor(node.lane);
				const isSelected = node.revision.change_id === selectedChangeId;
				const isWorkingCopy = node.revision.is_working_copy;
				const isImmutable = node.revision.is_immutable;

				if (isWorkingCopy) {
					return (
						<g key={node.revision.change_id}>
							{isSelected && (
								<circle cx={x} cy={y} r={NODE_RADIUS + 6} fill={color} fillOpacity={0.3} />
							)}
							<circle cx={x} cy={y} r={NODE_RADIUS + 3} fill={color} fillOpacity={0.2} />
							<text
								x={x}
								y={y}
								textAnchor="middle"
								dominantBaseline="central"
								fill={color}
								fontWeight="bold"
								fontSize="12"
							>
								@
							</text>
						</g>
					);
				}

				// Immutable commits get a diamond shape (◆)
				if (isImmutable) {
					return (
						<g key={node.revision.change_id}>
							{isSelected && (
								<circle cx={x} cy={y} r={NODE_RADIUS + 4} fill={color} fillOpacity={0.3} />
							)}
							<rect
								x={x - NODE_RADIUS}
								y={y - NODE_RADIUS}
								width={NODE_RADIUS * 2}
								height={NODE_RADIUS * 2}
								fill={color}
								transform={`rotate(45 ${x} ${y})`}
							/>
						</g>
					);
				}

				return (
					<g key={node.revision.change_id}>
						{isSelected && (
							<circle cx={x} cy={y} r={NODE_RADIUS + 4} fill={color} fillOpacity={0.3} />
						)}
						<circle cx={x} cy={y} r={NODE_RADIUS} fill={color} />
					</g>
				);
			})}
		</svg>
	);
}

function RevisionRow({
	revision,
	maxLaneOnRow,
	isSelected,
	onSelect,
	isFlashing,
	isDimmed,
	isExpanded,
	isFocused,
	repoPath,
}: {
	revision: Revision;
	maxLaneOnRow: number;
	isSelected: boolean;
	onSelect: (changeId: string) => void;
	isFlashing: boolean;
	isDimmed: boolean;
	isExpanded: boolean;
	isFocused: boolean;
	repoPath: string | null;
}) {
	const firstLine = revision.description.split("\n")[0] || "(no description)";
	const fullDescription = revision.description || "(no description)";
	const indent = LANE_PADDING + (maxLaneOnRow + 1) * LANE_WIDTH + NODE_RADIUS + 4;

	const search = useSearch({ strict: false });
	const navigate = useNavigate();
	const selectedFile = search.file ?? null;

	const changedFilesQuery = useQuery({
		queryKey: ["revision-changes", repoPath, revision.change_id],
		queryFn: () => {
			if (!repoPath) throw new Error("No repository path");
			return getRevisionChanges(repoPath, revision.change_id);
		},
		enabled: isExpanded && !!repoPath,
	});

	function handleSelectFile(filePath: string) {
		navigate({
			search: { ...search, file: filePath } as any,
		});
	}

	return (
		<div style={{ height: isExpanded ? "auto" : ROW_HEIGHT }} className="flex flex-col">
			<div className="flex items-start min-h-[56px]">
				<div style={{ width: indent }} className="shrink-0" />
				<div
					className={`flex-1 mr-2 min-w-0 overflow-hidden rounded my-2 mx-1 border border-border bg-card text-card-foreground shadow-sm transition-colors duration-150 hover:shadow hover:bg-accent/20 hover:cursor-pointer ${
						revision.is_immutable ? "opacity-60" : ""
					} ${isDimmed ? "opacity-40" : ""} ${isSelected ? "bg-accent/30 border-ring/60" : ""} ${
						isFocused ? "ring-2 ring-ring/80 ring-offset-2 ring-offset-background" : ""
					}`}
					onClick={() => onSelect(revision.change_id)}
				>
					<div className="px-3 py-2 min-w-0">
						<div className="flex items-center gap-2 flex-nowrap min-w-0">
							<code
								className={`text-xs font-mono text-muted-foreground rounded px-0.5 ${
									isFlashing ? "bg-primary/40 animate-pulse" : ""
								}`}
							>
								{revision.change_id_short}
							</code>
							{revision.bookmarks.length > 0 &&
								revision.bookmarks.map((bookmark) => (
									<Badge key={bookmark} variant="secondary" className="text-xs px-1 py-0">
										{bookmark}
									</Badge>
								))}
							<span className="text-xs text-muted-foreground truncate min-w-0">
								{revision.author.split("@")[0]} · {revision.timestamp}
							</span>
						</div>
						<div className={`text-sm mt-1 ${isExpanded ? "" : "truncate"}`}>{firstLine}</div>
					</div>
					{isExpanded && (
						<div className="px-3 pb-3 pt-0 space-y-3">
							<pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/40 border border-border/60 rounded p-2">
								{fullDescription}
							</pre>
							<div className="border border-border rounded-lg overflow-hidden bg-background">
								<ChangedFilesList
									files={changedFilesQuery.data ?? []}
									selectedFile={selectedFile}
									onSelectFile={handleSelectFile}
									isLoading={changedFilesQuery.isLoading}
								/>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// Compute related revisions (ancestors + descendants) of a selected revision
function getRelatedRevisions(revisions: Revision[], selectedChangeId: string | null): Set<string> {
	if (!selectedChangeId) return new Set();

	const related = new Set<string>();
	const commitIdToChangeId = new Map<string, string>();
	const changeIdToCommitId = new Map<string, string>();
	const childrenMap = new Map<string, string[]>(); // commit_id -> child commit_ids
	const parentMap = new Map<string, string[]>(); // commit_id -> parent commit_ids

	// Build maps
	for (const rev of revisions) {
		commitIdToChangeId.set(rev.commit_id, rev.change_id);
		changeIdToCommitId.set(rev.change_id, rev.commit_id);
		const parents: string[] = [];
		for (const edge of rev.parent_edges) {
			if (edge.edge_type === "missing") continue;
			parents.push(edge.parent_id);
			const children = childrenMap.get(edge.parent_id) ?? [];
			children.push(rev.commit_id);
			childrenMap.set(edge.parent_id, children);
		}
		parentMap.set(rev.commit_id, parents);
	}

	const selectedCommitId = changeIdToCommitId.get(selectedChangeId);
	if (!selectedCommitId) return new Set();

	// BFS to find ancestors
	const ancestorQueue = [selectedCommitId];
	const visited = new Set<string>();
	while (ancestorQueue.length > 0) {
		const id = ancestorQueue.shift()!;
		if (visited.has(id)) continue;
		visited.add(id);
		const changeId = commitIdToChangeId.get(id);
		if (changeId) related.add(changeId);
		const parents = parentMap.get(id) ?? [];
		for (const parentId of parents) {
			ancestorQueue.push(parentId);
		}
	}

	// BFS to find descendants
	const descendantQueue = [selectedCommitId];
	visited.clear();
	while (descendantQueue.length > 0) {
		const id = descendantQueue.shift()!;
		if (visited.has(id)) continue;
		visited.add(id);
		const changeId = commitIdToChangeId.get(id);
		if (changeId) related.add(changeId);
		const children = childrenMap.get(id) ?? [];
		for (const childId of children) {
			descendantQueue.push(childId);
		}
	}

	return related;
}

export const RevisionGraph = forwardRef<RevisionGraphHandle, RevisionGraphProps>(
	function RevisionGraph(
		{ revisions, selectedRevision, onSelectRevision, isLoading, flash, repoPath },
		ref,
	) {
		const parentRef = useRef<HTMLDivElement>(null);
		const { nodes, laneCount, rows } = buildGraph(revisions);
		const search = useSearch({ strict: false });
		const navigate = useNavigate();

		const revisionMap = new Map(revisions.map((r) => [r.change_id, r]));
		const relatedRevisions = getRelatedRevisions(revisions, selectedRevision?.change_id ?? null);

		// Build change_id -> row index map for scrolling
		const changeIdToIndex = new Map<string, number>();
		for (let i = 0; i < rows.length; i++) {
			changeIdToIndex.set(rows[i].revision.change_id, i);
		}

		const [debugEnabled, setDebugEnabled] = useState(DEBUG_OVERLAY_DEFAULT);
		const debugEnabledRef = useRef(debugEnabled);
		debugEnabledRef.current = debugEnabled;

		// Determine if selected revision is expanded based on URL search params
		const isSelectedExpanded = search.expanded === true && !!selectedRevision;

		// Toggle debug overlay with Ctrl+Shift+D
		useKeyboardShortcut({
			key: "D",
			modifiers: { ctrl: true, shift: true },
			onPress: () => setDebugEnabled((prev) => !prev),
		});

		// Expand selected revision with 'l' key (only expands, doesn't collapse)
		useKeyboardShortcut({
			key: "l",
			modifiers: {},
			onPress: () => {
				if (!selectedRevision) return;

				// Check if already expanded
				if (isSelectedExpanded) return; // Do nothing if already expanded

				// Expand the revision by setting expanded=true in URL
				navigate({
					search: { ...search, expanded: true } as any,
				});
			},
		});

		// Collapse selected revision with 'h' key (only collapses, doesn't expand)
		useKeyboardShortcut({
			key: "h",
			modifiers: {},
			onPress: () => {
				if (!selectedRevision) return;

				// Check if already collapsed
				if (!isSelectedExpanded) return; // Do nothing if already collapsed

				// Collapse the revision by removing expanded from URL
				const { expanded, ...restSearch } = search;
				navigate({
					search: restSearch as any,
				});
			},
		});

		const rowVirtualizer = useVirtualizer({
			count: rows.length,
			getScrollElement: () => parentRef.current,
			estimateSize: (index: number) => {
				const row = rows[index];
				const isExpanded =
					isSelectedExpanded && row.revision.change_id === selectedRevision?.change_id;
				return isExpanded ? ROW_HEIGHT * 3 : ROW_HEIGHT;
			},
			overscan: 10,
			debug: debugEnabled,
		});

		// Expose scrollToChangeId method via ref
		useImperativeHandle(ref, () => ({
			scrollToChangeId: (
				changeId: string,
				options?: { align?: "auto" | "center"; smooth?: boolean },
			) => {
				const debug = debugEnabledRef.current;
				const index = changeIdToIndex.get(changeId);
				if (index === undefined) {
					if (debug) console.log("[scroll] changeId not found:", changeId);
					return;
				}

				const scrollElement = parentRef.current;
				if (!scrollElement) {
					if (debug) console.log("[scroll] scrollElement is null");
					return;
				}

				const scrollTop = scrollElement.scrollTop;
				const viewportHeight = scrollElement.clientHeight;
				const scrollHeight = scrollElement.scrollHeight;
				const itemTop = index * ROW_HEIGHT;
				const itemBottom = itemTop + ROW_HEIGHT;

				if (debug) {
					console.log("[scroll] called:", {
						index,
						options,
						scrollTop,
						viewportHeight,
						scrollHeight,
						itemTop,
						itemBottom,
					});
				}

				// For jump commands (smooth/center), always scroll
				if (options?.smooth || options?.align === "center") {
					if (debug) console.log("[scroll] using scrollToIndex (jump)");
					rowVirtualizer.scrollToIndex(index, {
						align: "center",
						behavior: "smooth",
					});
					return;
				}

				// For step navigation, manually scroll only if item is outside viewport
				const isAboveViewport = itemTop < scrollTop;
				const isBelowViewport = itemBottom > scrollTop + viewportHeight;

				if (debug) {
					console.log("[scroll] visibility:", { isAboveViewport, isBelowViewport });
				}

				if (isAboveViewport) {
					const newScrollTop = itemTop;
					if (debug) console.log("[scroll] scrolling UP to:", newScrollTop);
					scrollElement.scrollTop = newScrollTop;
				} else if (isBelowViewport) {
					const newScrollTop = itemBottom - viewportHeight;
					if (debug) console.log("[scroll] scrolling DOWN to:", newScrollTop);
					scrollElement.scrollTop = newScrollTop;
				} else {
					if (debug) console.log("[scroll] item already visible, no scroll needed");
				}
			},
		}));

		function handleSelect(changeId: string) {
			const revision = revisionMap.get(changeId);
			if (revision) onSelectRevision(revision);
		}

		if (revisions.length === 0) {
			return (
				<div className="flex items-center justify-center h-full bg-background text-muted-foreground text-sm">
					{isLoading ? "Loading revisions..." : "Select a project to view revisions"}
				</div>
			);
		}

		const virtualItems = rowVirtualizer.getVirtualItems();
		const visibleStartRow = virtualItems[0]?.index ?? 0;
		const visibleEndRow = virtualItems[virtualItems.length - 1]?.index ?? 0;
		const totalHeight = rowVirtualizer.getTotalSize();
		const rowOffsets = new Map<number, number>();
		for (const item of virtualItems) {
			rowOffsets.set(item.index, item.start);
		}

		const selectedIndex = selectedRevision
			? changeIdToIndex.get(selectedRevision.change_id)
			: undefined;

		return (
			<div
				ref={parentRef}
				className="h-full overflow-auto ascii-bg"
				style={{ overflowAnchor: "none" }}
			>
				<div
					className="relative"
					style={{
						height: `${totalHeight}px`,
						width: "100%",
					}}
				>
					{/* Graph column - positioned absolutely, scrolls with content */}
					<GraphColumn
						nodes={nodes}
						laneCount={laneCount}
						visibleStartRow={visibleStartRow}
						visibleEndRow={visibleEndRow}
						totalHeight={totalHeight}
						rowOffsets={rowOffsets}
					/>

					{/* Virtualized rows */}
					<div className="relative z-10">
						{virtualItems.map((virtualRow) => {
							const row = rows[virtualRow.index];
							const isFlashing = flash?.changeId === row.revision.change_id;
							const isDimmed =
								selectedRevision !== null && !relatedRevisions.has(row.revision.change_id);
							const isFocused = selectedRevision?.change_id === row.revision.change_id;
							const isSelected = isFocused;
							const isExpanded = isSelectedExpanded && isFocused;

							return (
								<div
									key={row.revision.change_id}
									ref={rowVirtualizer.measureElement}
									data-index={virtualRow.index}
									className="absolute left-0 w-full"
									style={{
										transform: `translateY(${virtualRow.start}px)`,
									}}
								>
									<RevisionRow
										revision={row.revision}
										maxLaneOnRow={row.maxLaneOnRow}
										isSelected={isSelected}
										isFocused={isFocused}
										onSelect={handleSelect}
										isFlashing={isFlashing}
										isDimmed={isDimmed}
										isExpanded={isExpanded}
										repoPath={repoPath}
									/>
								</div>
							);
						})}
					</div>
				</div>

				{/* Debug overlay - toggle with Ctrl+Shift+D */}
				<DebugOverlay
					enabled={debugEnabled}
					scrollRef={parentRef}
					selectedIndex={selectedIndex}
					visibleStartRow={visibleStartRow}
					visibleEndRow={visibleEndRow}
					totalRows={rows.length}
				/>
			</div>
		);
	},
);
