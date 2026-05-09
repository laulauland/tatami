import { Context, Data, Effect, Layer, Schema } from "effect";
import type {
	ChangedFile,
	GetRevisionsParams,
	JjDescribeParams,
	JjNewParams,
	JjRebaseParams,
	MutationResult,
	Operation,
	RevisionChanges,
	RevisionDiff,
	RevisionStub,
} from "../../shared/rpc.ts";
import {
	ChangeIds,
	ChangedFiles,
	MutationResult as MutationResultSchema,
	Operations,
	RevisionChangesBatch,
	RevisionDiffs,
	Revisions,
} from "../../shared/schemas.ts";
import { JjNativeAddon, type JjNativeAddonError } from "./JjNativeAddon.ts";

export type RepoOperation =
	| "getRevisions"
	| "getRevisionChanges"
	| "getRevisionDiff"
	| "getChangesBatch"
	| "getDiffsBatch"
	| "generateChangeIds"
	| "jjNew"
	| "jjEdit"
	| "jjAbandon"
	| "jjDescribe"
	| "jjSquash"
	| "jjRebase"
	| "getOperations"
	| "undoOperation"
	| "gitFetch"
	| "gitPush";

export class RepoError extends Data.TaggedError("RepoError")<{
	readonly operation: RepoOperation;
	readonly reason: "native" | "parse" | "validation";
	readonly cause: unknown;
}> {}

const DEFAULT_REVISION_LIMIT = 50;

const parseJson = (operation: RepoOperation, input: string) =>
	Effect.try({
		try: () => JSON.parse(input) as unknown,
		catch: (cause) => new RepoError({ operation, reason: "parse", cause }),
	});

const decodeWith = <A, I, R>(operation: RepoOperation, schema: Schema.Schema<A, I, R>, input: unknown) =>
	Schema.decodeUnknown(schema)(input).pipe(
		Effect.mapError(
			(cause) => new RepoError({ operation, reason: "validation", cause }),
		),
	);

const nativeError = (operation: RepoOperation, cause: JjNativeAddonError) =>
	new RepoError({ operation, reason: "native", cause });

const decodeMutationResult = (operation: RepoOperation, json: string) =>
	parseJson(operation, json).pipe(
		Effect.flatMap((input) => decodeWith(operation, MutationResultSchema, input)),
		Effect.map((result) => ({ ...result }) as MutationResult),
	);

export class RepoService extends Context.Tag("tatami/RepoService")<
	RepoService,
	{
		readonly getRevisions: (
			params: GetRevisionsParams,
		) => Effect.Effect<RevisionStub[], RepoError>;
		readonly getRevisionChanges: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<ChangedFile[], RepoError>;
		readonly getRevisionDiff: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<string, RepoError>;
		readonly getChangesBatch: (params: {
			repoPath: string;
			changeIds: string[];
		}) => Effect.Effect<RevisionChanges[], RepoError>;
		readonly getDiffsBatch: (params: {
			repoPath: string;
			changeIds: string[];
		}) => Effect.Effect<RevisionDiff[], RepoError>;
		readonly generateChangeIds: (params: {
			repoPath: string;
			count: number;
		}) => Effect.Effect<string[], RepoError>;
		readonly jjNew: (params: JjNewParams) => Effect.Effect<MutationResult, RepoError>;
		readonly jjEdit: (params: { repoPath: string; changeId: string }) => Effect.Effect<MutationResult, RepoError>;
		readonly jjAbandon: (params: { repoPath: string; changeId: string }) => Effect.Effect<MutationResult, RepoError>;
		readonly jjDescribe: (params: JjDescribeParams) => Effect.Effect<MutationResult, RepoError>;
		readonly jjSquash: (params: { repoPath: string; changeId: string }) => Effect.Effect<MutationResult, RepoError>;
		readonly jjRebase: (params: JjRebaseParams) => Effect.Effect<MutationResult, RepoError>;
		readonly getOperations: (params: { repoPath: string; limit: number }) => Effect.Effect<Operation[], RepoError>;
		readonly undoOperation: (params: { repoPath: string; operationId: string }) => Effect.Effect<MutationResult, RepoError>;
		readonly gitFetch: (params: { repoPath: string; remote?: string | null }) => Effect.Effect<MutationResult, RepoError>;
		readonly gitPush: (params: { repoPath: string; bookmarkNames: string[]; remote?: string | null }) => Effect.Effect<MutationResult, RepoError>;
	}
