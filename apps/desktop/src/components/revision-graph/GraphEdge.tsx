import type { Revision } from "@/tauri-commands";
import { NODE_RADIUS, ROW_HEIGHT, laneToX, laneColor } from "./constants";
import type { EdgeBinding } from "./types";

interface GraphEdgeProps {
	binding: EdgeBinding;
	sourceY: number;
	targetY: number;
	sourceRevision: Revision;
	targetRevision: Revision | null;
	stackTopY?: number;
	stackBottomY?: number;
	hoveredStackId: string | null;
	onHoverStack: (stackId: string | null) => void;
	onToggleStack?: (stackId: string) => void;
}

/**
 * GraphEdge - Semantic edge component with source/target revision bindings
 * Handles different edge types: direct, indirect (dashed), missing stub
 * Supports collapsed/expanded stack interactions
 */
export function GraphEdge({
	binding,
	sourceY,
	targetY,
	sourceRevision,
	targetRevision,
	stackTopY,
	stackBottomY,
	hoveredStackId,
	onHoverStack,
	onToggleStack,
}: GraphEdgeProps) {
	const {
		sourceLane,
		targetLane,
		edgeType,
		isDeemphasized,
		isMissingStub,
		collapsedStackId,
		collapsedCount,
		expandedStackId,
	} = binding;

	// Check if this edge's stack is currently hovered
	const isStackHovered = expandedStackId !== undefined && hoveredStackId === expandedStackId;

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
				// biome-ignore lint/a11y/useSemanticElements: Cannot use button inside SVG
				<g
					role="button"
					tabIndex={0}
					aria-label={collapsedLabel}
					className="cursor-pointer group"
					style={{ pointerEvents: "auto" }}
					onClick={() => onToggleStack?.(collapsedStackId)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							onToggleStack?.(collapsedStackId);
						}
					}}
				>
					<title>{collapsedLabel}</title>
					{/* Invisible wider hitbox for easier clicking */}
					<line x1={sourceX} y1={y1} x2={sourceX} y2={y2} stroke="transparent" strokeWidth={16} />
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

			// Apply hover styling reactively based on atom state
			const hoverStrokeWidth = isStackHovered ? 3 : strokeWidth;
			const hoverStrokeOpacity = isStackHovered ? 1 : strokeOpacity;

			return (
				// biome-ignore lint/a11y/useSemanticElements: Cannot use button inside SVG
				<g
					role="button"
					tabIndex={0}
					aria-label={expandedLabel}
					className="cursor-pointer"
					style={{ pointerEvents: "auto" }}
					onClick={() => onToggleStack?.(expandedStackId)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							onToggleStack?.(expandedStackId);
						}
					}}
					onMouseEnter={() => onHoverStack(expandedStackId)}
					onMouseLeave={() => onHoverStack(null)}
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
						strokeWidth={hoverStrokeWidth}
						strokeOpacity={hoverStrokeOpacity}
						strokeDasharray={isDashed ? "4 4" : undefined}
						className="transition-[stroke-width,stroke-opacity] duration-150"
						data-edge-type={edgeType}
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
