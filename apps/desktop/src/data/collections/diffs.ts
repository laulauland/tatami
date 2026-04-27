import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { queryClient } from "../query-client";

// ============================================================================
// Unified Diffs Collection (single collection for all revision diffs)
// ============================================================================

/**
 * Unified diff record - stores diff content keyed by repoPath:changeId.
 * This replaces the per-revision collection pattern which caused GC issues.
 */
export interface DiffRecord {
	repoPath: string;
	changeId: string;
	content: string;
	prerenderedUnified?: string;
	prerenderedSplit?: string;
}

function getDiffRecordKey(d: DiffRecord): string {
	return `${d.repoPath}:${d.changeId}`;
}

const diffsQueryKey = ["diffs"] as const;

export const diffsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: diffsQueryKey,
		queryFn: async () => [] as DiffRecord[],
		getKey: getDiffRecordKey,
	}),
	startSync: true,
});

export type DiffsCollection = typeof diffsCollection;
