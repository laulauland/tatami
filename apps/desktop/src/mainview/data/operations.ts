import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { Data, Effect } from "effect";
import type { Operation, MutationResult } from "../../../src-electrobun/shared/rpc.ts";
import { FrontendRuntime } from "../runtime.ts";
import { NativeClient } from "../services/NativeClient.ts";
import { populateRevisions } from "./revisions.ts";

export const DEFAULT_OPERATIONS_LIMIT = 50;

export type OperationLogOperation = "loadOperations" | "undoOperation";

export class OperationLogError extends Data.TaggedError("OperationLogError")<{
	readonly operation: OperationLogOperation;
	readonly cause: unknown;
}> {}

export function getOperationKey(operation: Operation): string {
	return operation.id;
}

export const operationsCollection = createCollection(
	localOnlyCollectionOptions<Operation, string>({
		id: "operations",
		getKey: getOperationKey,
	}),
);

export async function populateOperations(operations: Operation[]): Promise<void> {
	const existingKeys = [...operationsCollection.keys()];

	if (existingKeys.length > 0) {
		await operationsCollection.delete(existingKeys).isPersisted.promise;
	}

	if (operations.length > 0) {
		await operationsCollection.insert(operations).isPersisted.promise;
	}
}

export async function loadOperations(
	repoPath: string,
	limit = DEFAULT_OPERATIONS_LIMIT,
): Promise<Operation[]> {
	try {
		const operations = await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				return yield* nativeClient.getOperations({ repoPath, limit });
			}),
		);
		await populateOperations(operations);
		return operations;
	} catch (cause) {
		throw new OperationLogError({ operation: "loadOperations", cause });
	}
}

export async function undoOperation(
	repoPath: string,
	operationId: string,
): Promise<MutationResult> {
	try {
		const result = await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				return yield* nativeClient.undoOperation({ repoPath, operationId });
			}),
		);

		const [revisions, operations] = await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				const revisions = yield* nativeClient.getRevisions({ repoPath, limit: 50 });
				const operations = yield* nativeClient.getOperations({
					repoPath,
					limit: DEFAULT_OPERATIONS_LIMIT,
				});
				return [revisions, operations] as const;
			}),
		);
		await populateRevisions(revisions);
		await populateOperations(operations);

		return result;
	} catch (cause) {
		throw new OperationLogError({ operation: "undoOperation", cause });
	}
}
