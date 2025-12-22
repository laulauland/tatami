import { memo, useCallback, useMemo } from "react";
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
const LANE_WIDTH = 24;
const LANE_PADDING = 12;
const NODE_RADIUS = 5;
const MAX_LANES = 6;

const LANE_COLORS = [
	"hsl(45 100% 55%)", // yellow (main branch)
	"hsl(210 100% 65%)", // bright blue
	"hsl(140 70% 50%)", // green
	"hsl(280 80% 65%)", // purple
	"hsl(180 80% 50%)", // cyan
	"hsl(340 85% 60%)", // pink
];

interface GraphNode {
	revision: Revision;
	row: number;
	lane: number;
	parentConnections: Array<{ parentRow: number; parentLane: number }>;
}

interface GraphData {
	nodes: GraphNode[];
	laneCount: number;
	orderedRevisions: Revision[];
}

export function reorderForGraph(revisions: Revision[]): Revision[] {
	if (revisions.length === 0) return [];

	// Build parent->children map
	const childrenMap = new Map<string, string[]>();
	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));

	for (const rev of revisions) {
		for (const parentId of rev.parent_ids) {
			const children = childrenMap.get(parentId) ?? [];
			children.push(rev.commit_id);
			childrenMap.set(parentId, children);
		}
	}

	// Find heads (commits with no children in our set)
	const heads = revisions.filter((r) => {
		const children = childrenMap.get(r.commit_id) ?? [];
		return children.length === 0 || !children.some((c) => commitMap.has(c));
	});

	// DFS from heads, prioritizing working copy's branch
	const ordered: Revision[] = [];
	const seen = new Set<string>();

	function visit(rev: Revision) {
		if (seen.has(rev.commit_id)) return;
		seen.add(rev.commit_id);
		ordered.push(rev);

		// Visit parents (first parent first for main line)
		for (const parentId of rev.parent_ids) {
			const parent = commitMap.get(parentId);
			if (parent) {
				visit(parent);
			}
		}
	}

	// Find which heads have working copy in their ancestry
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const headsWithWorkingCopy = new Set<string>();

	if (workingCopy) {
		for (const head of heads) {
			// Check if working copy is reachable from this head
			const visited = new Set<string>();
			const stack = [head.commit_id];
			while (stack.length > 0) {
				const id = stack.pop()!;
				if (visited.has(id)) continue;
				visited.add(id);
				if (id === workingCopy.commit_id) {
					headsWithWorkingCopy.add(head.commit_id);
					break;
				}
				const rev = commitMap.get(id);
				if (rev) {
					stack.push(...rev.parent_ids.filter((pid) => commitMap.has(pid)));
				}
			}
		}
	}

	// Sort heads: working copy itself first, then heads containing it, then others
	const sortedHeads = [...heads].sort((a, b) => {
		if (a.is_working_copy) return -1;
		if (b.is_working_copy) return 1;
		const aHasWc = headsWithWorkingCopy.has(a.commit_id);
		const bHasWc = headsWithWorkingCopy.has(b.commit_id);
		if (aHasWc && !bHasWc) return -1;
		if (!aHasWc && bHasWc) return 1;
		return 0;
	});

	for (const head of sortedHeads) {
		visit(head);
	}

	// Add any remaining (shouldn't happen, but safety)
	for (const rev of revisions) {
		if (!seen.has(rev.commit_id)) {
			ordered.push(rev);
		}
	}

	return ordered;
}

function buildGraph(revisions: Revision[]): GraphData {
	if (revisions.length === 0) return { nodes: [], laneCount: 1, orderedRevisions: [] };

	// Reorder: heads first (children before parents), working copy branch prioritized
	const orderedRevisions = reorderForGraph(revisions);

	const commitToRow = new Map<string, number>();
	const commitToLane = new Map<string, number>();
	const nodes: GraphNode[] = [];

	orderedRevisions.forEach((rev, idx) => commitToRow.set(rev.commit_id, idx));

	const activeLanes: (string | null)[] = [null];

	function claimLane(commitId: string, preferredLane?: number): number {
		if (
			preferredLane !== undefined &&
			preferredLane < activeLanes.length &&
			activeLanes[preferredLane] === null
		) {
			activeLanes[preferredLane] = commitId;
			return preferredLane;
		}
		for (let i = 0; i < activeLanes.length; i++) {
			if (activeLanes[i] === null) {
				activeLanes[i] = commitId;
				return i;
			}
		}
		if (activeLanes.length < MAX_LANES) {
			activeLanes.push(commitId);
			return activeLanes.length - 1;
		}
		return MAX_LANES - 1;
	}

	for (let row = 0; row < orderedRevisions.length; row++) {
		const revision = orderedRevisions[row];

		let lane = commitToLane.get(revision.commit_id);
		if (lane === undefined) {
			// First branch gets lane 0 (working copy's branch due to our ordering)
			const preferLane = row === 0 ? 0 : undefined;
			lane = claimLane(revision.commit_id, preferLane);
			commitToLane.set(revision.commit_id, lane);
		} else {
			activeLanes[lane] = revision.commit_id;
		}

		const parentConnections: GraphNode["parentConnections"] = [];
		const parentRows = revision.parent_ids
			.map((pid) => ({ id: pid, row: commitToRow.get(pid) }))
			.filter((p): p is { id: string; row: number } => p.row !== undefined);

		for (let i = 0; i < parentRows.length; i++) {
			const { id: parentId, row: parentRow } = parentRows[i];

			let parentLane = commitToLane.get(parentId);
			if (parentLane === undefined) {
				parentLane = i === 0 ? lane : claimLane(parentId);
				commitToLane.set(parentId, parentLane);
			}

			parentConnections.push({ parentRow, parentLane });
		}

		if (parentRows.length === 0 && lane < activeLanes.length) {
			activeLanes[lane] = null;
		}

		nodes.push({ revision, row, lane, parentConnections });
	}

	return { nodes, laneCount: Math.min(activeLanes.length, MAX_LANES), orderedRevisions };
}

