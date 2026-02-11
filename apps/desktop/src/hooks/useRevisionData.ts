/**
 * Revision data hooks for diffs and changes.
 *
 * Provides React hooks that connect BatchLoader instances to TanStack DB collections,
 * enabling efficient batched fetching with instant reads from local state.
 */

import { and, eq, useLiveQuery, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useMemo, useRef } from "react";
import { type ChangeRecord, changesCollection, type DiffRecord, diffsCollection } from "@/db";
import { type BatchLoader, createBatchLoader } from "@/lib/batch-loader";
import { traceLog } from "@/lib/trace";
import {
	getChangesBatchEffect,
	getDiffsBatchEffect,
	type RevisionChanges,
	type RevisionDiff,
} from "@/tauri-commands";

// ============================================================================
// Loader Factory Functions
// ============================================================================

/**
 * Creates a BatchLoader for revision diffs.
 * The loader batches IPC calls and syncs results to the unified diffsCollection.
 */
function createDiffLoader(repoPath: string): BatchLoader {
	return createBatchLoader<RevisionDiff>({
		debounceMs: 50,
		maxBatchSize: 20,
		fetchBatch: (ids) => getDiffsBatchEffect(repoPath, ids),
		syncToCollection: (diffs) => {
			// Wait for collection to be ready before writing
			if (diffsCollection.status !== "ready") return;
			const records: DiffRecord[] = diffs.map((d) => ({
				repoPath,
				changeId: d.change_id,
				content: d.diff,
			}));
			diffsCollection.utils.writeUpsert(records);

			// LRU eviction: keep only last 100 diffs
			const MAX_DIFFS = 100;
			const allRecords = Array.from(diffsCollection.state.values());
			if (allRecords.length > MAX_DIFFS) {
				// Remove oldest entries (first ones in the Map iteration order)
				const toRemove = allRecords.slice(0, allRecords.length - MAX_DIFFS);
				for (const record of toRemove) {
					const key = `${record.repoPath}:${record.changeId}`;
					diffsCollection.state.delete(key);
				}
			}
		},
		isLoaded: (id) => {
			if (diffsCollection.status !== "ready") return false;
			const key = `${repoPath}:${id}`;
			return diffsCollection.state.has(key);
		},
	});
}

/**
 * Creates a BatchLoader for revision changes (file lists).
 * The loader batches IPC calls and syncs results to the unified changesCollection.
 */
function createChangesLoader(repoPath: string): BatchLoader {
	return createBatchLoader<RevisionChanges>({
		debounceMs: 50,
		maxBatchSize: 20,
		fetchBatch: (ids) => getChangesBatchEffect(repoPath, ids),
		syncToCollection: (changesList) => {
			// Wait for collection to be ready before writing
			if (changesCollection.status !== "ready") return;
			const records: ChangeRecord[] = [];
			for (const changes of changesList) {
				for (const file of changes.files) {
					records.push({
						repoPath,
						changeId: changes.change_id,
						path: file.path,
						status: file.status,
					});
				}
			}
			changesCollection.utils.writeUpsert(records);

			// LRU eviction: keep only last 500 change records
			const MAX_CHANGES = 500;
			const allRecords = Array.from(changesCollection.state.values());
			if (allRecords.length > MAX_CHANGES) {
				// Remove oldest entries (first ones in the Map iteration order)
				const toRemove = allRecords.slice(0, allRecords.length - MAX_CHANGES);
				for (const record of toRemove) {
					const key = `${record.repoPath}:${record.changeId}:${record.path}`;
					changesCollection.state.delete(key);
				}
			}
		},
		isLoaded: (id) => {
			// Wait for collection to be ready
			if (changesCollection.status !== "ready") return false;
			// Check if we have any record for this changeId in this repo
			for (const [key] of changesCollection.state) {
				if (key.startsWith(`${repoPath}:${id}:`)) {
					return true;
				}
			}
			return false;
		},
	});
}

// ============================================================================
// Loader Instance Cache
// ============================================================================

// Cache loaders per repoPath to avoid creating multiple instances
const diffLoaders = new Map<string, BatchLoader>();
const changesLoaders = new Map<string, BatchLoader>();

/**
 * Clean up loaders for repos we're no longer viewing.
 * Called when the active repoPath changes to prevent memory leaks.
 */
function cleanupLoadersExcept(currentRepoPath: string): void {
	for (const [path] of diffLoaders) {
		if (path !== currentRepoPath) {
			diffLoaders.delete(path);
		}
	}
	for (const [path] of changesLoaders) {
		if (path !== currentRepoPath) {
			changesLoaders.delete(path);
		}
	}
}

function getDiffLoader(repoPath: string): BatchLoader {
	let loader = diffLoaders.get(repoPath);
	if (!loader) {
		loader = createDiffLoader(repoPath);
		diffLoaders.set(repoPath, loader);
	}
	return loader;
}

function getChangesLoader(repoPath: string): BatchLoader {
	let loader = changesLoaders.get(repoPath);
	if (!loader) {
		loader = createChangesLoader(repoPath);
		changesLoaders.set(repoPath, loader);
	}
	return loader;
}

// ============================================================================
// React Hooks
// ============================================================================

/**
 * Read a single diff from local DB. Returns undefined if not yet loaded.
 * Call prefetchDiffs to trigger loading.
 */
