import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { getCommitRecency } from "@/tauri-commands";
import { queryClient } from "../query-client";

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
