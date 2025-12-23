import { invoke } from "@tauri-apps/api/core";

export type {
	Revision,
	ChangedFile,
	WorkingCopyStatus,
	DiffLine,
	DiffHunk,
	FileDiff,
	Project,
} from "./schemas";

import type { FileDiff, Project, Revision, WorkingCopyStatus } from "./schemas";

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

export async function getProjects(): Promise<Project[]> {
	return invoke<Project[]>("get_projects");
}

export async function upsertProject(project: Project): Promise<void> {
	return invoke("upsert_project", { project });
}

export async function findProjectByPath(path: string): Promise<Project | null> {
	return invoke<Project | null>("find_project_by_path", { path });
}

export async function watchRepository(repoPath: string): Promise<void> {
	return invoke("watch_repository", { repoPath });
}

export async function unwatchRepository(repoPath: string): Promise<void> {
	return invoke("unwatch_repository", { repoPath });
}

export async function jjNew(repoPath: string, parentChangeIds: string[]): Promise<void> {
	return invoke("jj_new", { repoPath, parentChangeIds });
}

export async function jjEdit(repoPath: string, changeId: string): Promise<void> {
	return invoke("jj_edit", { repoPath, changeId });
}
