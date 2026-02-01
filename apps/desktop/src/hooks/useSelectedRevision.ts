import { useMemo } from "react";
import { getRevisionKey } from "@/db";
import { traceLog } from "@/lib/trace";
import type { Revision } from "@/tauri-commands";

/**
 * Hook to compute the selected revision from URL param and revisions array.
 * Uses memoization for stability and includes trace logging for debugging.
 *
 * @param revisions - Array of revisions to search
 * @param rev - URL param value (can be change_id or revision key like "tpuq/0")
 * @returns The selected revision or null if not found
 */
export function useSelectedRevision(
	revisions: Revision[],
	rev: string | undefined,
): Revision | null {
	return useMemo(() => {
		if (revisions.length === 0) return null;

		if (rev) {
			// Match using revision key to handle divergent revisions (e.g., "tpuq/0")
			const found = revisions.find((r) => getRevisionKey(r) === rev);
			if (found) {
				traceLog("selectedRevision-from-rev", { rev, changeId: found.change_id });
				return found;
			}
		}

		// Fallback to working copy or first revision
		const fallback = revisions.find((r) => r.is_working_copy) || revisions[0];
		traceLog("selectedRevision-fallback", { changeId: fallback?.change_id });
		return fallback;
	}, [revisions, rev]);
}
