/**
 * Revision payload hooks for diffs and changed-file lists.
 *
 * Entity state lives in TanStack DB collections, while large revision payloads
 * stay in TanStack Query. Query owns caching, prefetching, invalidation, and
 * retry state for diff strings and changed-file arrays.
 */

import { Effect } from "effect";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { queryClient } from "@/data/query-client";
import { traceLog } from "@/lib/trace";
import {
	getChangesBatchEffect,
	getDiffsBatchEffect,
	getRevisionChanges,
	getRevisionDiff,
	type RevisionChanges,
	type RevisionDiff,
} from "@/tauri-commands";

export interface DiffRecord {
	repoPath: string;
	changeId: string;
	content: string;
}

export interface ChangeRecord {
	repoPath: string;
	changeId: string;
	path: string;
	status: "added" | "modified" | "deleted";
}

export function revisionDiffQueryKey(repoPath: string, changeId: string) {
	return ["revision-diff", repoPath, changeId] as const;
}

export function revisionChangesQueryKey(repoPath: string, changeId: string) {
	return ["revision-changes", repoPath, changeId] as const;
}

function toDiffRecord(repoPath: string, diff: RevisionDiff): DiffRecord {
	return {
		repoPath,
		changeId: diff.change_id,
		content: diff.diff,
	};
}

function toChangeRecords(repoPath: string, changes: RevisionChanges): ChangeRecord[] {
	return changes.files.map((file) => ({
		repoPath,
		changeId: changes.change_id,
		path: file.path,
		status: file.status,
	}));
}

async function fetchDiff(repoPath: string, changeId: string): Promise<DiffRecord> {
	const content = await getRevisionDiff(repoPath, changeId);
	return { repoPath, changeId, content };
}

async function fetchChanges(repoPath: string, changeId: string): Promise<ChangeRecord[]> {
	const files = await getRevisionChanges(repoPath, changeId);
	return files.map((file) => ({ repoPath, changeId, path: file.path, status: file.status }));
}

/**
 * Read a single revision diff from TanStack Query.
 */
export function useDiff(repoPath: string, changeId: string | null): DiffRecord | undefined {
	const { data } = useQuery({
		queryKey: changeId
			? revisionDiffQueryKey(repoPath, changeId)
			: ["revision-diff", repoPath, null],
		queryFn: () => fetchDiff(repoPath, changeId ?? ""),
		enabled: !!repoPath && !!changeId,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	return data;
}

/**
 * Read changed files for a revision from TanStack Query.
 */
export function useChanges(
	repoPath: string,
	changeId: string | null,
): { data: ChangeRecord[]; isLoaded: boolean } {
	const { data = [], isSuccess } = useQuery({
		queryKey: changeId
			? revisionChangesQueryKey(repoPath, changeId)
			: ["revision-changes", repoPath, null],
		queryFn: () => fetchChanges(repoPath, changeId ?? ""),
		enabled: !!repoPath && !!changeId,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	return { data, isLoaded: !changeId || isSuccess };
}

/**
 * Suspense-compatible diff hook. Data may still be undefined if called without a
 * matching prefetched/cache entry, preserving the previous public shape.
 */
export function useDiffSuspense(repoPath: string, changeId: string): DiffRecord | undefined {
	const { data } = useQuery({
		queryKey: revisionDiffQueryKey(repoPath, changeId),
		queryFn: () => fetchDiff(repoPath, changeId),
		enabled: !!repoPath && !!changeId,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	traceLog("useDiffSuspense", { changeId, hasData: !!data });
	return data;
}

/**
 * Suspense-compatible changed-file hook.
 */
export function useChangesSuspense(repoPath: string, changeId: string): ChangeRecord[] {
	const { data = [] } = useQuery({
		queryKey: revisionChangesQueryKey(repoPath, changeId),
		queryFn: () => fetchChanges(repoPath, changeId),
		enabled: !!repoPath && !!changeId,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});

	traceLog("useChangesSuspense", { changeId, fileCount: data.length });
	return data;
}

/**
 * Lineage calculations are currently disabled.
 */
export function useLineage(
	_repoPath: string,
	_changeId: string | null,
): { lineage: Set<string>; isLoaded: boolean } {
	return { lineage: new Set<string>(), isLoaded: true };
}

async function prefetchDiffBatch(repoPath: string, ids: string[]): Promise<void> {
	const missing = ids.filter(
		(id) => !queryClient.getQueryData<DiffRecord>(revisionDiffQueryKey(repoPath, id)),
	);
	if (missing.length === 0) return;

	const diffs = await Effect.runPromise(getDiffsBatchEffect(repoPath, missing));

	for (const diff of diffs) {
		queryClient.setQueryData(
			revisionDiffQueryKey(repoPath, diff.change_id),
			toDiffRecord(repoPath, diff),
		);
	}
}

async function prefetchChangesBatch(repoPath: string, ids: string[]): Promise<void> {
	const missing = ids.filter(
		(id) => !queryClient.getQueryData<ChangeRecord[]>(revisionChangesQueryKey(repoPath, id)),
	);
	if (missing.length === 0) return;

	const changesList = await Effect.runPromise(getChangesBatchEffect(repoPath, missing));

	for (const changes of changesList) {
		queryClient.setQueryData(
			revisionChangesQueryKey(repoPath, changes.change_id),
			toChangeRecords(repoPath, changes),
		);
	}
}

/**
 * Prefetch hook for components that need to load payloads ahead of interaction.
 */
export function usePrefetch(repoPath: string): {
	prefetchDiffs: (ids: string[]) => void;
	prefetchChanges: (ids: string[]) => void;
	prefetchLineage: (ids: string[]) => void;
	flushDiffs: () => Promise<void>;
	flushChanges: () => Promise<void>;
	flushLineage: () => Promise<void>;
} {
	// ast-grep-ignore: no-react-memoization
	return useMemo(() => {
		let pendingDiffFlush: Promise<void> = Promise.resolve();
		let pendingChangesFlush: Promise<void> = Promise.resolve();

		return {
			prefetchDiffs: (ids: string[]) => {
				if (!repoPath || ids.length === 0) return;
				traceLog("prefetch-diffs", { count: ids.length, ids });
				pendingDiffFlush = prefetchDiffBatch(repoPath, ids);
			},
			prefetchChanges: (ids: string[]) => {
				if (!repoPath || ids.length === 0) return;
				traceLog("prefetch-changes", { count: ids.length, ids });
				pendingChangesFlush = prefetchChangesBatch(repoPath, ids);
			},
			prefetchLineage: (_ids: string[]) => {},
			flushDiffs: () => pendingDiffFlush,
			flushChanges: () => pendingChangesFlush,
			flushLineage: () => Promise.resolve(),
		};
	}, [repoPath]);
}
