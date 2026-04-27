import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { getOperations, type Operation } from "@/tauri-commands";
import { queryClient } from "../query-client";

// ============================================================================
// Operations Collection
// ============================================================================

const DEFAULT_OPERATIONS_LIMIT = 50;

function operationsQueryKey(repoPath: string, limit = DEFAULT_OPERATIONS_LIMIT) {
	return ["operations", repoPath, limit] as const;
}

export function getOperationKey(operation: Operation): string {
	return operation.id;
}

export const emptyOperationsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["operations", "empty"],
		queryFn: () => Promise.resolve([] as Operation[]),
		getKey: getOperationKey,
	}),
});

const operationCollections = new Map<string, ReturnType<typeof createOperationsCollection>>();

function createOperationsCollection(repoPath: string, limit = DEFAULT_OPERATIONS_LIMIT) {
	return createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: operationsQueryKey(repoPath, limit),
			queryFn: () => getOperations(repoPath, limit),
			getKey: getOperationKey,
		}),
	});
}

export type OperationsCollection = ReturnType<typeof createOperationsCollection>;

export function getOperationsCollection(
	repoPath: string,
	limit = DEFAULT_OPERATIONS_LIMIT,
): OperationsCollection {
	const cacheKey = `${repoPath}:${limit}`;
	let collection = operationCollections.get(cacheKey);
	if (!collection) {
		collection = createOperationsCollection(repoPath, limit);
		operationCollections.set(cacheKey, collection);
	}
	return collection;
}

export async function invalidateOperations(repoPath: string): Promise<void> {
	await queryClient.invalidateQueries({ queryKey: ["operations", repoPath] });
}

/**
 * Refresh operation-log state after a jj mutation returns an operation ID.
 *
 * This keeps the operation log as the reconciliation backbone without blocking
 * the optimistic mutation's perceived responsiveness: callers can fire and
 * forget this after their primary revision/status invalidation.
 */
export async function reconcileOperation(repoPath: string, operationId: string): Promise<void> {
	await invalidateOperations(repoPath);

	const knownCollections = [...operationCollections.entries()].filter(([key]) =>
		key.startsWith(`${repoPath}:`),
	);
	for (const [, collection] of knownCollections) {
		await collection.preload();
		if (collection.state.has(operationId)) {
			return;
		}
	}
}
