import { createCollection, createTransaction } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { listen } from "@tauri-apps/api/event";
import type { ChangedFile, Repository, Revision } from "@/tauri-commands";
import {
	getCommitRecency,
	getRepositories,
	getRevisionChanges,
	getRevisionDiff,
	getRevisions,
	jjAbandon,
	jjEdit,
	jjNew,
	removeRepository,
	upsertRepository,
	watchRepository,
} from "@/tauri-commands";

// ============================================================================
// Query Client (shared by all collections)
// ============================================================================

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Number.POSITIVE_INFINITY, // Data fresh until watcher invalidates
			gcTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false, // Watcher handles this
			refetchOnMount: false, // Already have data from watcher
		},
	},
});

// ============================================================================
// In-flight Mutation Tracking
// ============================================================================

const inFlightMutations = new Set<string>();

function trackMutation<T>(mutationId: string, promise: Promise<T>): Promise<T> {
	inFlightMutations.add(mutationId);
	return promise.finally(() => {
		inFlightMutations.delete(mutationId);
	});
}

// ============================================================================
// Shared Repository Watcher (one per repo, invalidates all queries)
// ============================================================================

const repoWatchers = new Map<string, { unlisten: () => void; refCount: number }>();

async function setupRepoWatcher(repoPath: string): Promise<void> {
	const existing = repoWatchers.get(repoPath);
	if (existing) {
		existing.refCount++;
		return;
	}

	await watchRepository(repoPath);
	const unlisten = await listen<string>("repo-changed", async (event) => {
		if (event.payload === repoPath) {
			// Skip if there are in-flight mutations - let the mutation handle state
			if (inFlightMutations.size > 0) {
				console.log("[watcher] skipping - in-flight mutations:", [...inFlightMutations]);
				return;
			}

			console.log("[watcher] invalidating queries for:", repoPath);
			// Invalidate ALL queries for this repo - TanStack Query will refetch
			await queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["revision-changes", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["revision-diff", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["commit-recency", repoPath] });
		}
	});

	repoWatchers.set(repoPath, { unlisten, refCount: 1 });
}

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

export type RepositoriesCollection = typeof repositoriesCollection;

export async function addRepository(collection: RepositoriesCollection, repository: Repository) {
	// Optimistic update first
	collection.utils.writeUpsert([repository]);

	try {
		await upsertRepository(repository);
		console.log("[addRepository] upsertRepository completed");
	} catch (err) {
		// Revert on failure
		collection.utils.writeDelete(repository.id);
		console.error("[addRepository] failed, reverting:", err);
		throw err;
	}
}

export async function updateRepository(collection: RepositoriesCollection, repository: Repository) {
	// Get current state for potential revert
	const current = collection.state.get(repository.id);

	// Optimistic update
	collection.utils.writeUpsert([repository]);

	try {
		await upsertRepository(repository);
		console.log("[updateRepository] upsertRepository completed");
	} catch (err) {
		// Revert on failure
		if (current) {
			collection.utils.writeUpsert([current]);
		} else {
			collection.utils.writeDelete(repository.id);
		}
		console.error("[updateRepository] failed, reverting:", err);
		throw err;
	}
}

export async function deleteRepository(collection: RepositoriesCollection, repositoryId: string) {
	// Get current state for potential revert
	const current = collection.state.get(repositoryId);

	// Optimistic delete
	collection.utils.writeDelete(repositoryId);

	try {
		await removeRepository(repositoryId);
		console.log("[deleteRepository] removeRepository completed");
	} catch (err) {
		// Revert on failure
		if (current) {
			collection.utils.writeUpsert([current]);
		}
		console.error("[deleteRepository] failed, reverting:", err);
		throw err;
	}
}

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

