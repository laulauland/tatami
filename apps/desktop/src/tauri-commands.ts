import { invoke } from "@tauri-apps/api/core";

export type {
	ChangedFile,
	DiffHunk,
	DiffLine,
	FileDiff,
	Repository,
	Revision,
	WorkingCopyStatus,
} from "./schemas";

import type { FileDiff, Repository, Revision, WorkingCopyStatus } from "./schemas";

export async function findRepository(startPath: string): Promise<string | null> {
	return invoke<string | null>("find_repository", { startPath });
}

export async function getRevisions(
	repoPath: string,
	limit: number,
	revset?: string,
	preset?: string,
): Promise<Revision[]> {
	return invoke<Revision[]>("get_revisions", { repoPath, limit, revset, preset });
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

export async function getRepositories(): Promise<Repository[]> {
	return invoke<Repository[]>("get_projects");
}

export async function upsertRepository(repository: Repository): Promise<void> {
	return invoke("upsert_project", { project: repository });
}

export async function findRepositoryByPath(path: string): Promise<Repository | null> {
	return invoke<Repository | null>("find_project_by_path", { path });
}

export async function removeRepository(repositoryId: string): Promise<void> {
	return invoke("remove_project", { projectId: repositoryId });
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
