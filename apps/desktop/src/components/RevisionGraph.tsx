import { useAtom } from "@effect-atom/atom-react";
import { useSearch } from "@tanstack/react-router";
import { expandedElidedSectionsAtom } from "@/atoms";
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

type GraphEdgeType = "direct" | "indirect";

interface ParentConnection {
	parentRow: number;
	parentLane: number;
	edgeType: GraphEdgeType;
}

type GraphNodeType = "revision" | "elided";

interface ElidedInfo {
	id: string;
	elidedRevisions: Revision[];
}

interface GraphNode {
	type: GraphNodeType;
	revision: Revision | null;
	elidedInfo: ElidedInfo | null;
	row: number;
	lane: number;
	parentConnections: ParentConnection[];
}

interface GraphRow {
	type: GraphNodeType;
	revision: Revision | null;
	elidedInfo: ElidedInfo | null;
	lane: number;
}

interface GraphData {
	nodes: GraphNode[];
	laneCount: number;
	rows: GraphRow[];
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

	// Prioritize working copy - it should be visited first
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const sortedHeads = [...heads].sort((a, b) => {
		if (a.is_working_copy) return -1;
		if (b.is_working_copy) return 1;
		// If working copy is an ancestor of a head, prioritize that head
		return 0;
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

	// Visit working copy first to ensure its chain is ordered first
	if (workingCopy) {
		visit(workingCopy);
	}

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
				// Follow first parent only for the main chain
				if (rev.parent_ids.length > 0 && commitMap.has(rev.parent_ids[0])) {
					queue.push(rev.parent_ids[0]);
				}
			}
		}
	}

	return chain;
}

function computeElision(revisions: Revision[], expandedSections: string[]): GraphRow[] {
	if (revisions.length === 0) return [];

	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));
	const childrenMap = new Map<string, string[]>();
	for (const rev of revisions) {
		for (const parentId of rev.parent_ids) {
			const children = childrenMap.get(parentId) ?? [];
			children.push(rev.commit_id);
			childrenMap.set(parentId, children);
		}
	}

	// Find trunk head (first immutable commit with a trunk bookmark)
	const trunkHead = revisions.find(
		(r) => r.is_immutable && r.bookmarks.some((b) => ["main", "master", "trunk"].includes(b)),
	);

	// Find working copy and its ancestors (the main work branch)
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const workBranchIds = new Set<string>();
	if (workingCopy) {
		const queue = [workingCopy.commit_id];
		while (queue.length > 0) {
			const id = queue.shift();
			if (!id) continue;
			if (workBranchIds.has(id)) continue;
			workBranchIds.add(id);
			const rev = commitMap.get(id);
			if (rev) {
				for (const parentId of rev.parent_ids) {
					if (commitMap.has(parentId)) {
						queue.push(parentId);
					}
				}
			}
		}
	}

	// Identify immutable backbone (commits from trunk head to root)
	const immutableBackbone = new Set<string>();
	if (trunkHead) {
		const queue = [trunkHead.commit_id];
		while (queue.length > 0) {
			const id = queue.shift();
			if (!id) continue;
			if (immutableBackbone.has(id)) continue;
			const rev = commitMap.get(id);
			if (rev?.is_immutable) {
				immutableBackbone.add(id);
				for (const parentId of rev.parent_ids) {
					if (commitMap.has(parentId)) {
						queue.push(parentId);
					}
				}
			}
		}
	}

	// Determine which revisions to show vs elide
	// Show: working copy branch, trunk head, heads of other branches, merge points
	const visibleIds = new Set<string>();

	for (const rev of revisions) {
		const isHead =
			(childrenMap.get(rev.commit_id)?.length ?? 0) === 0 ||
			!childrenMap.get(rev.commit_id)?.some((c) => commitMap.has(c));
		const isMerge = rev.parent_ids.length > 1;
		const isBranchPoint =
			(childrenMap.get(rev.commit_id)?.filter((c) => commitMap.has(c))?.length ?? 0) > 1;
		const isTrunkHead = rev.commit_id === trunkHead?.commit_id;
		const isOnWorkBranch = workBranchIds.has(rev.commit_id);

		if (
			rev.is_working_copy ||
			isHead ||
			isMerge ||
			isBranchPoint ||
			isTrunkHead ||
			isOnWorkBranch ||
			rev.bookmarks.length > 0
		) {
			visibleIds.add(rev.commit_id);
		}
	}

	// Group consecutive elided immutable commits
	const rows: GraphRow[] = [];
	const orderedRevisions = reorderForGraph(revisions);
	let currentElidedGroup: Revision[] = [];
	let elidedGroupParentId: string | null = null;

	function flushElidedGroup(elidedId: string) {
		if (currentElidedGroup.length === 0) return;
		const isExpanded = expandedSections.includes(elidedId);
		rows.push({
			type: "elided",
			revision: null,
			elidedInfo: { id: elidedId, elidedRevisions: [...currentElidedGroup] },
			lane: 0,
		});
		if (isExpanded) {
			for (const elidedRev of currentElidedGroup) {
				rows.push({ type: "revision", revision: elidedRev, elidedInfo: null, lane: 0 });
			}
		}
		currentElidedGroup = [];
	}

	for (const rev of orderedRevisions) {
		if (visibleIds.has(rev.commit_id)) {
			flushElidedGroup(`elided-${elidedGroupParentId ?? "root"}`);
			rows.push({ type: "revision", revision: rev, elidedInfo: null, lane: 0 });
			elidedGroupParentId = rev.commit_id;
		} else {
			currentElidedGroup.push(rev);
		}
	}

	flushElidedGroup(`elided-${elidedGroupParentId ?? "root"}-final`);

	return rows;
}