export function useDiff(repoPath: string, changeId: string | null): DiffRecord | undefined {
	// Use selective query - only re-renders when THIS specific diff changes
	const { data } = useLiveQuery(
		(q) =>
			changeId
				? q
						.from({ diffs: diffsCollection })
						.where(({ diffs }) => and(eq(diffs.repoPath, repoPath), eq(diffs.changeId, changeId)))
						.findOne()
				: null,
		[repoPath, changeId],
	);

	return data;
}

/**
 * Read changes (file list) for a revision from local DB.
 * Returns { data, isLoaded } to distinguish between "loading" and "genuinely empty".
 * Call prefetchChanges to trigger loading.
 */
export function useChanges(
	repoPath: string,
	changeId: string | null,
): { data: ChangeRecord[]; isLoaded: boolean } {
	// Use selective query - only re-renders when changes for THIS revision update
	const { data = [], isReady } = useLiveQuery(
		(q) =>
			changeId
				? q
						.from({ changes: changesCollection })
						.where(({ changes }) =>
							and(eq(changes.repoPath, repoPath), eq(changes.changeId, changeId)),
						)
				: null,
		[repoPath, changeId],
	);

	// isLoaded is true when:
	// 1. No changeId requested (nothing to load)
	// 2. Query is ready AND we have data (data was fetched)
	// 3. Query is ready AND data is empty but was explicitly fetched
	// We track "explicitly fetched" by checking if the changeId exists in the collection's loaded set
	// For now, we use isReady as a proxy - if the query ran and returned, the data is loaded
	const isLoaded = !changeId || isReady;

	return { data, isLoaded };
}

// ============================================================================
// Suspense-enabled Hooks
// ============================================================================

/**
 * Read a single diff from local DB with Suspense support.
 * Throws a promise when data isn't ready, caught by Suspense boundary.
 * Data is guaranteed to be defined when returned.
 *
 * @throws Promise when data is loading (caught by Suspense boundary)
 */
export function useDiffSuspense(repoPath: string, changeId: string): DiffRecord | undefined {
	const { data } = useLiveSuspenseQuery(
		(q) =>
			q
				.from({ diffs: diffsCollection })
				.where(({ diffs }) => and(eq(diffs.repoPath, repoPath), eq(diffs.changeId, changeId)))
				.findOne(),
		[repoPath, changeId],
	);

	traceLog("useDiffSuspense", { changeId, hasData: !!data });

	return data;
}

/**
 * Read changes (file list) for a revision from local DB with Suspense support.
 * Throws a promise when data isn't ready, caught by Suspense boundary.
 * Data is guaranteed to be defined when returned.
 *
 * @throws Promise when data is loading (caught by Suspense boundary)
 */
export function useChangesSuspense(repoPath: string, changeId: string): ChangeRecord[] {
	const { data } = useLiveSuspenseQuery(
		(q) =>
			q
				.from({ changes: changesCollection })
				.where(({ changes }) =>
					and(eq(changes.repoPath, repoPath), eq(changes.changeId, changeId)),
				),
		[repoPath, changeId],
	);

	traceLog("useChangesSuspense", { changeId, fileCount: data.length });

	return data;
}

/**
 * Read lineage (related revision IDs) for a revision from local DB.
 * Returns { lineage, isLoaded } to allow callers to handle loading state.
 *
 * Stub: lineage calculations disabled - always returns empty/loaded.
 */
export function useLineage(
	_repoPath: string,
	_changeId: string | null,
): { lineage: Set<string>; isLoaded: boolean } {
	return { lineage: new Set<string>(), isLoaded: true };
}

/**
 * Prefetch hook for components that need to load data ahead of user interaction.
 * Returns functions to queue prefetch requests and flush them immediately if needed.
 */
export function usePrefetch(repoPath: string): {
	prefetchDiffs: (ids: string[]) => void;
	prefetchChanges: (ids: string[]) => void;
	prefetchLineage: (ids: string[]) => void;
	flushDiffs: () => Promise<void>;
	flushChanges: () => Promise<void>;
	flushLineage: () => Promise<void>;
} {
	// Use refs to avoid recreating loaders on each render
	const diffLoaderRef = useRef<BatchLoader | null>(null);
	const changesLoaderRef = useRef<BatchLoader | null>(null);
	const currentRepoPathRef = useRef<string>(repoPath);

	// Reset loaders if repoPath changes
	if (currentRepoPathRef.current !== repoPath) {
		currentRepoPathRef.current = repoPath;
		diffLoaderRef.current = null;
		changesLoaderRef.current = null;
		// Clean up loaders for other repos to prevent memory leaks
		cleanupLoadersExcept(repoPath);
	}

	return useMemo(() => {
		function getDiffLoaderInstance(): BatchLoader {
			if (!diffLoaderRef.current) {
				diffLoaderRef.current = getDiffLoader(repoPath);
			}
			return diffLoaderRef.current;
		}

		function getChangesLoaderInstance(): BatchLoader {
			if (!changesLoaderRef.current) {
				changesLoaderRef.current = getChangesLoader(repoPath);
			}
			return changesLoaderRef.current;
		}

		return {
			prefetchDiffs: (ids: string[]) => {
				traceLog("prefetch-diffs", { count: ids.length, ids });
				getDiffLoaderInstance().queueMany(ids);
			},
			prefetchChanges: (ids: string[]) => {
				traceLog("prefetch-changes", { count: ids.length, ids });
				getChangesLoaderInstance().queueMany(ids);
			},
			prefetchLineage: (_ids: string[]) => {},
			flushDiffs: () => getDiffLoaderInstance().flushPromise(),
			flushChanges: () => getChangesLoaderInstance().flushPromise(),
			flushLineage: () => Promise.resolve(),
		};
	}, [repoPath]);
}
