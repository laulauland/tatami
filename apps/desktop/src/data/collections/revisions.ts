import { createCollection, createOptimisticAction, type WritableDeep } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { toast } from "@/components/ui/sonner";
import type { Revision } from "@/tauri-commands";
import {
	getRevisions,
	jjAbandon,
	jjDescribe,
	jjEdit,
	jjNew,
	jjRebase,
	jjSquash,
	undoOperation,
} from "@/tauri-commands";
import { consumeChangeId } from "../change-id-pool";
import { trackMutation } from "../mutation-tracker";
import { queryClient } from "../query-client";
import { invalidateRepositoryQueries } from "../watchers";
import { reconcileOperation } from "./operations";

function mutationSuccessWithUndo(
	repoPath: string,
	operationId: string,
	title: string,
	description?: string,
) {
	void reconcileOperation(repoPath, operationId);
	toast.success(title, {
		description,
		action: {
			label: "Undo",
			onClick: () => {
				undoOperation(repoPath, operationId)
					.then(() => {
						void invalidateRepositoryQueries(repoPath);
						toast.success("Undo successful");
					})
					.catch((error) => {
						toast.error(`Undo failed: ${error}`, { duration: Number.POSITIVE_INFINITY });
					});
			},
		},
	});
}

// ============================================================================
// Revisions Collection
// ============================================================================

// Key function that handles divergent changes (same change_id, different commits)
export function getRevisionKey(revision: Revision): string {
	if (revision.divergent_index != null) {
		return `${revision.change_id}/${revision.divergent_index}`;
	}
	return revision.change_id;
}

export const emptyRevisionsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["revisions", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: getRevisionKey,
	}),
});

const revisionCollections = new Map<string, ReturnType<typeof createRevisionsCollection>>();

function createRevisionsCollection(repoPath: string, preset?: string) {
	const limit = preset === "full_history" ? 10000 : 100;

	return createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revisions", repoPath, preset],
			queryFn: () => getRevisions(repoPath, limit, undefined, preset),
			getKey: getRevisionKey,
		}),
	});
}

export type RevisionsCollection = ReturnType<typeof createRevisionsCollection>;

export function getRevisionsCollection(repoPath: string, preset?: string) {
	const cacheKey = `${repoPath}:${preset ?? "full_history"}`;
	let collection = revisionCollections.get(cacheKey);
	if (!collection) {
		collection = createRevisionsCollection(repoPath, preset);
		revisionCollections.set(cacheKey, collection);
	}
	return collection;
}

type CollectionMutationMethods = {
	insert?: (revision: Revision) => void;
	update?: (key: string, updater: (draft: WritableDeep<Revision>) => void) => void;
	delete?: (key: string) => void;
	utils?: {
		writeUpsert?: (revisions: Revision[]) => void;
		writeDelete?: (key: string) => void;
		refetch?: () => Promise<unknown>;
	};
	preload?: () => Promise<unknown>;
};

function collectionMethods(collection: RevisionsCollection): CollectionMutationMethods {
	return collection as CollectionMutationMethods;
}

function optimisticUpdate(
	collection: RevisionsCollection,
	revision: Revision,
	updater: (draft: WritableDeep<Revision>) => void,
): void {
	const methods = collectionMethods(collection);
	if (methods.update) {
		methods.update(getRevisionKey(revision), updater);
		return;
	}
	const next = { ...revision } as WritableDeep<Revision>;
	updater(next);
	methods.utils?.writeUpsert?.([next]);
}

function optimisticInsert(collection: RevisionsCollection, revision: Revision): void {
	const methods = collectionMethods(collection);
	if (methods.insert) {
		methods.insert(revision);
		return;
	}
	methods.utils?.writeUpsert?.([revision]);
}

function optimisticDelete(collection: RevisionsCollection, revision: Revision): void {
	const methods = collectionMethods(collection);
	const key = getRevisionKey(revision);
	if (methods.delete) {
		methods.delete(key);
		return;
	}
	methods.utils?.writeDelete?.(key);
}

async function refetchRevisions(collection: RevisionsCollection): Promise<void> {
	const methods = collectionMethods(collection);
	if (methods.utils?.refetch) {
		await methods.utils.refetch();
		return;
	}
	await methods.preload?.();
}

function uniqueMutationId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}

function supportsCollectionTransactions(collection: RevisionsCollection): boolean {
	const methods = collectionMethods(collection);
	return !!(methods.insert || methods.update || methods.delete);
}

