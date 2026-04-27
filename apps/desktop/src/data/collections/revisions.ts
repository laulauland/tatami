import { createCollection } from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { Effect } from "effect";
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

function mutationSuccessWithUndo(
	repoPath: string,
	operationId: string,
	title: string,
	description?: string,
) {
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

export function editRevision(
	collection: RevisionsCollection,
	repoPath: string,
	targetRevision: Revision,
	currentWcRevision: Revision | null,
) {
	const mutationId = `edit-${Date.now()}-${Math.random()}`;

	// Optimistic update
	const updates: Revision[] = [];
	if (currentWcRevision && getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)) {
		updates.push({ ...currentWcRevision, is_working_copy: false });
	}
	updates.push({ ...targetRevision, is_working_copy: true });
	collection.utils.writeUpsert(updates);

	// Track the mutation and fire backend
	trackMutation(mutationId, jjEdit(repoPath, targetRevision.change_id_short))
		.then((_result) => {
			// Invalidate to get fresh data from backend
			queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
			toast.success(`Working copy is now ${targetRevision.change_id_short}`);
		})
		.catch((error) => {
			// Revert optimistic update
			const revertUpdates: Revision[] = [];
			if (
				currentWcRevision &&
				getRevisionKey(currentWcRevision) !== getRevisionKey(targetRevision)
			) {
				revertUpdates.push({ ...currentWcRevision, is_working_copy: true });
			}
			revertUpdates.push({ ...targetRevision, is_working_copy: false });
			collection.utils.writeUpsert(revertUpdates);
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
	const mutationId = `new-${Date.now()}-${Math.random()}`;
	const preAllocatedChangeId = consumeChangeId(repoPath);

	// Create optimistic revision if we have a pre-allocated change ID
	let optimisticRevision: Revision | null = null;
	if (preAllocatedChangeId) {
		optimisticRevision = {
			commit_id: `pending-${preAllocatedChangeId}`, // Temporary, will be replaced
			change_id: preAllocatedChangeId,
			change_id_short: preAllocatedChangeId.slice(0, 8), // Approximate short ID
			parent_edges: [{ parent_id: parentRevision.commit_id, edge_type: "direct" as const }],
			children_ids: [],
			description: "",
			author: parentRevision.author, // Inherit from parent
			timestamp: new Date().toISOString(),
			is_working_copy: true,
			is_immutable: false,
			is_mine: true,
			is_trunk: false,
			is_divergent: false,
			divergent_index: null,
			has_conflict: false,
			bookmarks: [],
		};

		// Optimistic update: clear WC from current, insert new revision
		const updates: Revision[] = [];
		if (currentWcRevision) {
			updates.push({ ...currentWcRevision, is_working_copy: false });
		}
		updates.push(optimisticRevision);
		collection.utils.writeUpsert(updates);
	}

	// Fire backend call
	const program = Effect.tryPromise({
		try: () => jjNew(repoPath, parentChangeIds, preAllocatedChangeId ?? undefined),
		catch: (error) => new Error(`Failed to create new revision: ${error}`),
	}).pipe(Effect.tapError((error) => Effect.logError("jjNew failed", error)));

	trackMutation(mutationId, Effect.runPromise(program))
		.then((result) => {
			// Invalidate to get authoritative data (correct commit_id, short_id, etc.)
			queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
			const shortId = result.change_id?.slice(0, 8) ?? "unknown";
			toast.success(`Working copy is now ${shortId}`, {
				description: "Created new revision",
			});
		})
		.catch((error) => {
			// Revert optimistic update
			if (optimisticRevision) {
				collection.utils.writeDelete(getRevisionKey(optimisticRevision));
				if (currentWcRevision) {
					collection.utils.writeUpsert([{ ...currentWcRevision, is_working_copy: true }]);
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
	const mutationId = `abandon-${Date.now()}-${Math.random()}`;

	// For working copy, jj creates a new WC - can't do optimistic delete
	// For other revisions, we can optimistically remove
	if (!revision.is_working_copy) {
		collection.utils.writeDelete(getRevisionKey(revision));
	}

	// Track the mutation and fire backend
	trackMutation(mutationId, jjAbandon(repoPath, revision.change_id_short))
		.then((result) => {
			// Invalidate to get fresh data (especially for WC abandon which creates new WC)
			queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
			toast.success(`Abandoned revision ${revision.change_id_short}`, {
				action: {
					label: "Undo",
					onClick: () => {
						undoOperation(repoPath, result.operation_id)
							.then(() => {
								queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
								toast.success("Undo successful");
							})
							.catch((err) => {
								toast.error(`Undo failed: ${err}`, { duration: Number.POSITIVE_INFINITY });
							});
					},
				},
			});
		})
		.catch((error) => {
			// Re-add on failure (only if we deleted it)
			if (!revision.is_working_copy) {
				collection.utils.writeUpsert([revision]);
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
	const mutationId = `describe-${Date.now()}-${Math.random()}`;
	const previousDescription = revision.description;

	// Optimistic update
	collection.utils.writeUpsert([{ ...revision, description }]);

	trackMutation(mutationId, jjDescribe(repoPath, revision.change_id_short, description))
		.then((result) => {
			queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
			toast.success(`Updated description for ${revision.change_id_short}`, {
				action: {
					label: "Undo",
					onClick: () => {
						undoOperation(repoPath, result.operation_id)
							.then(() => {
								queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
								toast.success("Undo successful");
							})
							.catch((err) => {
								toast.error(`Undo failed: ${err}`, { duration: Number.POSITIVE_INFINITY });
							});
					},
				},
			});
		})
		.catch((error) => {
			// Revert optimistic update on failure
			collection.utils.writeUpsert([{ ...revision, description: previousDescription }]);
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

	const mutationId = `squash-${Date.now()}-${Math.random()}`;
	const shouldOptimisticallyDelete = !revision.is_working_copy;

	if (shouldOptimisticallyDelete) {
		collection.utils.writeDelete(getRevisionKey(revision));
	}

	trackMutation(mutationId, jjSquash(repoPath, revision.change_id))
		.then((result) => {
			void invalidateRepositoryQueries(repoPath);
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Squashed ${revision.change_id_short} into parent`,
			);
		})
		.catch((error) => {
			if (shouldOptimisticallyDelete) {
				collection.utils.writeUpsert([revision]);
			}
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

	const mutationId = `rebase-${Date.now()}-${Math.random()}`;
	const previousParentEdges = sourceRevision.parent_edges;

	collection.utils.writeUpsert([
		{
			...sourceRevision,
			parent_edges: [{ parent_id: destinationRevision.commit_id, edge_type: "direct" as const }],
		},
	]);

	trackMutation(
		mutationId,
		jjRebase(repoPath, sourceRevision.change_id, destinationRevision.change_id),
	)
		.then((result) => {
			void invalidateRepositoryQueries(repoPath);
			mutationSuccessWithUndo(
				repoPath,
				result.operation_id,
				`Rebased ${sourceRevision.change_id_short} onto ${destinationRevision.change_id_short}`,
			);
		})
		.catch((error) => {
			collection.utils.writeUpsert([
				{
					...sourceRevision,
					parent_edges: previousParentEdges,
				},
			]);
			toast.error(`Failed to rebase revision: ${error}`, {
				duration: Number.POSITIVE_INFINITY,
			});
		});
}
