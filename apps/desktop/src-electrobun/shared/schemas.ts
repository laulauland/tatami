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

export const MutationResult = Schema.Struct({
	operation_id: Schema.String,
	change_id: Schema.NullOr(Schema.String),
});
export type MutationResult = typeof MutationResult.Type;

export const Operation = Schema.Struct({
	id: Schema.String,
	parent_ids: Schema.Array(Schema.String),
	description: Schema.String,
	timestamp: Schema.String,
	user: Schema.String,
	hostname: Schema.String,
	working_copy_change_id: Schema.NullOr(Schema.String),
});
export type Operation = typeof Operation.Type;

export const Operations = Schema.Array(Operation);
export type Operations = typeof Operations.Type;

export const ChangeIds = Schema.Array(Schema.String);
export type ChangeIds = typeof ChangeIds.Type;

export const ChangedFileStatus = Schema.Literal("modified", "added", "deleted");
export type ChangedFileStatus = typeof ChangedFileStatus.Type;

export const ChangedFile = Schema.Struct({
	path: Schema.String,
	status: ChangedFileStatus,
});
export type ChangedFile = typeof ChangedFile.Type;

export const ChangedFiles = Schema.Array(ChangedFile);
export type ChangedFiles = typeof ChangedFiles.Type;

export const RevisionDiff = Schema.Struct({
	change_id: Schema.String,
	diff: Schema.String,
});
export type RevisionDiff = typeof RevisionDiff.Type;

export const RevisionDiffs = Schema.Array(RevisionDiff);
export type RevisionDiffs = typeof RevisionDiffs.Type;

export const RevisionChanges = Schema.Struct({
	change_id: Schema.String,
	files: Schema.Array(ChangedFile),
});
export type RevisionChanges = typeof RevisionChanges.Type;

export const RevisionChangesBatch = Schema.Array(RevisionChanges);
export type RevisionChangesBatch = typeof RevisionChangesBatch.Type;