function laneToX(lane: number): number {
	return LANE_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function laneColor(lane: number): string {
	return LANE_COLORS[lane % LANE_COLORS.length];
}

function GraphColumn({ nodes, laneCount }: { nodes: GraphNode[]; laneCount: number }) {
	const height = nodes.length * ROW_HEIGHT;
	const width = LANE_PADDING * 2 + laneCount * LANE_WIDTH;

	return (
		<svg width={width} height={height} className="shrink-0" role="img" aria-label="Revision graph">
			<title>Revision graph</title>
			{/* Edges */}
			{nodes.map((node) => {
				const y = node.row * ROW_HEIGHT + ROW_HEIGHT / 2;
				const x = laneToX(node.lane);
				const color = laneColor(node.lane);

				return (
					<g key={`edges-${node.revision.change_id}`}>
						{node.parentConnections.map((conn, idx) => {
							const parentY = conn.parentRow * ROW_HEIGHT + ROW_HEIGHT / 2;
							const parentX = laneToX(conn.parentLane);
							const edgeColor = laneColor(conn.parentLane);

							if (node.lane === conn.parentLane) {
								return (
									<line
										key={idx}
										x1={x}
										y1={y + NODE_RADIUS}
										x2={parentX}
										y2={parentY - NODE_RADIUS}
										stroke={color}
										strokeWidth={2}
									/>
								);
							}

							// Curved path for cross-lane connections
							const midY = (y + parentY) / 2;
							return (
								<path
									key={idx}
									d={`M ${x} ${y + NODE_RADIUS}
									    C ${x} ${midY}, ${parentX} ${midY}, ${parentX} ${parentY - NODE_RADIUS}`}
									fill="none"
									stroke={edgeColor}
									strokeWidth={2}
									strokeOpacity={0.8}
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
				const isWorkingCopy = node.revision.is_working_copy;
				const color = laneColor(node.lane);

				if (isWorkingCopy) {
					return (
						<g key={node.revision.change_id}>
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

				return <circle key={node.revision.change_id} cx={x} cy={y} r={NODE_RADIUS} fill={color} />;
			})}
		</svg>
	);
}

const RevisionRow = memo(function RevisionRow({
	revision,
	isSelected,
	onSelect,
	isFlashing,
}: {
	revision: Revision;
	isSelected: boolean;
	onSelect: (changeId: string) => void;
	isFlashing: boolean;
}) {
	const description = revision.description.split("\n")[0] || "(no description)";

	return (
		<Button
			variant="ghost"
			onClick={() => onSelect(revision.change_id)}
			data-change-id={revision.change_id}
			style={{ height: ROW_HEIGHT }}
			className={`w-full justify-start text-left px-2 animate-in fade-in slide-in-from-left-1 duration-150 rounded-sm focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-0 focus-visible:ring-offset-0 ${
				isSelected ? "bg-accent text-accent-foreground" : ""
			} ${revision.is_immutable ? "opacity-60" : ""}`}
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
	);
});

export function RevisionGraph({
	revisions,
	selectedRevision,
	onSelectRevision,
	isLoading,
	flash,
}: RevisionGraphProps) {
	const { nodes, laneCount, orderedRevisions } = useMemo(() => buildGraph(revisions), [revisions]);

	const revisionMap = useMemo(() => new Map(revisions.map((r) => [r.change_id, r])), [revisions]);

	const handleSelect = useCallback(
		(changeId: string) => {
			const revision = revisionMap.get(changeId);
			if (revision) onSelectRevision(revision);
		},
		[revisionMap, onSelectRevision],
	);

	if (revisions.length === 0) {
		return (
			<div className="flex items-center justify-center h-full bg-background text-muted-foreground text-sm">
				{isLoading ? "Loading revisions..." : "Select a project to view revisions"}
			</div>
		);
	}

	return (
		<ScrollArea className="h-full bg-background">
			<div className="flex">
				<GraphColumn nodes={nodes} laneCount={laneCount} />
				<div className="flex-1 min-w-0">
					{orderedRevisions.map((revision) => {
						const isFlashing = flash?.changeId === revision.change_id;
						return (
							<RevisionRow
								key={isFlashing ? `${revision.change_id}-${flash.key}` : revision.change_id}
								revision={revision}
								isSelected={selectedRevision?.change_id === revision.change_id}
								onSelect={handleSelect}
								isFlashing={isFlashing}
							/>
						);
					})}
				</div>
			</div>
		</ScrollArea>
	);
}
