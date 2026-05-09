import { Data, Effect } from "effect";
import type { MutationResult } from "../../../src-electrobun/shared/rpc.ts";
import { FrontendRuntime } from "../runtime.ts";
import { NativeClient } from "../services/NativeClient.ts";
import { populateOperations, DEFAULT_OPERATIONS_LIMIT } from "./operations.ts";
import { populateRevisions } from "./revisions.ts";

export type SyncOperation = "syncRepository";

export class SyncError extends Data.TaggedError("SyncError")<{
	readonly operation: SyncOperation;
	readonly cause: unknown;
}> {}

export type SyncRepositoryResult = {
	fetch: MutationResult;
	push: MutationResult | null;
	pushedBookmarks: string[];
};

export async function syncRepository(repoPath: string): Promise<SyncRepositoryResult> {
	try {
		const result = await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				const fetch = yield* nativeClient.gitFetch({ repoPath, remote: "origin" });
				const revisionsAfterFetch = yield* nativeClient.getRevisions({ repoPath, limit: 100 });
				const pushedBookmarks = Array.from(
					new Set(
						revisionsAfterFetch.flatMap((revision) =>
							revision.bookmarks
								.filter((bookmark) => bookmark.is_ahead)
								.map((bookmark) => bookmark.name),
						),
					),
				);

				const push =
					pushedBookmarks.length > 0
						? yield* nativeClient.gitPush({
								repoPath,
								remote: "origin",
								bookmarkNames: pushedBookmarks,
							})
						: null;
				const revisions = yield* nativeClient.getRevisions({ repoPath, limit: 50 });
				const operations = yield* nativeClient.getOperations({
					repoPath,
					limit: DEFAULT_OPERATIONS_LIMIT,
				});
				return { fetch, push, pushedBookmarks, revisions, operations };
			}),
		);

		await populateRevisions(result.revisions);
		await populateOperations(result.operations);

		return {
			fetch: result.fetch,
			push: result.push,
			pushedBookmarks: result.pushedBookmarks,
		};
	} catch (cause) {
		throw new SyncError({ operation: "syncRepository", cause });
	}
}
