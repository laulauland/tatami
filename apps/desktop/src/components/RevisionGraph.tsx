import { useAtom } from "@effect-atom/atom-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { expandedStacksAtom, inlineJumpQueryAtom } from "@/atoms";
import { ChangedFilesList } from "@/components/ChangedFilesList";
import { reorderForGraph, detectStacks, computeRevisionAncestry, type RevisionStack } from "@/components/revision-graph-utils";
import { prefetchRevisionDiffs } from "@/db";
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
	wcIndex,
	selectedChangeId,
	wcChangeId,
}: {
	enabled: boolean;
	scrollRef: React.RefObject<HTMLDivElement | null>;
	selectedIndex: number | undefined;
	visibleStartRow: number;
	visibleEndRow: number;
	totalRows: number;
	wcIndex: number | undefined;
	selectedChangeId: string | undefined;
	wcChangeId: string | undefined;
}) {
	// Force re-render on scroll/resize/focus
	const [, forceUpdate] = useState(0);

	const prevScrollTop = useRef<number>(0);

	useEffect(() => {
		if (!enabled) return;
		const el = scrollRef.current;
		if (!el) return;

		const update = () => {
			const newScrollTop = el.scrollTop;
			if (Math.abs(newScrollTop - prevScrollTop.current) > 100) {
				console.log("[scroll] jump detected:", {
					from: prevScrollTop.current.toFixed(0),
					to: newScrollTop.toFixed(0),
					delta: (newScrollTop - prevScrollTop.current).toFixed(0),
				});
			}
			prevScrollTop.current = newScrollTop;
			forceUpdate((n) => n + 1);
		};
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
		wcIndex,
		itemTop: selectedItemTop,
		itemBottom: selectedItemBottom,
		distFromTop: distanceFromTop,
		distFromBottom: distanceFromBottom,
		isInViewport,
		virtualRange: `${visibleStartRow}-${visibleEndRow}`,
		totalRows,
		ROW_HEIGHT,
		activeElement,
		selected: selectedChangeId?.slice(0, 4),
		wc: wcChangeId?.slice(0, 4),
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
				<div>wcIndex: {wcIndex ?? "none"}</div>
				<div>selected: {selectedChangeId?.slice(0, 4) ?? "none"}</div>
				<div>wc: {wcChangeId?.slice(0, 4) ?? "none"}</div>
				<div className="border-t border-green-800 my-2" />
				<div>itemTop: {selectedItemTop}</div>
				<div>itemBottom: {selectedItemBottom}</div>
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
	pendingAbandon?: Revision | null;
}

const ROW_HEIGHT = 64;
const COLLAPSED_INDICATOR_HEIGHT = 32;
const LANE_WIDTH = 20;
const LANE_PADDING = 8;
const NODE_RADIUS = 5;
const MAX_LANES = 2;

const LANE_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
	"var(--primary)",
];

type GraphEdgeType = "direct" | "indirect" | "missing";

// ============================================================================
// Semantic Graph Components (tldraw-inspired architecture)
// ============================================================================

// Represents a semantic binding between two revisions (like tldraw's shape bindings)
interface EdgeBinding {
	id: string;
	sourceRevisionId: string;
	targetRevisionId: string;
	sourceLane: number;
	targetLane: number;
	edgeType: GraphEdgeType;
	isDeemphasized?: boolean;
	isMissingStub?: boolean;
	/** If set, this edge represents a collapsed stack and clicking it should expand */
	collapsedStackId?: string;
	/** Number of hidden revisions in the collapsed stack */
	collapsedCount?: number;
	/** If set, this edge is part of an expanded stack and clicking it should collapse */
	expandedStackId?: string;
}

interface GraphNodeProps {
	revision: Revision;
	lane: number;
	isSelected: boolean;
	color: string;
}

// GraphNode - Semantic node component rendered inline with each row
// Uses inline SVG for proper accessibility (avoids role="img" on divs)
function GraphNode({ revision, lane, isSelected, color }: GraphNodeProps) {
	const isWorkingCopy = revision.is_working_copy;
	const isImmutable = revision.is_immutable;
	
	const size = isWorkingCopy ? NODE_RADIUS * 2 + 6 : NODE_RADIUS * 2;
	const selectedRingSize = isWorkingCopy ? NODE_RADIUS + 6 : NODE_RADIUS + 4;

	// Working copy: @ symbol with glow
	if (isWorkingCopy) {
		return (
			<svg
				width={size + 8}
				height={size + 8}
				viewBox={`0 0 ${size + 8} ${size + 8}`}
				className="shrink-0"
				aria-label={`Working copy revision ${revision.change_id_short}`}
				data-revision-id={revision.change_id}
				data-lane={lane}
			>
				<title>Working copy: {revision.change_id_short}</title>
				{isSelected && (
					<circle
						cx={(size + 8) / 2}
						cy={(size + 8) / 2}
						r={selectedRingSize}
						fill={color}
						fillOpacity={0.3}
					/>
				)}
				<circle
					cx={(size + 8) / 2}
					cy={(size + 8) / 2}
					r={NODE_RADIUS + 3}
					fill={color}
					fillOpacity={0.2}
				/>
				<text
					x={(size + 8) / 2}
					y={(size + 8) / 2}
					textAnchor="middle"
					dominantBaseline="central"
					fill={color}
					fontWeight="bold"
					fontSize="12"
				>
					@
				</text>
			</svg>
		);
	}

	// Immutable: diamond shape
	if (isImmutable) {
		return (
			<svg
				width={size + 8}
				height={size + 8}
				viewBox={`0 0 ${size + 8} ${size + 8}`}
				className="shrink-0"
				aria-label={`Immutable revision ${revision.change_id_short}`}
				data-revision-id={revision.change_id}
				data-lane={lane}
			>
				<title>Immutable: {revision.change_id_short}</title>
				{isSelected && (
					<circle
						cx={(size + 8) / 2}
						cy={(size + 8) / 2}
						r={selectedRingSize}
						fill={color}
						fillOpacity={0.3}
					/>
				)}
				<rect
					x={(size + 8) / 2 - NODE_RADIUS}
					y={(size + 8) / 2 - NODE_RADIUS}
					width={NODE_RADIUS * 2}
					height={NODE_RADIUS * 2}
					fill={color}
					transform={`rotate(45 ${(size + 8) / 2} ${(size + 8) / 2})`}
				/>
			</svg>
		);
	}

	// Regular mutable: circle
	return (
		<svg
			width={size + 8}
			height={size + 8}
			viewBox={`0 0 ${size + 8} ${size + 8}`}
			className="shrink-0"
			aria-label={`Revision ${revision.change_id_short}`}
			data-revision-id={revision.change_id}
			data-lane={lane}
		>
			<title>Revision: {revision.change_id_short}</title>
			{isSelected && (
				<circle
					cx={(size + 8) / 2}
					cy={(size + 8) / 2}
					r={selectedRingSize}
					fill={color}
					fillOpacity={0.3}
				/>
			)}
			<circle
				cx={(size + 8) / 2}
				cy={(size + 8) / 2}
				r={NODE_RADIUS}
				fill={color}
			/>
		</svg>
	);
}

interface GraphEdgeProps {
	binding: EdgeBinding;
	sourceY: number;
	targetY: number;
	sourceRevision: Revision;
	targetRevision: Revision | null;
	stackTopY?: number;
	stackBottomY?: number;
	onToggleStack?: (stackId: string) => void;
}

// GraphEdge - Semantic edge component with source/target revision bindings
function GraphEdge({ binding, sourceY, targetY, sourceRevision, targetRevision, stackTopY, stackBottomY, onToggleStack }: GraphEdgeProps) {
	const { sourceLane, targetLane, edgeType, isDeemphasized, isMissingStub, collapsedStackId, collapsedCount, expandedStackId } = binding;
	
	const sourceX = laneToX(sourceLane);
	const targetX = laneToX(targetLane);
	const sourceColor = laneColor(sourceLane);
	const targetColor = laneColor(targetLane);

	// Style based on edge type
	const isDashed = edgeType === "indirect";
	const isMissing = edgeType === "missing";
	const strokeWidth = isDeemphasized ? 1 : 2;
	const strokeOpacity = isDeemphasized ? 0.4 : isMissing ? 0.3 : 0.8;
	const strokeColor = isDeemphasized ? "var(--muted-foreground)" : targetColor;

	// Accessibility label describing the connection
	const ariaLabel = isMissingStub
		? `${sourceRevision.change_id_short} has parent outside current view`
		: targetRevision
			? `${sourceRevision.change_id_short} → ${targetRevision.change_id_short}${edgeType === "indirect" ? " (indirect)" : ""}`
			: `Edge from ${sourceRevision.change_id_short}`;

	// Missing stub: short dashed line indicating parent outside view
	if (isMissingStub) {
		const stubLength = ROW_HEIGHT * 0.4;
		return (
			<g aria-label={ariaLabel} style={{ pointerEvents: "none" }}>
				<title>{ariaLabel}</title>
				<line
					x1={sourceX}
					y1={sourceY + NODE_RADIUS}
					x2={sourceX}
					y2={sourceY + NODE_RADIUS + stubLength}
					stroke={sourceColor}
					strokeWidth={1.5}
					strokeOpacity={0.4}
					strokeDasharray="3 3"
					data-edge-type="missing-stub"
					data-source-revision={sourceRevision.change_id}
				/>
			</g>
		);
	}

	// Same lane: straight vertical line (or dotted for collapsed stacks)
	if (sourceLane === targetLane) {
		const isCollapsedStack = !!collapsedStackId;
		const y1 = sourceY + NODE_RADIUS;
		const y2 = targetY - NODE_RADIUS;
		
		// For collapsed stacks, draw a dotted line with clickable area
		if (isCollapsedStack) {
			const collapsedLabel = `${collapsedCount ?? 0} hidden revision${(collapsedCount ?? 0) !== 1 ? "s" : ""} - click to expand`;
			
			return (
				<g 
					aria-label={collapsedLabel}
					className="cursor-pointer group"
					style={{ pointerEvents: "auto" }}
					onClick={() => onToggleStack?.(collapsedStackId)}
				>
					<title>{collapsedLabel}</title>
					{/* Invisible wider hitbox for easier clicking */}
					<line
						x1={sourceX}
						y1={y1}
						x2={sourceX}
						y2={y2}
						stroke="transparent"
						strokeWidth={16}
					/>
					{/* Visible dotted line */}
					<line
						x1={sourceX}
						y1={y1}
						x2={sourceX}
						y2={y2}
						stroke={sourceColor}
						strokeWidth={strokeWidth}
						strokeOpacity={0.7}
						strokeDasharray="3 6"
						strokeLinecap="round"
						className="group-hover:[stroke-width:3] group-hover:[stroke-opacity:1] transition-[stroke-width,stroke-opacity] duration-150"
						data-edge-type="collapsed-stack"
						data-stack-id={collapsedStackId}
						data-source-revision={sourceRevision.change_id}
						data-target-revision={targetRevision?.change_id}
					/>
				</g>
			);
		}
		
		// For expanded stacks, make the edge clickable to collapse
		if (expandedStackId) {
			const expandedLabel = `Click to collapse stack`;
			// Use full stack bounds if available, otherwise fall back to node bounds
			const hitboxY1 = stackTopY !== undefined ? stackTopY : y1;
			const hitboxY2 = stackBottomY !== undefined ? stackBottomY : y2;
			return (
				<g 
					aria-label={expandedLabel}
					className="cursor-pointer stack-group"
					data-stack-id={expandedStackId}
					style={{ pointerEvents: "auto" }}
					onClick={() => onToggleStack?.(expandedStackId)}
				>
					<title>{expandedLabel}</title>
					{/* Invisible wider hitbox covering full stack height */}
					<line
						x1={sourceX}
						y1={hitboxY1}
						x2={targetX}
						y2={hitboxY2}
						stroke="transparent"
						strokeWidth={16}
					/>
					<line
						x1={sourceX}
						y1={y1}
						x2={targetX}
						y2={y2}
						stroke={isDeemphasized ? strokeColor : sourceColor}
						strokeWidth={strokeWidth}
						strokeOpacity={strokeOpacity}
						strokeDasharray={isDashed ? "4 4" : undefined}
						className="stack-edge transition-[stroke-width,stroke-opacity] duration-150"
						data-edge-type={edgeType}
						data-stack-id={expandedStackId}
						data-source-revision={sourceRevision.change_id}
						data-target-revision={targetRevision?.change_id}
					/>
				</g>
			);
		}
		
		return (
			<g aria-label={ariaLabel} style={{ pointerEvents: "none" }}>
				<title>{ariaLabel}</title>
				<line
					x1={sourceX}
					y1={y1}
					x2={targetX}
					y2={y2}
					stroke={isDeemphasized ? strokeColor : sourceColor}
					strokeWidth={strokeWidth}
					strokeOpacity={strokeOpacity}
					strokeDasharray={isDashed ? "4 4" : undefined}
					data-edge-type={edgeType}
					data-source-revision={sourceRevision.change_id}
					data-target-revision={targetRevision?.change_id}
				/>
			</g>
		);
	}

	// Cross-lane: horizontal from source, curve down into target's lane
	const goingRight = targetX > sourceX;
	const arcRadius = 10;

	return (
		<g aria-label={ariaLabel} style={{ pointerEvents: "none" }}>
			<title>{ariaLabel}</title>
			<path
				d={`M ${sourceX} ${sourceY + NODE_RADIUS}
					L ${targetX - arcRadius * (goingRight ? 1 : -1)} ${sourceY + NODE_RADIUS}
					Q ${targetX} ${sourceY + NODE_RADIUS} ${targetX} ${sourceY + NODE_RADIUS + arcRadius}
					L ${targetX} ${targetY - NODE_RADIUS}`}
				fill="none"
				stroke={strokeColor}
				strokeWidth={strokeWidth}
				strokeOpacity={strokeOpacity}
				strokeDasharray={isDashed ? "4 4" : undefined}
				data-edge-type={edgeType}
				data-source-revision={sourceRevision.change_id}
				data-target-revision={targetRevision?.change_id}
			/>
		</g>
	);
}

interface EdgeLayerProps {
	bindings: EdgeBinding[];
	revisionMap: Map<string, Revision>;
	getRowCenter: (row: number) => number;
	commitToRow: Map<string, number>;
	totalHeight: number;
	width: number;
	visibleStartRow: number;
	visibleEndRow: number;
	stackById: Map<string, RevisionStack>;
	changeIdToCommitId: Map<string, string>;
	onToggleStack?: (stackId: string) => void;
}

// EdgeLayer - Renders all semantic edge components
function EdgeLayer({
	bindings,
	revisionMap,
	getRowCenter,
	commitToRow,
	totalHeight,
	width,
	visibleStartRow,
	visibleEndRow,
	stackById,
	changeIdToCommitId,
	onToggleStack,
}: EdgeLayerProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	
	// Add overscan for edges that might span across viewport boundary
	// Use larger overscan to handle collapsed stack edges that span many rows
	const overscan = 15;
	const startRow = Math.max(0, visibleStartRow - overscan);
	const endRow = visibleEndRow + overscan;

	// Filter bindings to those visible in the viewport
	const visibleBindings = bindings.filter((binding) => {
		const sourceRow = commitToRow.get(binding.sourceRevisionId);
		const targetRow = commitToRow.get(binding.targetRevisionId);
		if (sourceRow === undefined) return false;
		
		// For missing stubs, just check if source is near visible range
		if (binding.isMissingStub) {
			return sourceRow >= startRow && sourceRow <= endRow;
		}
		
		if (targetRow === undefined) return false;
		
		// Check if edge passes through visible area
		const minRow = Math.min(sourceRow, targetRow);
		const maxRow = Math.max(sourceRow, targetRow);
		return maxRow >= startRow && minRow <= endRow;
	});

	// Handle hover for stack edges - make all edges in the same stack respond together
	// Use event delegation on the SVG to handle dynamically added groups
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;

		let hoveredStackId: string | null = null;

		const handleMouseOver = (e: Event) => {
			const target = e.target as HTMLElement;
			// Check if the event originated from a stack group
			const group = target.closest('g.stack-group[data-stack-id]') as HTMLElement;
			if (!group) return;
			
			const stackId = group.getAttribute('data-stack-id');
			if (!stackId || stackId === hoveredStackId) return;

			hoveredStackId = stackId;
			// Find all edges with the same stack-id and add hover class
			const edges = svg.querySelectorAll(`line.stack-edge[data-stack-id="${stackId}"]`);
			edges.forEach((edge) => {
				edge.classList.add('stack-edge-hovered');
			});
		};

		const handleMouseOut = (e: Event) => {
			const target = e.target as HTMLElement;
			const relatedTarget = (e as MouseEvent).relatedTarget as HTMLElement;
			
			// Check if we're leaving a stack group
			const group = target.closest('g.stack-group[data-stack-id]') as HTMLElement;
			if (!group) return;
			
			// Check if we're moving to another element within the same stack group
			if (relatedTarget && group.contains(relatedTarget)) return;
			
			const stackId = group.getAttribute('data-stack-id');
			if (!stackId || stackId !== hoveredStackId) return;

			hoveredStackId = null;
			// Remove hover class from all edges with the same stack-id
			const edges = svg.querySelectorAll(`line.stack-edge[data-stack-id="${stackId}"]`);
			edges.forEach((edge) => {
				edge.classList.remove('stack-edge-hovered');
			});
		};

		// Use event delegation - attach listeners to the SVG element
		// mouseover/mouseout bubble, unlike mouseenter/mouseleave
		svg.addEventListener('mouseover', handleMouseOver, true);
		svg.addEventListener('mouseout', handleMouseOut, true);

		return () => {
			svg.removeEventListener('mouseover', handleMouseOver, true);
			svg.removeEventListener('mouseout', handleMouseOut, true);
		};
	}, []);

	return (
		<svg
			ref={svgRef}
			width={width}
			height={totalHeight}
			className="shrink-0 absolute top-0 left-0 z-20"
			role="img"
			aria-label="Revision connections"
		>
			<title>Revision graph edges</title>
			{visibleBindings.map((binding) => {
				const sourceRow = commitToRow.get(binding.sourceRevisionId);
				const targetRow = binding.isMissingStub 
					? (sourceRow !== undefined ? sourceRow + 1 : undefined)
					: commitToRow.get(binding.targetRevisionId);
				
				if (sourceRow === undefined) return null;
				
				const sourceRevision = revisionMap.get(binding.sourceRevisionId);
				const targetRevision = binding.targetRevisionId 
					? revisionMap.get(binding.targetRevisionId) ?? null 
					: null;
				
				if (!sourceRevision) return null;

				// For expanded stacks, calculate full stack bounds
				let stackTopY: number | undefined;
				let stackBottomY: number | undefined;
				if (binding.expandedStackId) {
					const stack = stackById.get(binding.expandedStackId);
					if (stack) {
						const topCommitId = changeIdToCommitId.get(stack.topChangeId);
						const bottomCommitId = changeIdToCommitId.get(stack.bottomChangeId);
						const topRow = topCommitId ? commitToRow.get(topCommitId) : undefined;
						const bottomRow = bottomCommitId ? commitToRow.get(bottomCommitId) : undefined;
						if (topRow !== undefined && bottomRow !== undefined) {
							stackTopY = getRowCenter(topRow) - NODE_RADIUS;
							stackBottomY = getRowCenter(bottomRow) + NODE_RADIUS;
						}
					}
				}

				return (
					<GraphEdge
						key={binding.id}
						binding={binding}
						sourceY={getRowCenter(sourceRow)}
						targetY={targetRow !== undefined ? getRowCenter(targetRow) : getRowCenter(sourceRow) + ROW_HEIGHT}
						sourceRevision={sourceRevision}
						targetRevision={targetRevision}
						stackTopY={stackTopY}
						stackBottomY={stackBottomY}
						onToggleStack={onToggleStack}
					/>
				);
			})}
		</svg>
	);
}

