import { useSearch } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Revision } from "@/tauri-commands";

interface RevisionGraphProps {
	revisions: Revision[];
	selectedRevision: Revision | null;
	onSelectRevision: (revision: Revision) => void;
	isLoading: boolean;
	flash?: { changeId: string; key: number } | null;
}

const ROW_HEIGHT = 56;
const LANE_WIDTH = 20;
const LANE_PADDING = 8;
const NODE_RADIUS = 5;
const MAX_LANES = 3;

const LANE_COLORS = [
	"hsl(45 100% 55%)", // yellow (main branch)
	"hsl(210 100% 65%)", // bright blue
	"hsl(140 70% 50%)", // green
	"hsl(280 80% 65%)", // purple
	"hsl(180 80% 50%)", // cyan
	"hsl(340 85% 60%)", // pink
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

function GraphColumn({ nodes, laneCount }: { nodes: GraphNode[]; laneCount: number }) {
	const { rev: selectedChangeId } = useSearch({ strict: false });
	const height = nodes.length * ROW_HEIGHT;
	// Minimal right padding - tight fit for the rightmost node
	const width = LANE_PADDING + laneCount * LANE_WIDTH + NODE_RADIUS + 2;

	return (
		<svg width={width} height={height} className="shrink-0" role="img" aria-label="Revision graph">
			<title>Revision graph</title>
			{/* Edges */}
			{nodes.map((node) => {
				const y = node.row * ROW_HEIGHT + ROW_HEIGHT / 2;
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
							const strokeColor = conn.isDeemphasized ? "#888" : edgeColor;

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

							const parentY = conn.parentRow * ROW_HEIGHT + ROW_HEIGHT / 2;
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

			{/* Nodes */}
			{nodes.map((node) => {
				const y = node.row * ROW_HEIGHT + ROW_HEIGHT / 2;
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
}: {
	revision: Revision;
	maxLaneOnRow: number;
	isSelected: boolean;
	onSelect: (changeId: string) => void;
	isFlashing: boolean;
	isDimmed: boolean;
}) {
	const description = revision.description.split("\n")[0] || "(no description)";
	// Indent row to position text after the rightmost graph element on this row
	const indent = LANE_PADDING + (maxLaneOnRow + 1) * LANE_WIDTH + NODE_RADIUS + 4;

	return (
		<div style={{ height: ROW_HEIGHT }} className="flex items-center">
			<div style={{ width: indent }} className="shrink-0" />
			<div
				className={`flex-1 mr-2 revision-row-3d transition-opacity duration-150 ${revision.is_immutable ? "opacity-60" : ""} ${isDimmed ? "opacity-40" : ""}`}
			>
				<Button
					variant="ghost"
					onClick={() => onSelect(revision.change_id)}
					data-change-id={revision.change_id}
					className={`w-full h-full justify-start text-left px-3 py-2 animate-in fade-in slide-in-from-left-1 duration-150 rounded focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 hover:bg-transparent ${
						isSelected ? "bg-accent/50 text-accent-foreground" : ""
					}`}
				>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 flex-wrap">
							<code
								className={`text-xs font-mono text-muted-foreground rounded px-0.5 ${
									isFlashing ? "bg-green-500/50 animate-pulse" : ""
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
							<span className="text-xs text-muted-foreground">
								{revision.author.split("@")[0]} · {revision.timestamp}
							</span>
						</div>
						<div className="text-sm truncate">{description}</div>
					</div>
				</Button>
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

export function RevisionGraph({
	revisions,
	selectedRevision,
	onSelectRevision,
	isLoading,
	flash,
}: RevisionGraphProps) {
	const { nodes, laneCount, rows } = buildGraph(revisions);

	const revisionMap = new Map(revisions.map((r) => [r.change_id, r]));
	const relatedRevisions = getRelatedRevisions(revisions, selectedRevision?.change_id ?? null);

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

	return (
		<ScrollArea className="h-full ascii-bg">
			<div className="relative py-1">
				<div className="absolute top-0 left-0 z-0 pointer-events-none">
					<GraphColumn nodes={nodes} laneCount={laneCount} />
				</div>
				<div className="relative z-10">
					{rows.map((row) => {
						const isFlashing = flash?.changeId === row.revision.change_id;
						const isDimmed =
							selectedRevision !== null && !relatedRevisions.has(row.revision.change_id);
						return (
							<RevisionRow
								key={row.revision.change_id}
								revision={row.revision}
								maxLaneOnRow={row.maxLaneOnRow}
								isSelected={selectedRevision?.change_id === row.revision.change_id}
								onSelect={handleSelect}
								isFlashing={isFlashing}
								isDimmed={isDimmed}
							/>
						);
					})}
				</div>
			</div>
		</ScrollArea>
	);
}
