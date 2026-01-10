import { createCollection, createTransaction } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { listen } from "@tauri-apps/api/event";
import type { Repository, Revision } from "@/tauri-commands";
import { getRepositories, getRevisions, jjEdit, jjNew, watchRepository } from "@/tauri-commands";

export const queryClient = new QueryClient();

export const repositoriesCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["repositories"],
		queryFn: getRepositories,
		getKey: (repository: Repository) => repository.id,
	}),
});

export const emptyRevisionsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["revisions", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: (revision: Revision) => revision.change_id,
	}),
});

const revisionCollections = new Map<string, ReturnType<typeof createRevisionsCollection>>();
const revisionWatchers = new Map<string, { unlisten: () => void; refCount: number }>();

function createRevisionsCollection(repoPath: string, preset?: string, customRevset?: string) {
	const limit = preset === "full_history" ? 10000 : 100;
	const collection = createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revisions", repoPath, preset, customRevset],
			queryFn: () => getRevisions(repoPath, limit, customRevset, customRevset ? undefined : preset),
			getKey: (revision: Revision) => revision.change_id,
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
				const revisions = await getRevisions(
					repoPath,
					limit,
					customRevset,
					customRevset ? undefined : preset,
				);
				const newIds = new Set(revisions.map((r) => r.change_id));
				for (const key of collection.state.keys()) {
					if (!newIds.has(key)) {
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
	repoPath: string,
	targetChangeId: string,
	currentWcChangeId: string | null,
) {
	const collection = getRevisionsCollection(repoPath);
	const tx = createTransaction({
		mutationFn: async () => {
			await jjEdit(repoPath, targetChangeId);
		},
	});

	tx.mutate(() => {
		if (currentWcChangeId && currentWcChangeId !== targetChangeId) {
			collection.update(currentWcChangeId, (draft) => {
				draft.is_working_copy = false;
			});
		}
		collection.update(targetChangeId, (draft) => {
			draft.is_working_copy = true;
		});
	});

	return tx;
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