// ============================================================================
// End of Semantic Graph Components
// ============================================================================

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
	edgeBindings: EdgeBinding[];
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
	if (revisions.length === 0) return { nodes: [], laneCount: 1, rows: [], edgeBindings: [] };

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

		const parentConnections: ParentConnection[] = [];

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
			const edgeType = parentEdge?.edge_type ?? "direct";

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
		const hasParentsOutsideView = revision.parent_ids.length > visibleParents.length;

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
				: rows[conn.parentRow]?.revision.commit_id ?? "";
			
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

	return { nodes, laneCount: globalMaxLane + 1, rows, edgeBindings };
}

function laneToX(lane: number): number {
	return LANE_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function laneColor(lane: number): string {
	return LANE_COLORS[lane % LANE_COLORS.length];
}

function RevisionRow({
	revision,
	lane,
	maxLaneOnRow,
	isSelected,
	onSelect,
	isFlashing,
	isDimmed,
	isExpanded,
	isFocused,
	repoPath,
	isPendingAbandon,
	jumpHint,
	jumpModeActive,
	jumpQuery,
}: {
	revision: Revision;
	lane: number;
	maxLaneOnRow: number;
	isSelected: boolean;
	onSelect: (changeId: string) => void;
	isFlashing: boolean;
	isDimmed: boolean;
	isExpanded: boolean;
	isFocused: boolean;
	repoPath: string | null;
	isPendingAbandon: boolean;
	jumpHint: string | null;
	jumpModeActive: boolean;
	jumpQuery: string;
}) {
	const firstLine = revision.description.split("\n")[0] || "(no description)";
	const fullDescription = revision.description || "(no description)";
	
	// Calculate the node position area - leaves space for graph edges on the left
	const nodeAreaWidth = LANE_PADDING + (maxLaneOnRow + 1) * LANE_WIDTH;
	const nodeOffset = laneToX(lane);
	const color = laneColor(lane);

	const selectedFile = useSearch({ strict: false, select: (s) => s.file ?? null });
	const search = useSearch({ strict: false });
	const navigate = useNavigate();

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

	// Constants matching edge layer calculations
	const TOP_PADDING = 16;
	const CONTENT_MIN_HEIGHT = 56;
	const nodeSize = revision.is_working_copy ? NODE_RADIUS * 2 + 14 : NODE_RADIUS * 2 + 8;
	
	return (
		<div style={{ height: isExpanded ? "auto" : ROW_HEIGHT }} className="flex flex-col relative">
			{/* Graph node - absolutely positioned to align with edge layer */}
			<div
				className="absolute z-20 flex items-center justify-center"
				style={{ 
					left: nodeOffset - nodeSize / 2,
					top: TOP_PADDING + CONTENT_MIN_HEIGHT / 2 - nodeSize / 2,
				}}
			>
				<GraphNode
					revision={revision}
					lane={lane}
					isSelected={isSelected}
					color={color}
				/>
			</div>
			<div className="flex items-start min-h-[56px] pt-4">
				{/* Spacer for graph area */}
				<div className="shrink-0" style={{ width: nodeAreaWidth }} />
				<div
					className={`relative flex-1 mr-2 min-w-0 overflow-hidden rounded my-2 mx-1 ${
						isFocused ? "" : "border border-border"
					} bg-card text-card-foreground shadow-sm transition-colors duration-150 hover:shadow hover:bg-accent/20 hover:cursor-pointer ${
						revision.is_immutable ? "opacity-60" : ""
					} ${isDimmed ? "opacity-40" : ""} ${isSelected ? "bg-accent/30" : ""} ${
						isFocused ? "ring-2 ring-ring/80 ring-offset-2 ring-offset-background" : ""
					}`}
					onClick={() => onSelect(revision.change_id)}
				>
					<div className={`px-3 py-2 min-w-0 ${isPendingAbandon ? "blur-sm" : ""}`}>
						<div className="flex items-center gap-2 flex-nowrap min-w-0">
							<code
								className={`text-xs font-mono rounded px-0.5 shrink-0 ${
									isFlashing ? "bg-primary/40 animate-pulse" : ""
								} text-muted-foreground`}
							>
								{jumpModeActive && jumpHint ? (
									<>
										{/* Already matched portion */}
										{jumpQuery && (
											<span className="bg-primary/30 text-primary font-semibold">
												{revision.change_id_short.slice(0, jumpQuery.length)}
											</span>
										)}
										{/* Next character to type (the hint) */}
										<span className="bg-primary text-primary-foreground font-semibold rounded-sm">
											{revision.change_id_short[jumpQuery.length]}
										</span>
										{/* Rest of the ID */}
										<span>
											{revision.change_id_short.slice(jumpQuery.length + 1)}
										</span>
									</>
								) : (
									revision.change_id_short
								)}
							</code>
							{revision.bookmarks.length > 0 && (
								<span 
									className="text-xs text-primary font-medium truncate min-w-0 whitespace-nowrap"
									title={revision.bookmarks.join(", ")}
								>
									{revision.bookmarks.join(", ")}
								</span>
							)}
							<span className="text-xs text-muted-foreground truncate min-w-0 shrink-0">
								{revision.author.split("@")[0]} · {revision.timestamp}
							</span>
						</div>
						<div className={`text-sm mt-1 ${isExpanded ? "" : "truncate"}`}>{firstLine}</div>
					</div>
					{isExpanded && (
						<div className={`px-3 pb-3 pt-0 space-y-3 ${isPendingAbandon ? "blur-sm" : ""}`}>
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
					{isPendingAbandon && (
						<div className="absolute inset-0 flex items-center justify-center bg-destructive/10 rounded">
							<div className="text-sm font-medium text-destructive-foreground bg-destructive/90 px-3 py-1.5 rounded">
								Abandon this revision? <kbd className="ml-1 px-1 bg-background/20 rounded">Y</kbd> / <kbd className="px-1 bg-background/20 rounded">N</kbd>
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
		{ revisions, selectedRevision, onSelectRevision, isLoading, flash, repoPath, pendingAbandon },
		ref,
	) {
		const parentRef = useRef<HTMLDivElement>(null);
		const { nodes, laneCount, rows: allRows, edgeBindings } = useMemo(
			() => buildGraph(revisions),
			[revisions],
		);
		const expanded = useSearch({ strict: false, select: (s) => s.expanded });
		const search = useSearch({ strict: false });
		const navigate = useNavigate();
		const [inlineJumpQuery, setInlineJumpQuery] = useAtom(inlineJumpQueryAtom);
		const inlineJumpMode = inlineJumpQuery !== null;

		// Detect collapsible stacks
		const stacks = useMemo(() => detectStacks(revisions), [revisions]);

		// Prefetch diffs for all revisions in background
		// This eagerly creates TanStack DB collections which trigger async fetches
		useMemo(() => {
			if (repoPath && revisions.length > 0) {
				const changeIds = revisions.map((r) => r.change_id);
				prefetchRevisionDiffs(repoPath, changeIds);
			}
		}, [repoPath, revisions]);

		// Track which stacks are expanded (empty = all collapsed by default)
		const [expandedStacks, setExpandedStacks] = useAtom(expandedStacksAtom);

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

		// Display row can be either a revision row or a collapsed stack spacer
		type DisplayRow =
			| { type: "revision"; row: GraphRow }
			| { type: "collapsed-spacer"; stack: RevisionStack; lane: number };

		// Filter rows to hide collapsed intermediate revisions and add spacers
		const displayRows = useMemo(() => {
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
					// If collapsed, skip this row (don't add it)
				} else {
					// Not an intermediate or not in a stack - always show
					result.push({ type: "revision", row });

					// If this is the top of a collapsed stack, insert a spacer after it
					if (stack && changeId === stack.topChangeId && !expandedStacks.has(stack.id)) {
						const lane = changeIdToLane.get(changeId) ?? 0;
						result.push({ type: "collapsed-spacer", stack, lane });
					}
				}
			}

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

		// Maps for lookups - by change_id for UI, by commit_id for graph edges
		const revisionMapByChangeId = new Map(revisions.map((r) => [r.change_id, r]));
		const revisionMapByCommitId = new Map(revisions.map((r) => [r.commit_id, r]));
		const relatedRevisions = getRelatedRevisions(revisions, selectedRevision?.change_id ?? null);

		// Build change_id -> displayRow index map for scrolling and edge positioning
		// IMPORTANT: Use displayRows indices (not rows) to match virtualizer positioning
		const changeIdToIndex = new Map<string, number>();
		const commitToRowIndex = new Map<string, number>();
		for (let i = 0; i < displayRows.length; i++) {
			const displayRow = displayRows[i];
			if (displayRow.type === "revision") {
				changeIdToIndex.set(displayRow.row.revision.change_id, i);
				commitToRowIndex.set(displayRow.row.revision.commit_id, i);
			}
		}
		
		// Create a mapping of change_id -> commit_id for edge remapping
		const changeIdToCommitId = new Map<string, string>();
		for (const rev of revisions) {
			changeIdToCommitId.set(rev.change_id, rev.commit_id);
		}

		// Filter edge bindings to handle collapsed/expanded stacks
		// When a stack is collapsed, edges from/to intermediates should be remapped
		// When a stack is expanded, edges within it should be clickable to collapse
		const filteredEdgeBindings = useMemo(() => {
			// Build mapping: hidden commit_id -> { visible commit_id, stack info }
			const hiddenToVisible = new Map<string, { targetCommitId: string; stack: RevisionStack }>();
			// Build mapping: top commit_id -> stack (for marking edges as collapsed)
			const topCommitToStack = new Map<string, RevisionStack>();
			// Build mapping: commit_id -> stack (for edges within expanded stacks)
			const commitToExpandedStack = new Map<string, RevisionStack>();
			
			for (const stack of stacks) {
				if (!expandedStacks.has(stack.id)) {
					// Stack is collapsed - map all intermediates to bottom revision
					const bottomCommitId = changeIdToCommitId.get(stack.bottomChangeId);
					const topCommitId = changeIdToCommitId.get(stack.topChangeId);
					
					if (bottomCommitId && topCommitId) {
						topCommitToStack.set(topCommitId, stack);
						
						for (const intermediateChangeId of stack.intermediateChangeIds) {
							const intermediateCommitId = changeIdToCommitId.get(intermediateChangeId);
							if (intermediateCommitId) {
								hiddenToVisible.set(intermediateCommitId, { targetCommitId: bottomCommitId, stack });
							}
						}
					}
				} else {
					// Stack is expanded - mark all commits in the stack for clickable edges
					for (const changeId of stack.changeIds) {
						const commitId = changeIdToCommitId.get(changeId);
						if (commitId) {
							commitToExpandedStack.set(commitId, stack);
						}
					}
				}
			}

			// Remap edge bindings
			const remapped: EdgeBinding[] = [];
			const seen = new Set<string>(); // Deduplicate edges

			for (const binding of edgeBindings) {
				let targetId = binding.targetRevisionId;
				let collapsedStackId: string | undefined;
				let collapsedCount: number | undefined;
				let expandedStackId: string | undefined;
				
				// Check if this edge originates from a collapsed stack top
				const stackFromTop = topCommitToStack.get(binding.sourceRevisionId);
				if (stackFromTop && hiddenToVisible.has(targetId)) {
					// This is the edge from top to first intermediate - remap to bottom
					const info = hiddenToVisible.get(targetId)!;
					targetId = info.targetCommitId;
					collapsedStackId = info.stack.id;
					collapsedCount = info.stack.intermediateChangeIds.length;
				} else if (hiddenToVisible.has(targetId)) {
					// Remap target if it's a hidden intermediate
					targetId = hiddenToVisible.get(targetId)!.targetCommitId;
				} else {
					// Check if both source and target are in the same expanded stack
					const sourceStack = commitToExpandedStack.get(binding.sourceRevisionId);
					const targetStack = commitToExpandedStack.get(targetId);
					if (sourceStack && targetStack && sourceStack.id === targetStack.id) {
						expandedStackId = sourceStack.id;
					}
				}

				// Skip edges where source is a hidden intermediate
				if (hiddenToVisible.has(binding.sourceRevisionId)) {
					continue;
				}

				// Deduplicate
				const key = `${binding.sourceRevisionId}->${targetId}`;
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

		const [debugEnabled, setDebugEnabled] = useState(DEBUG_OVERLAY_DEFAULT);
		const debugEnabledRef = useRef(debugEnabled);
		debugEnabledRef.current = debugEnabled;

		// Determine if selected revision is expanded based on URL search params
		const isSelectedExpanded = expanded === true && !!selectedRevision;

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
				const { expanded: _expanded, ...restSearch } = search;
				navigate({
					search: restSearch as any,
				});
			},
		});

		// Track if we just activated jump mode to ignore the same 'f' keypress
		const justActivatedRef = useRef(false);

		// Activate inline jump mode with 'f' key
		useKeyboardShortcut({
			key: "f",
			modifiers: {},
			onPress: () => {
				justActivatedRef.current = true;
				setInlineJumpQuery("");
				// Clear the flag after a short delay (same event loop tick protection)
				requestAnimationFrame(() => {
					justActivatedRef.current = false;
				});
			},
			enabled: !inlineJumpMode,
		});

		// Cancel inline jump mode with Escape
		useKeyboardShortcut({
			key: "Escape",
			modifiers: {},
			onPress: () => setInlineJumpQuery(null),
			enabled: inlineJumpMode,
		});

		const rowVirtualizer = useVirtualizer({
			count: displayRows.length,
			getScrollElement: () => parentRef.current,
			estimateSize: (index: number) => {
				const displayRow = displayRows[index];
				if (displayRow.type === "collapsed-spacer") {
					// Fixed height spacer for collapsed stacks
					return COLLAPSED_INDICATOR_HEIGHT;
				}
				const row = displayRow.row;
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
			const revision = revisionMapByChangeId.get(changeId);
			if (revision) onSelectRevision(revision);
		}

		const virtualItems = rowVirtualizer.getVirtualItems();
		const visibleStartRow = virtualItems[0]?.index ?? 0;
		const visibleEndRow = virtualItems[virtualItems.length - 1]?.index ?? 0;
		const totalHeight = rowVirtualizer.getTotalSize();
		const rowOffsets = new Map<number, number>();
		for (const item of virtualItems) {
			rowOffsets.set(item.index, item.start);
		}

		// Compute jump hints for visible rows based on change ID prefix matching
		const jumpHintsMap = new Map<string, string>();
		const matchingRevisions: Array<{ changeId: string; shortId: string }> = [];

		if (inlineJumpMode && revisions.length > 0) {
			const query = inlineJumpQuery ?? "";

			// First, collect all visible revisions that match the current query
			for (const item of virtualItems) {
				const row = rows[item.index];
				if (row) {
					const shortId = row.revision.change_id_short.toLowerCase();
					if (shortId.startsWith(query.toLowerCase())) {
						matchingRevisions.push({
							changeId: row.revision.change_id,
							shortId: row.revision.change_id_short,
						});
					}
				}
			}

			// Assign hints based on the next character in the change ID
			if (query === "") {
				// Initial state: show first letter of each change ID
				for (const { changeId, shortId } of matchingRevisions) {
					jumpHintsMap.set(changeId, shortId[0].toLowerCase());
				}
			} else {
				// After typing: show the next letter to type, or secondary hints if needed
				const nextCharIndex = query.length;
				const nextChars = new Map<string, Array<{ changeId: string; shortId: string }>>();

				// Group by next character
				for (const rev of matchingRevisions) {
					const nextChar = rev.shortId[nextCharIndex]?.toLowerCase() ?? "";
					if (nextChar) {
						const group = nextChars.get(nextChar) ?? [];
						group.push(rev);
						nextChars.set(nextChar, group);
					}
				}

				// Assign hints
				for (const { changeId, shortId } of matchingRevisions) {
					const nextChar = shortId[nextCharIndex]?.toLowerCase() ?? "";
					if (nextChar) {
						jumpHintsMap.set(changeId, nextChar);
					}
				}
			}
		}

		// Store matching revisions in a ref for use in the effect
		const matchingRevisionsRef = useRef(matchingRevisions);
		matchingRevisionsRef.current = matchingRevisions;

		// Handle jump hint letter key presses
		useEffect(() => {
			if (!inlineJumpMode) return;

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
					const currentQuery = inlineJumpQuery ?? "";
					if (currentQuery.length > 0) {
						setInlineJumpQuery(currentQuery.slice(0, -1));
					} else {
						setInlineJumpQuery(null); // Cancel if already empty
					}
					return;
				}

				// Only accept alphanumeric characters for the query
				if (/^[a-z0-9]$/i.test(key)) {
					event.preventDefault();
					const newQuery = (inlineJumpQuery ?? "") + key;

					// Find matching revisions with the new query
					const matches = matchingRevisionsRef.current.filter(({ shortId }) =>
						shortId.toLowerCase().startsWith(newQuery.toLowerCase()),
					);

					if (matches.length === 1) {
						// Single match - jump directly
						setInlineJumpQuery(null);
						const revision = revisionMapByChangeId.get(matches[0].changeId);
						if (revision) {
							onSelectRevision(revision);
						}
					} else if (matches.length === 0) {
						// No matches - cancel
						setInlineJumpQuery(null);
					} else {
						// Multiple matches - update query to filter
						setInlineJumpQuery(newQuery);
					}
					return;
				}

				// Any other non-modifier key cancels jump mode
				if (!["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) {
					setInlineJumpQuery(null);
				}
			}

			window.addEventListener("keydown", handleJumpKey);
			return () => window.removeEventListener("keydown", handleJumpKey);
		}, [inlineJumpMode, inlineJumpQuery, setInlineJumpQuery, revisionMapByChangeId, onSelectRevision]);

		if (revisions.length === 0) {
			return (
				<div className="flex items-center justify-center h-full bg-background text-muted-foreground text-sm">
					{isLoading ? "Loading revisions..." : "Select a project to view revisions"}
				</div>
			);
		}

		const selectedIndex = selectedRevision
			? changeIdToIndex.get(selectedRevision.change_id)
			: undefined;

		const workingCopy = revisions.find((r) => r.is_working_copy);
		const wcIndex = workingCopy ? changeIdToIndex.get(workingCopy.change_id) : undefined;

		// Calculate edge layer dimensions and row center positions
		const TOP_PADDING = 16; // Matches pt-4 on RevisionRow
		const CONTENT_MIN_HEIGHT = 56; // Matches min-h-[56px] on RevisionRow content
		const getRowStart = (row: number) => rowOffsets.get(row) ?? row * ROW_HEIGHT;
		const getRowCenter = (row: number) => getRowStart(row) + TOP_PADDING + CONTENT_MIN_HEIGHT / 2;
		const graphWidth = LANE_PADDING + laneCount * LANE_WIDTH + NODE_RADIUS + 2;

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
					{/* Edge layer - semantic edge components positioned absolutely */}
					<EdgeLayer
						bindings={filteredEdgeBindings}
						revisionMap={revisionMapByCommitId}
						getRowCenter={getRowCenter}
						commitToRow={commitToRowIndex}
						totalHeight={totalHeight}
						width={graphWidth}
						visibleStartRow={visibleStartRow}
						visibleEndRow={visibleEndRow}
						stackById={stackById}
						changeIdToCommitId={changeIdToCommitId}
						onToggleStack={toggleStackExpansion}
					/>

					{/* Virtualized rows with inline graph nodes */}
					<div className="relative z-10">
						{virtualItems.map((virtualRow) => {
							const displayRow = displayRows[virtualRow.index];

							// Collapsed stack spacer row - button positioned at edge midpoint
							if (displayRow.type === "collapsed-spacer") {
								const { stack, lane } = displayRow;
								// Get the row indices for top and bottom of this stack
								const topRowIdx = changeIdToIndex.get(stack.topChangeId);
								const bottomRowIdx = changeIdToIndex.get(stack.bottomChangeId);
								// Calculate button position at midpoint of dotted edge
								const topCenter = topRowIdx !== undefined ? getRowCenter(topRowIdx) : virtualRow.start;
								const bottomCenter = bottomRowIdx !== undefined ? getRowCenter(bottomRowIdx) : virtualRow.start + COLLAPSED_INDICATOR_HEIGHT;
								const edgeMidY = (topCenter + bottomCenter) / 2;
								// Position button relative to spacer row start
								const buttonOffsetY = edgeMidY - virtualRow.start - 12; // 12 = half button height
								
								return (
									<div
										key={`spacer-${stack.id}`}
										ref={rowVirtualizer.measureElement}
										data-index={virtualRow.index}
										className="absolute left-0 w-full pointer-events-none"
										style={{
											transform: `translateY(${virtualRow.start}px)`,
											height: COLLAPSED_INDICATOR_HEIGHT,
										}}
									>
										<button
											type="button"
											onClick={() => toggleStackExpansion(stack.id)}
											className="absolute flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 transition-colors pointer-events-auto rounded"
											style={{
												top: buttonOffsetY + 4,
												left: (lane + 1) * LANE_WIDTH + 16,
												backgroundColor: "transparent",
											}}
										>
											<svg
												className="w-3 h-3"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M19 9l-7 7-7-7"
												/>
											</svg>
											<span>
												{stack.intermediateChangeIds.length} hidden revision
												{stack.intermediateChangeIds.length !== 1 ? "s" : ""}
											</span>
										</button>
									</div>
								);
							}

							// Regular revision row
							const row = displayRow.row;
							const lane = changeIdToLane.get(row.revision.change_id) ?? 0;
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
									lane={lane}
									maxLaneOnRow={row.maxLaneOnRow}
									isSelected={isSelected}
									isFocused={isFocused}
									onSelect={handleSelect}
									isFlashing={isFlashing}
									isDimmed={isDimmed}
									isExpanded={isExpanded}
									repoPath={repoPath}
									isPendingAbandon={pendingAbandon?.change_id === row.revision.change_id}
									jumpHint={jumpHintsMap.get(row.revision.change_id) ?? null}
									jumpModeActive={inlineJumpMode}
									jumpQuery={inlineJumpQuery ?? ""}
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
					wcIndex={wcIndex}
					selectedChangeId={selectedRevision?.change_id}
					wcChangeId={workingCopy?.change_id}
				/>
			</div>
		);
	},
);