export function editRevision(
	collection: RevisionsCollection,
	repoPath: string,
	targetRevision: Revision,
	currentWcRevision: Revision | null,
) {
	const mutationId = uniqueMutationId("edit");
	const action = createOptimisticAction<void>({
		metadata: { mutationId, kind: "jj-edit", repoPath },
		onMutate: () => {
			if (
				currentWcRevision &&
				getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)
			) {
				optimisticUpdate(collection, currentWcRevision, (draft) => {
					draft.is_working_copy = false;
				});
			}
			optimisticUpdate(collection, targetRevision, (draft) => {
				draft.is_working_copy = true;
			});
		},
		mutationFn: async () => {
			const result = await trackMutation(
				mutationId,
				jjEdit(repoPath, targetRevision.change_id_short),
			);
			await refetchRevisions(collection);
			void reconcileOperation(repoPath, result.operation_id);
			toast.success(`Working copy is now ${targetRevision.change_id_short}`);
			return result;
		},
	});

	const transaction = action();
	if (supportsCollectionTransactions(collection)) {
		transaction.isPersisted.promise.catch((error) => {
			toast.error(`Failed to edit revision: ${error}`, { duration: Number.POSITIVE_INFINITY });
		});
		return;
	}

	trackMutation(mutationId, jjEdit(repoPath, targetRevision.change_id_short))
		.then((result) => {
			void reconcileOperation(repoPath, result.operation_id);
			toast.success(`Working copy is now ${targetRevision.change_id_short}`);
		})
		.catch((error) => {
			if (
				currentWcRevision &&
				getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)
			) {
				optimisticUpdate(collection, currentWcRevision, (draft) => {
					draft.is_working_copy = true;
				});
			}
			optimisticUpdate(collection, targetRevision, (draft) => {
				draft.is_working_copy = false;
			});
			toast.error(`Failed to edit revision: ${error}`, { duration: Number.POSITIVE_INFINITY });
		});
}

export function newRevision(
	collection: RevisionsCollection,
	repoPath: string,
	parentChangeIds: string[],
	parentRevision: Revision,
	currentWcRevision: Revision | null,
) {
	const mutationId = uniqueMutationId("new");
	const preAllocatedChangeId = consumeChangeId(repoPath);

	const optimisticRevision: Revision | null = preAllocatedChangeId
		? {
				commit_id: `pending-${preAllocatedChangeId}`,
				change_id: preAllocatedChangeId,
				change_id_short: preAllocatedChangeId.slice(0, 8),
				parent_edges: [{ parent_id: parentRevision.commit_id, edge_type: "direct" as const }],
				children_ids: [],
				description: "",
				author: parentRevision.author,
				timestamp: new Date().toISOString(),
				is_working_copy: true,
				is_immutable: false,
				is_mine: true,
				is_trunk: false,
				is_divergent: false,
				divergent_index: null,
				has_conflict: false,
				bookmarks: [],
			}
		: null;

	const action = createOptimisticAction<void>({
		metadata: { mutationId, kind: "jj-new", repoPath },
		onMutate: () => {
			if (!optimisticRevision) return;
			if (currentWcRevision) {
				optimisticUpdate(collection, currentWcRevision, (draft) => {
					draft.is_working_copy = false;
				});
			}
			optimisticInsert(collection, optimisticRevision);
		},
		mutationFn: async () => {
			const result = await trackMutation(
				mutationId,
				jjNew(repoPath, parentChangeIds, preAllocatedChangeId ?? undefined),
			);
			await refetchRevisions(collection);
			void reconcileOperation(repoPath, result.operation_id);
			const shortId = result.change_id?.slice(0, 8) ?? "unknown";
			toast.success(`Working copy is now ${shortId}`, {
				description: "Created new revision",
			});
			return result;
		},
	});

	const transaction = action();
	if (supportsCollectionTransactions(collection)) {
		transaction.isPersisted.promise.catch((error) => {
			toast.error(`Failed to create revision: ${error}`, { duration: Number.POSITIVE_INFINITY });
		});
		return;
	}

	trackMutation(mutationId, jjNew(repoPath, parentChangeIds, preAllocatedChangeId ?? undefined))
		.then((result) => {
			void reconcileOperation(repoPath, result.operation_id);
			const shortId = result.change_id?.slice(0, 8) ?? "unknown";
			toast.success(`Working copy is now ${shortId}`, {
				description: "Created new revision",
			});
		})
		.catch((error) => {
			if (optimisticRevision) {
				optimisticDelete(collection, optimisticRevision);
				if (currentWcRevision) {
					optimisticUpdate(collection, currentWcRevision, (draft) => {
						draft.is_working_copy = true;
					});
				}
			}
			toast.error(`Failed to create revision: ${error}`, { duration: Number.POSITIVE_INFINITY });
		});
}

export function abandonRevision(
	collection: RevisionsCollection,
	repoPath: string,
	revision: Revision,
) {
	const mutationId = uniqueMutationId("abandon");
	const shouldOptimisticallyDelete = !revision.is_working_copy;

	const action = createOptimisticAction<void>({
		metadata: { mutationId, kind: "jj-abandon", repoPath },
		onMutate: () => {
			if (shouldOptimisticallyDelete) {
				optimisticDelete(collection, revision);
			}
		},
		mutationFn: async () => {
			const result = await trackMutation(mutationId, jjAbandon(repoPath, revision.change_id_short));
			await refetchRevisions(collection);
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Abandoned revision ${revision.change_id_short}`,
			);
			return result;
		},
	});

	const transaction = action();
	if (supportsCollectionTransactions(collection)) {
		transaction.isPersisted.promise.catch((error) => {
			toast.error(`Failed to abandon revision: ${error}`, { duration: Number.POSITIVE_INFINITY });
		});
		return;
	}

	trackMutation(mutationId, jjAbandon(repoPath, revision.change_id_short))
		.then((result) => {
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Abandoned revision ${revision.change_id_short}`,
			);
		})
		.catch((error) => {
			if (shouldOptimisticallyDelete) {
				optimisticInsert(collection, revision);
			}
			toast.error(`Failed to abandon revision: ${error}`, { duration: Number.POSITIVE_INFINITY });
		});
}

