/**
 * RevisionGraph - Re-export from modular components
 *
 * The component has been refactored into smaller modules in ./revision-graph/
 * This file maintains backwards compatibility for existing imports.
 */
export {
	RevisionGraph,
	type RevisionGraphHandle,
} from "./revision-graph";

// Re-export types and constants for consumers that may need them
export type {
	EdgeBinding,
	GraphNode,
	GraphRow,
	GraphData,
	GraphEdgeType,
} from "./revision-graph";

export {
	ROW_HEIGHT,
	LANE_WIDTH,
	LANE_PADDING,
	NODE_RADIUS,
	MAX_LANES,
	laneToX,
	laneColor,
} from "./revision-graph";
