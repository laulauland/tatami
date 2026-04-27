import { Effect } from "effect";
import { queryClient } from "./query-client";
import {
	revisionChangesQueryKey,
	revisionDiffQueryKey,
	type ChangeRecord,
	type DiffRecord,
} from "@/hooks/useRevisionData";
import { getChangesBatchEffect, getDiffsBatchEffect } from "@/tauri-commands";

/**
 * Prefetch revision diffs into TanStack Query's payload cache.
 */
export function prefetchRevisionDiffs(repoPath: string, changeIds: string[]): void {
	const missing = changeIds.filter(
		(changeId) => !queryClient.getQueryData<DiffRecord>(revisionDiffQueryKey(repoPath, changeId)),
	);
	if (missing.length === 0) return;

	void Effect.runPromise(getDiffsBatchEffect(repoPath, missing)).then((diffs) => {
		for (const diff of diffs) {
			queryClient.setQueryData(revisionDiffQueryKey(repoPath, diff.change_id), {
				repoPath,
				changeId: diff.change_id,
				content: diff.diff,
			} satisfies DiffRecord);
		}
	});
}

/**
 * Prefetch revision changed-file lists into TanStack Query's payload cache.
 */
export function prefetchRevisionChanges(repoPath: string, changeIds: string[]): void {
	const missing = changeIds.filter(
		(changeId) =>
			!queryClient.getQueryData<ChangeRecord[]>(revisionChangesQueryKey(repoPath, changeId)),
	);
	if (missing.length === 0) return;

	void Effect.runPromise(getChangesBatchEffect(repoPath, missing)).then((changesList) => {
		for (const changes of changesList) {
			queryClient.setQueryData(
				revisionChangesQueryKey(repoPath, changes.change_id),
				changes.files.map(
					(file) =>
						({
							repoPath,
							changeId: changes.change_id,
							path: file.path,
							status: file.status,
						}) satisfies ChangeRecord,
				),
			);
		}
	});
}
