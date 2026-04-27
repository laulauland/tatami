import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { ChangedFile } from "@/tauri-commands";
import { getRevisionChanges } from "@/tauri-commands";
import { queryClient } from "../query-client";

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
			queryFn: async () => {
				return await getRevisionChanges(repoPath, changeId);
			},
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
