import { getRevisionChangesCollection } from "./collections/revision-changes";
import { getRevisionDiffCollection } from "./collections/revision-diffs";

// ============================================================================
// Prefetching Utilities
// ============================================================================

/**
 * Prefetch revision diffs for a batch of change IDs.
 * This eagerly creates collections which triggers the query fetch.
 * TanStack DB handles caching - subsequent calls are no-ops.
 */
export function prefetchRevisionDiffs(repoPath: string, changeIds: string[]): void {
	// Just trigger the data fetch for all revisions
	for (const changeId of changeIds) {
		getRevisionDiffCollection(repoPath, changeId);
	}
}

/**
 * Prefetch revision changes (file list) for a batch of change IDs.
 */
export function prefetchRevisionChanges(repoPath: string, changeIds: string[]): void {
	for (const changeId of changeIds) {
		getRevisionChangesCollection(repoPath, changeId);
	}
}
