import { invoke } from "@tauri-apps/api/core";

export type {
	ChangedFile,
	Repository,
	Revision,
	WorkingCopyStatus,
} from "./schemas";

import type { ChangedFile, Repository, Revision, WorkingCopyStatus } from "./schemas";

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
): Promise<string> {
	return invoke<string>("get_file_diff", { repoPath, changeId, filePath });
}

export async function getRevisionDiff(repoPath: string, changeId: string): Promise<string> {
	return invoke<string>("get_revision_diff", { repoPath, changeId });
}

export async function getRevisionChanges(
	repoPath: string,
	changeId: string,
): Promise<ChangedFile[]> {
	return invoke<ChangedFile[]>("get_revision_changes", { repoPath, changeId });
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

export async function jjAbandon(repoPath: string, changeId: string): Promise<void> {
	return invoke("jj_abandon", { repoPath, changeId });
}

/** Get recency data for commits - returns commit_id (hex) -> timestamp_millis when last WC */
export async function getCommitRecency(
	repoPath: string,
	limit: number,
): Promise<Record<string, number>> {
	return invoke<Record<string, number>>("get_commit_recency", { repoPath, limit });
}

/** Result of resolving a revset expression */
export interface RevsetResult {
	change_ids: string[];
	error: string | null;
}

/** Resolve a revset expression using jj-lib's full parser */
export async function resolveRevset(repoPath: string, revset: string): Promise<RevsetResult> {
	return invoke<RevsetResult>("resolve_revset", { repoPath, revset });
}
