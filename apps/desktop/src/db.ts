export { queryClient } from "./data/query-client";
export { ensureChangeIdPool } from "./data/change-id-pool";
export {
	invalidateRepositoryQueries,
	setupRepoWatcher,
	teardownRepoWatcher,
} from "./data/watchers";
export { syncRepository } from "./data/actions/repo-actions";
export {
	addRepository,
	deleteRepository,
	ensureRepositories,
	repositoriesCollection,
	type RepositoriesCollection,
	updateRepository,
} from "./data/collections/repositories";
export {
	abandonRevision,
	describeRevision,
	editRevision,
	emptyRevisionsCollection,
	getRevisionKey,
	getRevisionsCollection,
	newRevision,
	rebaseRevision,
	type RevisionsCollection,
	squashRevision,
} from "./data/collections/revisions";
export {
	emptyChangesCollection,
	getRevisionChangesCollection,
	type RevisionChangesCollection,
} from "./data/collections/revision-changes";
export {
	emptyDiffCollection,
	getRevisionDiffCollection,
	type RevisionDiffCollection,
} from "./data/collections/revision-diffs";
export { prefetchRevisionChanges, prefetchRevisionDiffs } from "./data/prefetch";
export {
	emptyCommitRecencyCollection,
	getCommitRecencyCollection,
	type CommitRecencyCollection,
} from "./data/collections/commit-recency";
export {
	changesCollection,
	type ChangeRecord,
	type ChangesCollection,
} from "./data/collections/changes";
export { diffsCollection, type DiffRecord, type DiffsCollection } from "./data/collections/diffs";
export {
	emptyOperationsCollection,
	getOperationKey,
	getOperationsCollection,
	invalidateOperations,
	reconcileOperation,
	type OperationsCollection,
} from "./data/collections/operations";
