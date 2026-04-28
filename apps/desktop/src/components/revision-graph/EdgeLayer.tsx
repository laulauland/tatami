import { useAtom } from "@effect-atom/atom-react";
import { useMemo } from "react";
import { hoveredStackIdAtom } from "@/atoms";
import type { Revision } from "@/tauri-commands";
import { queryEdgeIntervalIndex, type RevisionStack } from "@/components/revision-graph-utils";
import type { EdgeIntervalIndex } from "./types";
import { NODE_RADIUS } from "./constants";
import { GraphEdge } from "./GraphEdge";

interface EdgeLayerProps {
	edgeIndex: EdgeIntervalIndex;
	commitToRow: Map<string, number>;
	revisionMap: Map<string, Revision>;
	getRowCenter: (row: number) => number;
	totalHeight: number;
	width: number;
	visibleStartRow: number;
	visibleEndRow: number;
	stackById: Map<string, RevisionStack>;
	changeIdToCommitId: Map<string, string>;
	onToggleStack?: (stackId: string) => void;
}

/**
 * EdgeLayer - Renders all semantic edge components as an SVG overlay
 * Handles visibility filtering for virtualization
 */
export function EdgeLayer({
	edgeIndex,
	commitToRow,
	revisionMap,
	getRowCenter,
	totalHeight,
	width,
	visibleStartRow,
	visibleEndRow,
	stackById,
	changeIdToCommitId,
	onToggleStack,
}: EdgeLayerProps) {
	// Use atom for hover state - automatically syncs with stack toggling and view mode changes
	const [hoveredStackId, setHoveredStackId] = useAtom(hoveredStackIdAtom);

	// Add overscan for edges that might span across viewport boundary
	// Use larger overscan to handle collapsed stack edges that span many rows
	const overscan = 15;
	const startRow = Math.max(0, visibleStartRow - overscan);
	const endRow = visibleEndRow + overscan;

	const visibleBindings = useMemo(
		() => queryEdgeIntervalIndex(edgeIndex, startRow, endRow),
		[edgeIndex, startRow, endRow],
	);

	return (
		<svg
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
					? sourceRow !== undefined
						? sourceRow + 1
						: undefined
					: commitToRow.get(binding.targetRevisionId);

				if (sourceRow === undefined) return null;

				const sourceRevision = revisionMap.get(binding.sourceRevisionId);
				const targetRevision = binding.targetRevisionId
					? (revisionMap.get(binding.targetRevisionId) ?? null)
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

				// Use a key that captures the edge's structural identity:
				// source, target (which changes when collapsed), and stack state
				const edgeKey = `${binding.sourceRevisionId}->${binding.targetRevisionId}:${binding.collapsedStackId ?? binding.expandedStackId ?? "none"}`;

				return (
					<GraphEdge
						key={edgeKey}
						binding={binding}
						sourceY={getRowCenter(sourceRow)}
						targetY={
							targetRow !== undefined ? getRowCenter(targetRow) : getRowCenter(sourceRow) + 64 // ROW_HEIGHT fallback
						}
						sourceRevision={sourceRevision}
						targetRevision={targetRevision}
						stackTopY={stackTopY}
						stackBottomY={stackBottomY}
						hoveredStackId={hoveredStackId}
						onHoverStack={setHoveredStackId}
						onToggleStack={onToggleStack}
					/>
				);
			})}
		</svg>
	);
}
