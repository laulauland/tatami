import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { getRevisionDiff } from "@/tauri-commands";
import { queryClient } from "../query-client";

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