export function describeRevision(
	collection: RevisionsCollection,
	repoPath: string,
	revision: Revision,
	description: string,
) {
	const mutationId = uniqueMutationId("describe");

	const action = createOptimisticAction<void>({
		metadata: { mutationId, kind: "jj-describe", repoPath },
		onMutate: () => {
			optimisticUpdate(collection, revision, (draft) => {
				draft.description = description;
			});
		},
		mutationFn: async () => {
			const result = await trackMutation(
				mutationId,
				jjDescribe(repoPath, revision.change_id_short, description),
			);
			await refetchRevisions(collection);
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Updated description for ${revision.change_id_short}`,
			);
			return result;
		},
	});

	const transaction = action();
	if (supportsCollectionTransactions(collection)) {
		transaction.isPersisted.promise.catch((error) => {
			toast.error(`Failed to update description: ${error}`, {
				duration: Number.POSITIVE_INFINITY,
			});
		});
		return;
	}

	trackMutation(mutationId, jjDescribe(repoPath, revision.change_id_short, description))
		.then((result) => {
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Updated description for ${revision.change_id_short}`,
			);
		})
		.catch((error) => {
			optimisticUpdate(collection, revision, (draft) => {
				draft.description = revision.description;
			});
			toast.error(`Failed to update description: ${error}`, {
				duration: Number.POSITIVE_INFINITY,
			});
		});
}

export function squashRevision(
	collection: RevisionsCollection,
	repoPath: string,
	revision: Revision,
) {
	if (revision.is_immutable) {
		toast.error("Cannot squash immutable revision", { duration: Number.POSITIVE_INFINITY });
		return;
	}
	if (revision.parent_edges.length === 0) {
		toast.error("Cannot squash root revision", { duration: Number.POSITIVE_INFINITY });
		return;
	}
	if (revision.parent_edges.length > 1) {
		toast.error("Cannot squash merge revision with multiple parents", {
			duration: Number.POSITIVE_INFINITY,
		});
		return;
	}

	const mutationId = uniqueMutationId("squash");
	const shouldOptimisticallyDelete = !revision.is_working_copy;

	const action = createOptimisticAction<void>({
		metadata: { mutationId, kind: "jj-squash", repoPath },
		onMutate: () => {
			if (shouldOptimisticallyDelete) {
				optimisticDelete(collection, revision);
			}
		},
		mutationFn: async () => {
			const result = await trackMutation(mutationId, jjSquash(repoPath, revision.change_id));
			await invalidateRepositoryQueries(repoPath);
			await refetchRevisions(collection);
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Squashed ${revision.change_id_short} into parent`,
			);
			return result;
		},
	});

	action().isPersisted.promise.catch((error) => {
		toast.error(`Failed to squash revision: ${error}`, {
			duration: Number.POSITIVE_INFINITY,
		});
	});
}

export function rebaseRevision(
	collection: RevisionsCollection,
	repoPath: string,
	sourceRevision: Revision,
	destinationRevision: Revision,
) {
	if (sourceRevision.is_immutable) {
		toast.error("Cannot rebase immutable revision", { duration: Number.POSITIVE_INFINITY });
		return;
	}
	if (sourceRevision.change_id === destinationRevision.change_id) {
		toast.error("Cannot rebase revision onto itself", { duration: Number.POSITIVE_INFINITY });
		return;
	}

	const mutationId = uniqueMutationId("rebase");

	const action = createOptimisticAction<void>({
		metadata: { mutationId, kind: "jj-rebase", repoPath },
		onMutate: () => {
			optimisticUpdate(collection, sourceRevision, (draft) => {
				draft.parent_edges = [
					{ parent_id: destinationRevision.commit_id, edge_type: "direct" as const },
				];
			});
		},
		mutationFn: async () => {
			const result = await trackMutation(
				mutationId,
				jjRebase(repoPath, sourceRevision.change_id, destinationRevision.change_id),
			);
			await invalidateRepositoryQueries(repoPath);
			await refetchRevisions(collection);
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Rebased ${sourceRevision.change_id_short} onto ${destinationRevision.change_id_short}`,
			);
			return result;
		},
	});

	action().isPersisted.promise.catch((error) => {
		toast.error(`Failed to rebase revision: ${error}`, {
			duration: Number.POSITIVE_INFINITY,
		});
	});
}
