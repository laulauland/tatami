import { createCollection, createTransaction } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { listen } from "@tauri-apps/api/event";
import type { ChangedFile, Repository, Revision } from "@/tauri-commands";
import {
	getRepositories,
	getRevisionChanges,
	getRevisionDiff,
	getRevisions,
	jjAbandon,
	jjEdit,
	jjNew,
	watchRepository,
} from "@/tauri-commands";

// ============================================================================
// Query Client (shared by all collections)
// ============================================================================

export const queryClient = new QueryClient();

// ============================================================================
// Repositories Collection
// ============================================================================

export const repositoriesCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["repositories"],
		queryFn: getRepositories,
		getKey: (repository: Repository) => repository.id,
	}),
});

// ============================================================================
// Revisions Collection
// ============================================================================

// Key function that handles divergent changes (same change_id, different commits)
function getRevisionKey(revision: Revision): string {
	if (revision.divergent_index != null) {
		return `${revision.change_id}/${revision.divergent_index}`;
	}
	return revision.change_id;
}

export const emptyRevisionsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["revisions", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: getRevisionKey,
	}),
});

const revisionCollections = new Map<string, ReturnType<typeof createRevisionsCollection>>();
const revisionWatchers = new Map<string, { unlisten: () => void; refCount: number }>();

// Track in-flight edit mutations to prevent watcher from overwriting optimistic state
const inFlightEdits = new Set<string>();

function createRevisionsCollection(repoPath: string, preset?: string, customRevset?: string) {
	const limit = preset === "full_history" ? 10000 : 100;
	const collection = createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revisions", repoPath, preset, customRevset],
			queryFn: () => getRevisions(repoPath, limit, customRevset, customRevset ? undefined : preset),
			getKey: getRevisionKey,
		}),
	});

	// Set up file watcher with refcounting
	const setupWatcher = async () => {
		const existing = revisionWatchers.get(repoPath);
		if (existing) {
			existing.refCount++;
			return;
		}

		await watchRepository(repoPath);
		const unlisten = await listen<string>("repo-changed", async (event) => {
			if (event.payload === repoPath) {
				// Skip if there are in-flight edits - let the mutation handle state
				if (inFlightEdits.size > 0) {
					console.log("[watcher] skipping - in-flight edits:", [...inFlightEdits]);
					return;
				}

				console.log("[watcher] fetching revisions...");
				const revisions = await getRevisions(
					repoPath,
					limit,
					customRevset,
					customRevset ? undefined : preset,
				);

				// Debug: log divergent changes
				const divergentCount = revisions.filter((r) => r.is_divergent).length;
				if (divergentCount > 0) {
					console.log("[watcher] found", divergentCount, "divergent revisions");
				}

				console.log("[watcher] got", revisions.length, "revisions, wc:", revisions.find(r => r.is_working_copy)?.change_id_short);

				// Delete revisions that are no longer in the result set
				const newKeys = new Set(revisions.map(getRevisionKey));
				for (const key of collection.state.keys()) {
					if (!newKeys.has(key)) {
						collection.utils.writeDelete(key);
					}
				}

				collection.utils.writeUpsert(revisions);
			}
		});

		revisionWatchers.set(repoPath, { unlisten, refCount: 1 });
	};

	setupWatcher();

	return collection;
}

export type RevisionsCollection = ReturnType<typeof createRevisionsCollection>;

export function getRevisionsCollection(repoPath: string, preset?: string, customRevset?: string) {
	const cacheKey = `${repoPath}:${preset ?? "full_history"}:${customRevset ?? ""}`;
	let collection = revisionCollections.get(cacheKey);
	if (!collection) {
		collection = createRevisionsCollection(repoPath, preset, customRevset);
		revisionCollections.set(cacheKey, collection);
	}
	return collection;
}

export function editRevision(
	collection: RevisionsCollection,
	repoPath: string,
	targetRevision: Revision,
	currentWcRevision: Revision | null,
) {
	console.log("[editRevision] start, updating synced layer directly");

	// Update synced layer directly (not optimistic) - this is instant
	const updates: Revision[] = [];

	if (currentWcRevision && getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)) {
		updates.push({ ...currentWcRevision, is_working_copy: false });
	}
	updates.push({ ...targetRevision, is_working_copy: true });

	collection.utils.writeUpsert(updates);
	console.log("[editRevision] synced layer updated, firing backend...");

	// Fire backend in background - watcher will confirm/correct if needed
	// For divergent changes, use change_id_short which includes /N suffix
	jjEdit(repoPath, targetRevision.change_id_short)
		.then(() => console.log("[editRevision] jjEdit completed"))
		.catch((err) => {
			console.error("[editRevision] jjEdit failed:", err);
			// Revert on failure
			const revertUpdates: Revision[] = [];
			if (currentWcRevision && getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)) {
				revertUpdates.push({ ...currentWcRevision, is_working_copy: true });
			}
			revertUpdates.push({ ...targetRevision, is_working_copy: false });
			collection.utils.writeUpsert(revertUpdates);
		});
}

