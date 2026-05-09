import { Schema } from "effect";

export const GraphEdgeType = Schema.Literal("direct", "indirect", "missing");
export type GraphEdgeType = typeof GraphEdgeType.Type;

export const ParentEdge = Schema.Struct({
	parent_id: Schema.String,
	edge_type: GraphEdgeType,
});
export type ParentEdge = typeof ParentEdge.Type;

export const BookmarkInfo = Schema.Struct({
	name: Schema.String,
	is_tracked: Schema.Boolean,
	remote: Schema.NullOr(Schema.String),
	is_ahead: Schema.Boolean,
	is_behind: Schema.Boolean,
	is_conflicted: Schema.Boolean,
});
export type BookmarkInfo = typeof BookmarkInfo.Type;

export const Revision = Schema.Struct({
	commit_id: Schema.String,
	change_id: Schema.String,
	change_id_short: Schema.String,
	parent_edges: Schema.Array(ParentEdge),
	children_ids: Schema.Array(Schema.String),
	description: Schema.String,
	author: Schema.String,
	timestamp: Schema.String,
	is_working_copy: Schema.Boolean,
	is_immutable: Schema.Boolean,
	is_mine: Schema.Boolean,
	is_trunk: Schema.Boolean,
	is_divergent: Schema.Boolean,
	divergent_index: Schema.NullOr(Schema.Number),
	has_conflict: Schema.Boolean,
	bookmarks: Schema.Array(BookmarkInfo),
});
export type Revision = typeof Revision.Type;

export const Revisions = Schema.Array(Revision);
export type Revisions = typeof Revisions.Type;
