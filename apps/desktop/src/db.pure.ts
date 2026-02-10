/**
 * Pure utility functions extracted from db.ts for use in tests
 * and other contexts that don't need the full TanStack DB setup.
 */

import type { Revision } from "@/schemas";

/** Key function that handles divergent changes (same change_id, different commits) */
export function getRevisionKey(revision: Revision): string {
	if (revision.divergent_index != null) {
		return `${revision.change_id}/${revision.divergent_index}`;
	}
	return revision.change_id;
}