export function newRevision(repoPath: string, parentChangeIds: string[]) {
	const tx = createTransaction({
		mutationFn: async () => {
			await jjNew(repoPath, parentChangeIds);
		},
	});

	tx.mutate(() => {
		// No optimistic update - we don't know the new revision's ID
		// File watcher will add it to the collection
	});

	return tx;
}

export function abandonRevision(
	collection: RevisionsCollection,
	repoPath: string,
	revision: Revision,
	limit: number,
	customRevset?: string,
	preset?: string,
) {
	console.log("[abandonRevision] abandoning:", revision.change_id_short);

	// For working copy, jj creates a new WC - can't do optimistic delete
	// For other revisions, we can optimistically remove
	if (!revision.is_working_copy) {
		collection.utils.writeDelete(getRevisionKey(revision));
	}

	// Fire backend and then refetch to get new state (especially for WC abandon which creates new WC)
	jjAbandon(repoPath, revision.change_id_short)
		.then(async () => {
			console.log("[abandonRevision] completed, refetching...");
			// Refetch to get the new working copy if we abandoned WC
			const revisions = await getRevisions(repoPath, limit, customRevset, customRevset ? undefined : preset);
			const newKeys = new Set(revisions.map(getRevisionKey));
			for (const key of collection.state.keys()) {
				if (!newKeys.has(key)) {
					collection.utils.writeDelete(key);
				}
			}
			collection.utils.writeUpsert(revisions);
		})
		.catch((err) => {
			console.error("[abandonRevision] failed:", err);
			// Re-add on failure (only if we deleted it)
			if (!revision.is_working_copy) {
				collection.utils.writeUpsert([revision]);
			}
		});
}

// ============================================================================
// Revision Changes Collections (ChangedFile[] per revision)
// ============================================================================

const revisionChangesCollections = new Map<string, ReturnType<typeof createRevisionChangesCollection>>();

function createRevisionChangesCollection(repoPath: string, changeId: string) {
	return createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revision-changes", repoPath, changeId],
			queryFn: () => getRevisionChanges(repoPath, changeId),
			getKey: (file: ChangedFile) => file.path,
		}),
	});
}

export type RevisionChangesCollection = ReturnType<typeof createRevisionChangesCollection>;

export function getRevisionChangesCollection(repoPath: string, changeId: string): RevisionChangesCollection {
	const cacheKey = `${repoPath}:${changeId}`;
	let collection = revisionChangesCollections.get(cacheKey);
	if (!collection) {
		collection = createRevisionChangesCollection(repoPath, changeId);
		revisionChangesCollections.set(cacheKey, collection);
	}
	return collection;
}

export const emptyChangesCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["revision-changes", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: (file: ChangedFile) => file.path,
	}),
});

// ============================================================================
// Revision Diff Collections (diff string per revision)
// ============================================================================

// Wrapper type for diff string to work with collection pattern
interface DiffEntry {
	id: "diff";
	content: string;
}

const revisionDiffCollections = new Map<string, ReturnType<typeof createRevisionDiffCollection>>();

function createRevisionDiffCollection(repoPath: string, changeId: string) {
	return createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revision-diff", repoPath, changeId],
			queryFn: async () => {
				const diff = await getRevisionDiff(repoPath, changeId);
				return [{ id: "diff" as const, content: diff }];
			},
			getKey: (entry: DiffEntry) => entry.id,
		}),
	});
}

export type RevisionDiffCollection = ReturnType<typeof createRevisionDiffCollection>;

export function getRevisionDiffCollection(repoPath: string, changeId: string): RevisionDiffCollection {
	const cacheKey = `${repoPath}:${changeId}`;
	let collection = revisionDiffCollections.get(cacheKey);
	if (!collection) {
		collection = createRevisionDiffCollection(repoPath, changeId);
		revisionDiffCollections.set(cacheKey, collection);
	}
	return collection;
}

export const emptyDiffCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["revision-diff", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: (entry: DiffEntry) => entry.id,
	}),
});

// ============================================================================
// Prefetching Utilities
// ============================================================================

/**
 * Prefetch revision diffs for a batch of change IDs.
 * This eagerly creates collections which triggers the query fetch.
 * TanStack DB handles caching - subsequent calls are no-ops.
 */
export function prefetchRevisionDiffs(repoPath: string, changeIds: string[]): void {
	for (const changeId of changeIds) {
		// Creating the collection triggers the query if not already cached
		getRevisionDiffCollection(repoPath, changeId);
	}
}

/**
 * Prefetch revision changes (file list) for a batch of change IDs.
 */
export function prefetchRevisionChanges(repoPath: string, changeIds: string[]): void {
	for (const changeId of changeIds) {
		getRevisionChangesCollection(repoPath, changeId);
	}
}