function buildGraph(revisions: Revision[], expandedSections: string[]): GraphData {
	if (revisions.length === 0) return { nodes: [], laneCount: 1, rows: [] };

	// Map commit_id -> Revision for ancestry lookups
	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));

	// Compute which revisions to show vs elide
	const rows = computeElision(revisions, expandedSections);

	// Build set of visible commit IDs for edge type detection
	const visibleCommitIds = new Set(
		rows
			.filter(
				(r): r is GraphRow & { revision: Revision } => r.type === "revision" && r.revision !== null,
			)
			.map((r) => r.revision.commit_id),
	);

	// Walk up the ancestry from a (possibly elided) parent to the next visible ancestor
	function findVisibleAncestor(startId: string): string | null {
		let currentId: string | undefined = startId;
		const visited = new Set<string>();
		const MAX_STEPS = 1000;

		while (currentId) {
			if (visibleCommitIds.has(currentId)) {
				return currentId;
			}

			if (visited.has(currentId)) break;
			visited.add(currentId);

			const rev = commitMap.get(currentId);
			if (!rev || rev.parent_ids.length === 0) break;

			// Prefer first parent, fall back to any parent present in this revision set
			let nextId: string | undefined;
			for (const pid of rev.parent_ids) {
				if (commitMap.has(pid)) {
					nextId = pid;
					break;
				}
			}
			if (!nextId) break;

			currentId = nextId;

			if (visited.size > MAX_STEPS) break;
		}

		return null;
	}

	// Get working copy chain - these commits should all be in lane 0
	const workingCopyChain = getWorkingCopyChain(revisions);

	// Build row index maps
	const commitToRow = new Map<string, number>();
	const elidedToRow = new Map<string, number>();
	rows.forEach((row, idx) => {
		if (row.type === "revision" && row.revision) {
			commitToRow.set(row.revision.commit_id, idx);
		} else if (row.type === "elided" && row.elidedInfo) {
			elidedToRow.set(row.elidedInfo.id, idx);
		}
	});

	const commitToLane = new Map<string, number>();
	const elidedToLane = new Map<string, number>();
	const nodes: GraphNode[] = [];
	const activeLanes: (string | null)[] = [null];

	// Pre-assign lane 0 to working copy chain
	for (const commitId of workingCopyChain) {
		commitToLane.set(commitId, 0);
	}

	function claimLane(id: string, preferredLane?: number): number {
		// If already assigned (e.g., working copy chain), return that lane
		const existing = commitToLane.get(id);
		if (existing !== undefined) return existing;

		if (
			preferredLane !== undefined &&
			preferredLane < activeLanes.length &&
			activeLanes[preferredLane] === null
		) {
			activeLanes[preferredLane] = id;
			return preferredLane;
		}
		// For non-working-copy commits, start from lane 1
		const startLane = workingCopyChain.size > 0 ? 1 : 0;
		for (let i = startLane; i < activeLanes.length; i++) {
			if (activeLanes[i] === null) {
				activeLanes[i] = id;
				return i;
			}
		}
		if (activeLanes.length < MAX_LANES) {
			activeLanes.push(id);
			return activeLanes.length - 1;
		}
		return MAX_LANES - 1;
	}

	for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
		const row = rows[rowIdx];

		if (row.type === "revision" && row.revision) {
			const revision = row.revision;

			let lane = commitToLane.get(revision.commit_id);
			if (lane === undefined) {
				// Working copy chain gets lane 0, others get lanes 1+
				const isOnWorkingCopyChain = workingCopyChain.has(revision.commit_id);
				const preferLane = isOnWorkingCopyChain ? 0 : undefined;
				lane = claimLane(revision.commit_id, preferLane);
				commitToLane.set(revision.commit_id, lane);
			}
			// Update active lane
			while (activeLanes.length <= lane) {
				activeLanes.push(null);
			}
			activeLanes[lane] = revision.commit_id;

			const parentConnections: ParentConnection[] = [];

			for (let i = 0; i < revision.parent_ids.length; i++) {
				const parentId = revision.parent_ids[i];

				if (visibleCommitIds.has(parentId)) {
					// Direct edge to visible parent
					const parentRow = commitToRow.get(parentId);
					if (parentRow !== undefined) {
						let parentLane = commitToLane.get(parentId);
						if (parentLane === undefined) {
							parentLane = i === 0 ? lane : claimLane(parentId);
							commitToLane.set(parentId, parentLane);
						}
						parentConnections.push({ parentRow, parentLane, edgeType: "direct" });
					}
					continue;
				}

				// Parent is elided - walk up to the next visible ancestor
				const ancestorId = findVisibleAncestor(parentId);
				if (!ancestorId) continue;

				const parentRow = commitToRow.get(ancestorId);
				if (parentRow === undefined) continue;

				let parentLane = commitToLane.get(ancestorId);
				if (parentLane === undefined) {
					parentLane = i === 0 ? lane : claimLane(ancestorId);
					commitToLane.set(ancestorId, parentLane);
				}

				parentConnections.push({ parentRow, parentLane, edgeType: "indirect" });
			}

			if (revision.parent_ids.length === 0 && lane < activeLanes.length) {
				activeLanes[lane] = null;
			}

			nodes.push({
				type: "revision",
				revision,
				elidedInfo: null,
				row: rowIdx,
				lane,
				parentConnections,
			});
		} else if (row.type === "elided" && row.elidedInfo) {
			const elidedInfo = row.elidedInfo;
			let lane = elidedToLane.get(elidedInfo.id);
			if (lane === undefined) {
				// Inherit lane from previous visible node or use lane 0
				const prevNode = nodes[nodes.length - 1];
				lane = prevNode?.lane ?? 0;
				elidedToLane.set(elidedInfo.id, lane);
			}

			nodes.push({
				type: "elided",
				revision: null,
				elidedInfo,
				row: rowIdx,
				lane,
				parentConnections: [],
			});
		}
	}

	// Update rows with computed lane info from nodes
	for (const node of nodes) {
		const row = rows[node.row];
		if (row) {
			row.lane = node.lane;
		}
	}

	return { nodes, laneCount: Math.min(activeLanes.length, MAX_LANES), rows };
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
	// Minimal right padding - just enough for the rightmost node
	const width = LANE_PADDING + laneCount * LANE_WIDTH + NODE_RADIUS + 4;

	return (
		<svg width={width} height={height} className="shrink-0" role="img" aria-label="Revision graph">
			<title>Revision graph</title>
			{/* Edges */}
			{nodes.map((node) => {
				if (node.type === "elided") return null;

				const y = node.row * ROW_HEIGHT + ROW_HEIGHT / 2;
				const x = laneToX(node.lane);
				const color = laneColor(node.lane);
				const nodeKey = node.revision?.change_id ?? node.elidedInfo?.id ?? `node-${node.row}`;

				return (
					<g key={`edges-${nodeKey}`}>
						{node.parentConnections.map((conn, idx) => {
							const parentY = conn.parentRow * ROW_HEIGHT + ROW_HEIGHT / 2;
							const parentX = laneToX(conn.parentLane);
							const edgeColor = laneColor(conn.parentLane);
							const isDashed = conn.edgeType === "indirect";

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
										strokeDasharray={isDashed ? "4 4" : undefined}
									/>
								);
							}

							// Squared path for cross-lane connections (like jj CLI)
							// Go down one row, then horizontal, then down to parent
							const cornerRadius = 6;
							const turnY = y + ROW_HEIGHT; // Turn point one row below current node

							// Path: down from node, curve corner, horizontal, curve corner, down to parent
							const goingRight = parentX > x;
							const horizontalDir = goingRight ? 1 : -1;

							return (
								<path
									key={idx}
									d={`M ${x} ${y + NODE_RADIUS}
										L ${x} ${turnY - cornerRadius}
										Q ${x} ${turnY}, ${x + cornerRadius * horizontalDir} ${turnY}
										L ${parentX - cornerRadius * horizontalDir} ${turnY}
										Q ${parentX} ${turnY}, ${parentX} ${turnY + cornerRadius}
										L ${parentX} ${parentY - NODE_RADIUS}`}
									fill="none"
									stroke={edgeColor}
									strokeWidth={2}
									strokeOpacity={0.8}
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
				const isSelected = node.revision?.change_id === selectedChangeId;

				// Elided placeholder node - render ~ symbol
				if (node.type === "elided") {
					return (
						<g key={node.elidedInfo?.id ?? `elided-${node.row}`}>
							<text
								x={x}
								y={y}
								textAnchor="middle"
								dominantBaseline="central"
								fill={color}
								fontWeight="bold"
								fontSize="14"
								opacity={0.7}
							>
								~
							</text>
						</g>
					);
				}

				const isWorkingCopy = node.revision?.is_working_copy ?? false;
				const isImmutable = node.revision?.is_immutable ?? false;

				if (isWorkingCopy) {
					return (
						<g key={node.revision?.change_id}>
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
						<g key={node.revision?.change_id}>
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
					<g key={node.revision?.change_id}>
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
}

function extractCommitTypes(revisions: Revision[]): string[] {
	const typeCounts = new Map<string, number>();
	const conventionalTypes = [
		"feat",
		"fix",
		"docs",
		"style",
		"refactor",
		"perf",
		"test",
		"build",
		"ci",
		"chore",
		"revert",
	];

	for (const rev of revisions) {
		const firstLine = rev.description.split("\n")[0];
		const colonIdx = firstLine.indexOf(":");
		if (colonIdx > 0) {
			let typeStr = firstLine.slice(0, colonIdx);
			const parenIdx = typeStr.indexOf("(");
			if (parenIdx > 0) typeStr = typeStr.slice(0, parenIdx);
			typeStr = typeStr.trim().toLowerCase();
			if (conventionalTypes.includes(typeStr)) {
				typeCounts.set(typeStr, (typeCounts.get(typeStr) ?? 0) + 1);
			}
		}
	}

	return [...typeCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([type]) => type);
}

function formatTimeRange(revisions: Revision[]): string {
	if (revisions.length === 0) return "";

	const timestamps = revisions.map((r) => r.timestamp);
	if (timestamps.length === 1) return timestamps[0];

	// Just show the range of relative times
	const first = timestamps[0];
	const last = timestamps[timestamps.length - 1];
	if (first === last) return first;
	return `${first} - ${last}`;
}

function ElidedRow({
	elidedInfo,
	isExpanded,
	onToggle,
}: {
	elidedInfo: ElidedInfo;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const count = elidedInfo.elidedRevisions.length;
	const types = extractCommitTypes(elidedInfo.elidedRevisions);
	const timeRange = formatTimeRange(elidedInfo.elidedRevisions);

	const typesStr = types.length > 0 ? ` · ${types.join(", ")}` : "";
	const timeStr = timeRange ? ` · ${timeRange}` : "";

	return (
		<button
			type="button"
			style={{ height: ROW_HEIGHT }}
			className="flex items-center px-2 text-muted-foreground text-xs opacity-60 cursor-pointer hover:opacity-80 w-full text-left bg-transparent border-none"
			onClick={onToggle}
		>
			<span className="font-mono">
				{isExpanded ? "▾" : "▸"} {count} commit{count !== 1 ? "s" : ""}
				{typesStr}
				{timeStr}
			</span>
		</button>
	);
}

export function RevisionGraph({
	revisions,
	selectedRevision,
	onSelectRevision,
	isLoading,
	flash,
}: RevisionGraphProps) {
	const [expandedSections, setExpandedSections] = useAtom(expandedElidedSectionsAtom);
	const { nodes, laneCount, rows } = buildGraph(revisions, expandedSections);

	const revisionMap = new Map(revisions.map((r) => [r.change_id, r]));

	function handleSelect(changeId: string) {
		const revision = revisionMap.get(changeId);
		if (revision) onSelectRevision(revision);
	}

	function toggleExpanded(elidedId: string) {
		if (expandedSections.includes(elidedId)) {
			setExpandedSections(expandedSections.filter((id) => id !== elidedId));
		} else {
			setExpandedSections([...expandedSections, elidedId]);
		}
	}

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
					{rows.map((row) => {
						if (row.type === "revision" && row.revision) {
							const isFlashing = flash?.changeId === row.revision.change_id;
							return (
								<RevisionRow
									key={row.revision.change_id}
									revision={row.revision}
									isSelected={selectedRevision?.change_id === row.revision.change_id}
									onSelect={handleSelect}
									isFlashing={isFlashing}
								/>
							);
						}
						if (row.type === "elided" && row.elidedInfo) {
							const isExpanded = expandedSections.includes(row.elidedInfo.id);
							return (
								<ElidedRow
									key={row.elidedInfo.id}
									elidedInfo={row.elidedInfo}
									isExpanded={isExpanded}
									onToggle={() => row.elidedInfo && toggleExpanded(row.elidedInfo.id)}
								/>
							);
						}
						return null;
					})}
				</div>
			</div>
		</ScrollArea>
	);
}