function createRevisionsCollection(repoPath: string, preset?: string, customRevset?: string) {
	const limit = preset === "full_history" ? 10000 : 100;

	// Set up the shared watcher (idempotent - increments refCount if already exists)
	setupRepoWatcher(repoPath);

	return createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revisions", repoPath, preset, customRevset],
			queryFn: () => getRevisions(repoPath, limit, customRevset, customRevset ? undefined : preset),
			getKey: getRevisionKey,
		}),
	});
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
	const mutationId = `edit-${Date.now()}-${Math.random()}`;
	console.log("[editRevision] start, mutationId:", mutationId);

	// Optimistic update
	const updates: Revision[] = [];
	if (currentWcRevision && getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)) {
		updates.push({ ...currentWcRevision, is_working_copy: false });
	}
	updates.push({ ...targetRevision, is_working_copy: true });
	collection.utils.writeUpsert(updates);

	// Track the mutation and fire backend
	trackMutation(mutationId, jjEdit(repoPath, targetRevision.change_id_short))
		.then(() => {
			console.log("[editRevision] completed");
			// Invalidate to get fresh data from backend
			queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
		})
		.catch((err) => {
			console.error("[editRevision] failed:", err);
			// Revert optimistic update
			const revertUpdates: Revision[] = [];
			if (
				currentWcRevision &&
				getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)
			) {
				revertUpdates.push({ ...currentWcRevision, is_working_copy: true });
			}
			revertUpdates.push({ ...targetRevision, is_working_copy: false });
			collection.utils.writeUpsert(revertUpdates);
		});
}

export function newRevision(repoPath: string, parentChangeIds: string[]) {
	const mutationId = `new-${Date.now()}-${Math.random()}`;
	console.log("[newRevision] start, mutationId:", mutationId);

	const tx = createTransaction({
		mutationFn: async () => {
			await trackMutation(mutationId, jjNew(repoPath, parentChangeIds));
			// Invalidate to get fresh data including the new revision
			await queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
		},
	});

	tx.mutate(() => {
		// No optimistic update - we don't know the new revision's ID
		// TanStack Query invalidation will add it to the collection
	});

	return tx;
}

export function abandonRevision(
	collection: RevisionsCollection,
	repoPath: string,
	revision: Revision,
	_limit: number,
	_customRevset?: string,
	_preset?: string,
) {
	const mutationId = `abandon-${Date.now()}-${Math.random()}`;
	console.log("[abandonRevision] abandoning:", revision.change_id_short, "mutationId:", mutationId);

	// For working copy, jj creates a new WC - can't do optimistic delete
	// For other revisions, we can optimistically remove
	if (!revision.is_working_copy) {
		collection.utils.writeDelete(getRevisionKey(revision));
	}

	// Track the mutation and fire backend
	trackMutation(mutationId, jjAbandon(repoPath, revision.change_id_short))
		.then(() => {
			console.log("[abandonRevision] completed");
			// Invalidate to get fresh data (especially for WC abandon which creates new WC)
			queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
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

const revisionChangesCollections = new Map<
	string,
	ReturnType<typeof createRevisionChangesCollection>
>();

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

export function getRevisionChangesCollection(
	repoPath: string,
	changeId: string,
): RevisionChangesCollection {
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

export function getRevisionDiffCollection(
	repoPath: string,
	changeId: string,
): RevisionDiffCollection {
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

// ============================================================================
// Commit Recency Collection (for branch ordering)
// ============================================================================

// Wrapper type for commit recency data to work with collection pattern
interface CommitRecencyEntry {
	id: "recency";
	data: Record<string, number>;
}

const commitRecencyCollections = new Map<
	string,
	ReturnType<typeof createCommitRecencyCollection>
>();

function createCommitRecencyCollection(repoPath: string) {
	return createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["commit-recency", repoPath],
			queryFn: async () => {
				const recency = await getCommitRecency(repoPath, 500);
				return [{ id: "recency" as const, data: recency }];
			},
			getKey: (entry: CommitRecencyEntry) => entry.id,
			staleTime: 30_000, // 30 seconds - this one uses time-based staleness
		}),
	});
}

export type CommitRecencyCollection = ReturnType<typeof createCommitRecencyCollection>;

export function getCommitRecencyCollection(repoPath: string): CommitRecencyCollection {
	const cacheKey = repoPath;
	let collection = commitRecencyCollections.get(cacheKey);
	if (!collection) {
		collection = createCommitRecencyCollection(repoPath);
		commitRecencyCollections.set(cacheKey, collection);
	}
	return collection;
}

export const emptyCommitRecencyCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["commit-recency", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: (entry: CommitRecencyEntry) => entry.id,
	}),
});