>() {
	static readonly Live = Layer.effect(
		RepoService,
		Effect.gen(function* () {
			const addon = yield* JjNativeAddon;

			return RepoService.of({
				getRevisions: ({ repoPath, limit = DEFAULT_REVISION_LIMIT }) => {
					if (repoPath === undefined) {
						return Effect.fail(
							new RepoError({
								operation: "getRevisions",
								reason: "validation",
								cause: "repoPath is required at the backend service boundary",
							}),
						);
					}

					return addon.getRevisionsJson(repoPath, limit, null, null).pipe(
						Effect.mapError((cause) => nativeError("getRevisions", cause)),
						Effect.flatMap((json) => parseJson("getRevisions", json)),
						Effect.flatMap((input) => decodeWith("getRevisions", Revisions, input)),
						Effect.map((revisions) => [...revisions] as RevisionStub[]),
					);
				},
				getRevisionChanges: ({ repoPath, changeId }) =>
					addon.getRevisionChangesJson(repoPath, changeId).pipe(
						Effect.mapError((cause) => nativeError("getRevisionChanges", cause)),
						Effect.flatMap((json) => parseJson("getRevisionChanges", json)),
						Effect.flatMap((input) => decodeWith("getRevisionChanges", ChangedFiles, input)),
						Effect.map((files) => [...files] as ChangedFile[]),
					),
				getRevisionDiff: ({ repoPath, changeId }) =>
					addon.getRevisionDiffJson(repoPath, changeId).pipe(
						Effect.mapError((cause) => nativeError("getRevisionDiff", cause)),
					),
				getChangesBatch: ({ repoPath, changeIds }) =>
					addon.getChangesBatchJson(repoPath, changeIds).pipe(
						Effect.mapError((cause) => nativeError("getChangesBatch", cause)),
						Effect.flatMap((json) => parseJson("getChangesBatch", json)),
						Effect.flatMap((input) => decodeWith("getChangesBatch", RevisionChangesBatch, input)),
						Effect.map((changes) => changes.map((change) => ({ ...change, files: [...change.files] })) as RevisionChanges[]),
					),
				getDiffsBatch: ({ repoPath, changeIds }) =>
					addon.getDiffsBatchJson(repoPath, changeIds).pipe(
						Effect.mapError((cause) => nativeError("getDiffsBatch", cause)),
						Effect.flatMap((json) => parseJson("getDiffsBatch", json)),
						Effect.flatMap((input) => decodeWith("getDiffsBatch", RevisionDiffs, input)),
						Effect.map((diffs) => [...diffs] as RevisionDiff[]),
					),
				generateChangeIds: ({ repoPath, count }) =>
					addon.generateChangeIds(repoPath, count).pipe(
						Effect.mapError((cause) => nativeError("generateChangeIds", cause)),
						Effect.flatMap((input) => decodeWith("generateChangeIds", ChangeIds, input)),
						Effect.map((changeIds) => [...changeIds]),
					),
				jjNew: ({ repoPath, parentChangeIds, changeId = null }) =>
					addon.jjNew(repoPath, parentChangeIds, changeId).pipe(
						Effect.mapError((cause) => nativeError("jjNew", cause)),
						Effect.flatMap((json) => decodeMutationResult("jjNew", json)),
					),
				jjEdit: ({ repoPath, changeId }) =>
					addon.jjEdit(repoPath, changeId).pipe(
						Effect.mapError((cause) => nativeError("jjEdit", cause)),
						Effect.flatMap((json) => decodeMutationResult("jjEdit", json)),
					),
				jjAbandon: ({ repoPath, changeId }) =>
					addon.jjAbandon(repoPath, changeId).pipe(
						Effect.mapError((cause) => nativeError("jjAbandon", cause)),
						Effect.flatMap((json) => decodeMutationResult("jjAbandon", json)),
					),
				jjDescribe: ({ repoPath, changeId, description }) =>
					addon.jjDescribe(repoPath, changeId, description).pipe(
						Effect.mapError((cause) => nativeError("jjDescribe", cause)),
						Effect.flatMap((json) => decodeMutationResult("jjDescribe", json)),
					),
				jjSquash: ({ repoPath, changeId }) =>
					addon.jjSquash(repoPath, changeId).pipe(
						Effect.mapError((cause) => nativeError("jjSquash", cause)),
						Effect.flatMap((json) => decodeMutationResult("jjSquash", json)),
					),
				jjRebase: ({ repoPath, sourceChangeId, destinationChangeId }) =>
					addon.jjRebase(repoPath, sourceChangeId, destinationChangeId).pipe(
						Effect.mapError((cause) => nativeError("jjRebase", cause)),
						Effect.flatMap((json) => decodeMutationResult("jjRebase", json)),
					),
				getOperations: ({ repoPath, limit }) =>
					addon.getOperationsJson(repoPath, limit).pipe(
						Effect.mapError((cause) => nativeError("getOperations", cause)),
						Effect.flatMap((json) => parseJson("getOperations", json)),
						Effect.flatMap((input) => decodeWith("getOperations", Operations, input)),
						Effect.map((operations) => [...operations] as Operation[]),
					),
				undoOperation: ({ repoPath, operationId }) =>
					addon.undoOperation(repoPath, operationId).pipe(
						Effect.mapError((cause) => nativeError("undoOperation", cause)),
						Effect.flatMap((json) => decodeMutationResult("undoOperation", json)),
					),
				gitFetch: ({ repoPath, remote = null }) =>
					addon.jjGitFetch(repoPath, remote).pipe(
						Effect.mapError((cause) => nativeError("gitFetch", cause)),
						Effect.flatMap((json) => decodeMutationResult("gitFetch", json)),
					),
				gitPush: ({ repoPath, remote = null, bookmarkNames }) =>
					addon.jjGitPush(repoPath, remote, bookmarkNames).pipe(
						Effect.mapError((cause) => nativeError("gitPush", cause)),
						Effect.flatMap((json) => decodeMutationResult("gitPush", json)),
					),
			});
		}),
	);
}
