/**
 * Graph layout constants
 */
export const ROW_HEIGHT = 64;
export const LANE_WIDTH = 20;
export const LANE_PADDING = 8;
export const NODE_RADIUS = 5;
export const MAX_LANES = 2;

/**
 * Colors for lanes in the revision graph
 */
export const LANE_COLORS = [
	"var(--chart-1, #5f7cff)",
	"var(--chart-2, #34c759)",
	"var(--chart-3, #ffcc00)",
	"var(--chart-4, #8b5cf6)",
	"var(--chart-5, #ff5fd2)",
	"var(--primary, #5f7cff)",
];

/**
 * Convert a lane index to X coordinate
 */
export function laneToX(lane: number): number {
	return LANE_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

/**
 * Get the color for a lane index
 */
export function laneColor(lane: number): string {
	return LANE_COLORS[lane % LANE_COLORS.length];
}
