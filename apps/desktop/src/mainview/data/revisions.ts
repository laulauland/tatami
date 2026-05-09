import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import type { RevisionStub } from "../../../src-electrobun/shared/rpc.ts";

export function getRevisionKey(revision: RevisionStub): string {
	return revision.divergent_index != null
		? `${revision.change_id}/${revision.divergent_index}`
		: revision.change_id;
}

export const revisionsCollection = createCollection(
	localOnlyCollectionOptions<RevisionStub, string>({
		id: "revisions",
		getKey: getRevisionKey,
	}),
);

export async function populateRevisions(revisions: RevisionStub[]): Promise<void> {
	const existingKeys = [...revisionsCollection.keys()];

	if (existingKeys.length > 0) {
		await revisionsCollection.delete(existingKeys).isPersisted.promise;
	}

	if (revisions.length > 0) {
		await revisionsCollection.insert(revisions).isPersisted.promise;
	}
}
