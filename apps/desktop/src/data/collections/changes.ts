import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryClient } from "../query-client";

// ============================================================================
// Unified Changes Collection (single collection for all revision file lists)
// ============================================================================

/**
 * Unified change record - stores changed files keyed by repoPath:changeId:path.
 * This replaces the per-revision collection pattern which caused GC issues.
 */
export interface ChangeRecord {
	repoPath: string;
	changeId: string;
	path: string;
	status: "added" | "modified" | "deleted";
}

function getChangeRecordKey(c: ChangeRecord): string {
	return `${c.repoPath}:${c.changeId}:${c.path}`;
}

const changesQueryKey = ["changes"] as const;

export const changesCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: changesQueryKey,
		queryFn: async () => [] as ChangeRecord[],
		getKey: getChangeRecordKey,
	}),
	startSync: true,
});

export type ChangesCollection = typeof changesCollection;
