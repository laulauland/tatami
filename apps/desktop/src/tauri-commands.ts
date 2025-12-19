import { invoke } from "@tauri-apps/api/core";

export interface Revision {
	commit_id: string;
	change_id: string;
	description: string;
	author: string;
	timestamp: string;
	is_working_copy: boolean;
	is_immutable: boolean;
	bookmarks: string[];
}

export interface ChangedFile {
	path: string;
	status: "added" | "modified" | "deleted";
}

export interface WorkingCopyStatus {
	repo_path: string;
	change_id: string;
	files: ChangedFile[];
}

export interface DiffLine {
	line_type: "context" | "add" | "remove";
	content: string;
	old_line_number: number | null;
	new_line_number: number | null;
}

export interface DiffHunk {
	old_start: number;
	old_count: number;
	new_start: number;
	new_count: number;
	lines: DiffLine[];
}

export interface FileDiff {
	path: string;
	hunks: DiffHunk[];
}

export async function findRepository(startPath: string): Promise<string | null> {
	return invoke<string | null>("find_repository", { startPath });
}

export async function getRevisions(repoPath: string, limit: number): Promise<Revision[]> {
	return invoke<Revision[]>("get_revisions", { repoPath, limit });
}

export async function getStatus(repoPath: string): Promise<WorkingCopyStatus> {
	return invoke<WorkingCopyStatus>("get_status", { repoPath });
}

export async function getFileDiff(
	repoPath: string,
	changeId: string,
	filePath: string,
): Promise<FileDiff> {
	return invoke<FileDiff>("get_file_diff", { repoPath, changeId, filePath });
}
