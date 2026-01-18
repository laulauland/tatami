import type { Revision } from "@/tauri-commands";

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
	/** Number of hidden revisions in the collapsed stack */
	collapsedCount?: number;
	/** If set, this edge is part of an expanded stack and clicking it should collapse */
	expandedStackId?: string;
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
}
