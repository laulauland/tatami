import { Schema } from "effect";

export const GraphEdgeType = Schema.Literal("direct", "indirect", "missing");
export type GraphEdgeType = typeof GraphEdgeType.Type;

export const ParentEdge = Schema.Struct({
	parent_id: Schema.String,
	edge_type: GraphEdgeType,
});
export type ParentEdge = typeof ParentEdge.Type;

export const Revision = Schema.Struct({
	commit_id: Schema.String,
	change_id: Schema.String,
	change_id_short: Schema.String,
	parent_ids: Schema.Array(Schema.String),
	parent_edges: Schema.Array(ParentEdge),
	description: Schema.String,
	author: Schema.String,
	timestamp: Schema.String,
	is_working_copy: Schema.Boolean,
	is_immutable: Schema.Boolean,
	is_mine: Schema.Boolean,
	is_trunk: Schema.Boolean,
	is_divergent: Schema.Boolean,
	divergent_index: Schema.NullOr(Schema.Number),
	bookmarks: Schema.Array(Schema.String),
});
export type Revision = typeof Revision.Type;

export const ChangedFileStatus = Schema.Literal("added", "modified", "deleted");
export type ChangedFileStatus = typeof ChangedFileStatus.Type;

export const ChangedFile = Schema.Struct({
	path: Schema.String,
	status: ChangedFileStatus,
});
export type ChangedFile = typeof ChangedFile.Type;

export const WorkingCopyStatus = Schema.Struct({
	repo_path: Schema.String,
	change_id: Schema.String,
	files: Schema.Array(ChangedFile),
});
export type WorkingCopyStatus = typeof WorkingCopyStatus.Type;

export const Repository = Schema.Struct({
	id: Schema.String,
	path: Schema.String,
	name: Schema.String,
	last_opened_at: Schema.Number,
	revset_preset: Schema.NullOr(Schema.String),
});
export type Repository = typeof Repository.Type;
