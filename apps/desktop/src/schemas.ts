import { Schema } from "effect";

export const Revision = Schema.Struct({
	commit_id: Schema.String,
	change_id: Schema.String,
	change_id_short: Schema.String,
	parent_ids: Schema.Array(Schema.String),
	description: Schema.String,
	author: Schema.String,
	timestamp: Schema.String,
	is_working_copy: Schema.Boolean,
	is_immutable: Schema.Boolean,
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

export const DiffLineType = Schema.Literal("context", "add", "remove");
export type DiffLineType = typeof DiffLineType.Type;

export const DiffLine = Schema.Struct({
	line_type: DiffLineType,
	content: Schema.String,
	old_line_number: Schema.NullOr(Schema.Number),
	new_line_number: Schema.NullOr(Schema.Number),
});
export type DiffLine = typeof DiffLine.Type;

export const DiffHunk = Schema.Struct({
	old_start: Schema.Number,
	old_count: Schema.Number,
	new_start: Schema.Number,
	new_count: Schema.Number,
	lines: Schema.Array(DiffLine),
});
export type DiffHunk = typeof DiffHunk.Type;

export const FileDiff = Schema.Struct({
	path: Schema.String,
	hunks: Schema.Array(DiffHunk),
});
export type FileDiff = typeof FileDiff.Type;

export const Project = Schema.Struct({
	id: Schema.String,
	path: Schema.String,
	name: Schema.String,
	last_opened_at: Schema.Number,
});
export type Project = typeof Project.Type;
