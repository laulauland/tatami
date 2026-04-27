import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { Repository } from "@/tauri-commands";
import { getRepositories, removeRepository, upsertRepository } from "@/tauri-commands";
import { queryClient } from "../query-client";

// ============================================================================
// Repositories Collection
// ============================================================================

const repositoriesQueryKey = ["repositories"] as const;

export const repositoriesCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: repositoriesQueryKey,
		queryFn: getRepositories,
		getKey: (repository: Repository) => repository.id,
	}),
});

export type RepositoriesCollection = typeof repositoriesCollection;

/** Ensure repositories are loaded. Returns the list. */
export async function ensureRepositories(): Promise<Repository[]> {
	return queryClient.ensureQueryData({
		queryKey: repositoriesQueryKey,
		queryFn: getRepositories,
	});
}

export async function addRepository(collection: RepositoriesCollection, repository: Repository) {
	// Optimistic update first
	collection.utils.writeUpsert([repository]);

	try {
		await upsertRepository(repository);
	} catch (err) {
		// Revert on failure
		collection.utils.writeDelete(repository.id);
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
	} catch (err) {
		// Revert on failure
		if (current) {
			collection.utils.writeUpsert([current]);
		} else {
			collection.utils.writeDelete(repository.id);
		}
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
	} catch (err) {
		// Revert on failure
		if (current) {
			collection.utils.writeUpsert([current]);
		}
		throw err;
	}
}
