import { invoke } from "@tauri-apps/api/core";
import { Effect } from "effect";
import { traceEnd, traceStart } from "@/lib/trace";

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

export async function getConflictPaths(repoPath: string, changeId: string): Promise<string[]> {
	return invoke<string[]>("get_conflict_paths", { repoPath, changeId });
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

/** Result of fetching diff for a single revision in a batch */
export interface RevisionDiff {
	change_id: string;
	diff: string;
}

/** Result of fetching changed files for a single revision in a batch */
export interface RevisionChanges {
	change_id: string;
	files: ChangedFile[];
}

/** Fetch diffs for multiple revisions in a single IPC call */
export function getDiffsBatchEffect(
	repoPath: string,
	changeIds: string[],
): Effect.Effect<RevisionDiff[], Error> {
	return Effect.tryPromise({
		try: async () => {
			const spanId = traceStart("ipc-get-diffs-batch", { count: changeIds.length });
			const result = await invoke<RevisionDiff[]>("get_diffs_batch", { repoPath, changeIds });
			traceEnd(spanId, { count: result.length });
			return result;
		},
		catch: (error) => new Error(`Failed to fetch diffs batch: ${error}`),
	});
}

/** Fetch changed files for multiple revisions in a single IPC call */
export function getChangesBatchEffect(
	repoPath: string,
	changeIds: string[],
): Effect.Effect<RevisionChanges[], Error> {
	return Effect.tryPromise({
		try: async () => {
			const spanId = traceStart("ipc-get-changes-batch", { count: changeIds.length });
			const result = await invoke<RevisionChanges[]>("get_changes_batch", { repoPath, changeIds });
			traceEnd(spanId, { count: result.length });
			return result;
		},
		catch: (error) => new Error(`Failed to fetch changes batch: ${error}`),
	});
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

export async function generateChangeIds(repoPath: string, count: number): Promise<string[]> {
	return invoke<string[]>("generate_change_ids", { repoPath, count });
}

/** Result of a mutation operation */
export interface MutationResult {
	operation_id: string;
	change_id: string | null;
}

export async function jjNew(
	repoPath: string,
	parentChangeIds: string[],
	changeId?: string,
): Promise<MutationResult> {
	return invoke<MutationResult>("jj_new", {
		repoPath,
		parentChangeIds,
		changeId: changeId ?? null,
	});
}

export async function jjEdit(repoPath: string, changeId: string): Promise<MutationResult> {
	return invoke<MutationResult>("jj_edit", { repoPath, changeId });
}

export async function jjAbandon(repoPath: string, changeId: string): Promise<MutationResult> {
	return invoke<MutationResult>("jj_abandon", { repoPath, changeId });
}

export async function jjDescribe(
	repoPath: string,
	changeId: string,
	description: string,
): Promise<MutationResult> {
	return invoke<MutationResult>("jj_describe", { repoPath, changeId, description });
}

export async function jjSquash(repoPath: string, changeId: string): Promise<MutationResult> {
	return invoke<MutationResult>("jj_squash", { repoPath, changeId });
}

export async function jjRebase(
	repoPath: string,
	sourceChangeId: string,
	destinationChangeId: string,
): Promise<MutationResult> {
	return invoke<MutationResult>("jj_rebase", {
		repoPath,
		sourceChangeId,
		destinationChangeId,
	});
}

export async function jjGitFetch(repoPath: string, remote?: string): Promise<MutationResult> {
	return invoke<MutationResult>("jj_git_fetch", {
		repoPath,
		remote: remote ?? null,
	});
}

export async function jjGitPush(
	repoPath: string,
	bookmarkNames: string[],
	remote?: string,
): Promise<MutationResult> {
	return invoke<MutationResult>("jj_git_push", {
		repoPath,
		remote: remote ?? null,
		bookmarkNames,
	});
}

/** An operation in the jj operation log */
export interface Operation {
	id: string;
	parent_ids: string[];
	description: string;
	timestamp: string;
	user: string;
	hostname: string;
	working_copy_change_id: string | null;
}

/** List operations from newest to oldest */
export async function getOperations(repoPath: string, limit: number): Promise<Operation[]> {
	return invoke<Operation[]>("get_operations", { repoPath, limit });
}

/** Undo a specific operation by reverting it */
export async function undoOperation(repoPath: string, operationId: string): Promise<void> {
	return invoke("undo_operation", { repoPath, operationId });
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

/** Result of computing lineage for a revision */
export interface LineageResult {
	change_id: string;
	related_ids: string[];
}

/** Fetch lineage for multiple revisions in a single IPC call */
export function getLineageBatchEffect(
	repoPath: string,
	changeIds: string[],
): Effect.Effect<LineageResult[], Error> {
	return Effect.tryPromise({
		try: async () => {
			const spanId = traceStart("ipc-get-lineage-batch", { count: changeIds.length });
			const result = await invoke<LineageResult[]>("get_lineage_batch", { repoPath, changeIds });
			traceEnd(spanId, { count: result.length });
			return result;
		},
		catch: (error) => new Error(`Failed to fetch lineage batch: ${error}`),
	});
}

/** Result of fetching file content as base64 */
export interface FileContentResult {
	base64: string;
	size: number;
}

/** Get file content as base64 for displaying binary files like images */
export async function getFileContentBase64(
	repoPath: string,
	changeId: string,
	filePath: string,
	version: "current" | "parent",
): Promise<FileContentResult> {
	return invoke<FileContentResult>("get_file_content_base64", {
		repoPath,
		changeId,
		filePath,
		version,
	});
}
