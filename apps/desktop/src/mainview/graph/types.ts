import type { RevisionStub as Revision } from "../../../src-electrobun/shared/rpc.ts";

/**
 * Type of connection between revisions
 */
export type GraphEdgeType = "direct" | "indirect" | "missing";

/**
 * Represents a semantic binding between two revisions (like tldraw's shape bindings)
 */
export interface EdgeBinding {
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
	/** Number of elided revisions in the collapsed stack */
	collapsedCount?: number;
	/** If set, this edge is part of an expanded stack and clicking it should collapse */
	expandedStackId?: string;
}

/**
 * Edge binding annotated with the display rows it spans.
 */
export interface EdgeInterval {
	minRow: number;
	maxRow: number;
	order: number;
	data: EdgeBinding;
}

/**
 * Interval index for querying edges that intersect a visible row range.
 */
export interface EdgeIntervalIndex {
	byMinRow: EdgeInterval[];
	byMaxRow: EdgeInterval[];
	edgeCount: number;
}

/**
 * Connection from a revision to one of its parents
 */
export interface ParentConnection {
	parentRow: number;
	parentLane: number;
	edgeType: GraphEdgeType;
	isDeemphasized?: boolean;
	isMissingStub?: boolean;
}

/**
 * A node in the revision graph
 */
export interface GraphNode {
	revision: Revision;
	row: number;
	lane: number;
	parentConnections: ParentConnection[];
}

/**
 * A row in the revision graph
 */
export interface GraphRow {
	revision: Revision;
	lane: number;
	/** Rightmost lane occupied by any graph element (node or edge) on this row */
	maxLaneOnRow: number;
}

/**
 * Complete graph data structure
 */
export interface GraphData {
	nodes: GraphNode[];
	laneCount: number;
	rows: GraphRow[];
	edgeBindings: EdgeBinding[];
	edgeIntervalIndex: EdgeIntervalIndex;
}
