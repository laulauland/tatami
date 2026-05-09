import { Context, Data, Effect, Layer } from "effect";
import type {
	AppLayout,
	ChangedFile,
	GetRevisionsParams,
	JjDescribeParams,
	JjNewParams,
	JjRebaseParams,
	MessageBoxOptions,
	MessageBoxResponse,
	MutationResult,
	Operation,
	Project,
	RevisionChanges,
	RevisionDiff,
	RevisionStub,
	UpsertProjectParams,
} from "../../../src-electrobun/shared/rpc.ts";
import { appRpc } from "../rpc.ts";

export class NativeClientError extends Data.TaggedError("NativeClientError")<{
	readonly operation:
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
		| "gitPush"
		| "getProjects"
		| "upsertProject"
		| "removeProject"
		| "getLayout"
		| "updateLayout"
		| "openRepositoryDialog"
		| "watchRepository"
		| "unwatchRepository"
		| "openExternal"
		| "openPath"
		| "showItemInFolder"
		| "showMessageBox";
	readonly cause: unknown;
}> {}

export class NativeClient extends Context.Tag("tatami/NativeClient")<
	NativeClient,
	{
		readonly getRevisions: (
			params: GetRevisionsParams,
		) => Effect.Effect<RevisionStub[], NativeClientError>;
		readonly getRevisionChanges: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<ChangedFile[], NativeClientError>;
		readonly getRevisionDiff: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<string, NativeClientError>;
		readonly getChangesBatch: (params: {
			repoPath: string;
			changeIds: string[];
		}) => Effect.Effect<RevisionChanges[], NativeClientError>;
		readonly getDiffsBatch: (params: {
			repoPath: string;
			changeIds: string[];
		}) => Effect.Effect<RevisionDiff[], NativeClientError>;
		readonly generateChangeIds: (params: {
			repoPath: string;
			count: number;
		}) => Effect.Effect<string[], NativeClientError>;
		readonly jjNew: (params: JjNewParams) => Effect.Effect<MutationResult, NativeClientError>;
		readonly jjEdit: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<MutationResult, NativeClientError>;
		readonly jjAbandon: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<MutationResult, NativeClientError>;
		readonly jjDescribe: (
			params: JjDescribeParams,
		) => Effect.Effect<MutationResult, NativeClientError>;
		readonly jjSquash: (params: {
			repoPath: string;
			changeId: string;
		}) => Effect.Effect<MutationResult, NativeClientError>;
		readonly jjRebase: (params: JjRebaseParams) => Effect.Effect<MutationResult, NativeClientError>;
		readonly getOperations: (params: {
			repoPath: string;
			limit: number;
		}) => Effect.Effect<Operation[], NativeClientError>;
		readonly undoOperation: (params: {
			repoPath: string;
			operationId: string;
		}) => Effect.Effect<MutationResult, NativeClientError>;
		readonly gitFetch: (params: {
			repoPath: string;
			remote?: string | null;
		}) => Effect.Effect<MutationResult, NativeClientError>;
		readonly gitPush: (params: {
			repoPath: string;
			bookmarkNames: string[];
			remote?: string | null;
		}) => Effect.Effect<MutationResult, NativeClientError>;
		readonly getProjects: () => Effect.Effect<Project[], NativeClientError>;
		readonly upsertProject: (
			params: UpsertProjectParams,
		) => Effect.Effect<Project, NativeClientError>;
		readonly removeProject: (id: string) => Effect.Effect<void, NativeClientError>;
		readonly getLayout: () => Effect.Effect<AppLayout, NativeClientError>;
		readonly updateLayout: (layout: Partial<AppLayout>) => Effect.Effect<void, NativeClientError>;
		readonly openRepositoryDialog: () => Effect.Effect<string | null, NativeClientError>;
		readonly watchRepository: (repoPath: string) => Effect.Effect<void, NativeClientError>;
		readonly unwatchRepository: (repoPath: string) => Effect.Effect<void, NativeClientError>;
		readonly openExternal: (url: string) => Effect.Effect<boolean, NativeClientError>;
		readonly openPath: (path: string) => Effect.Effect<boolean, NativeClientError>;
		readonly showItemInFolder: (path: string) => Effect.Effect<void, NativeClientError>;
		readonly showMessageBox: (
			options: MessageBoxOptions,
		) => Effect.Effect<MessageBoxResponse, NativeClientError>;
	}
>() {
	static readonly Live = Layer.succeed(
		NativeClient,
		NativeClient.of({
			getRevisions: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.getRevisions(params),
					catch: (cause) => new NativeClientError({ operation: "getRevisions", cause }),
				}),
			getRevisionChanges: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.getRevisionChanges(params),
					catch: (cause) => new NativeClientError({ operation: "getRevisionChanges", cause }),
				}),
			getRevisionDiff: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.getRevisionDiff(params),
					catch: (cause) => new NativeClientError({ operation: "getRevisionDiff", cause }),
				}),
			getChangesBatch: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.getChangesBatch(params),
					catch: (cause) => new NativeClientError({ operation: "getChangesBatch", cause }),
				}),
			getDiffsBatch: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.getDiffsBatch(params),
					catch: (cause) => new NativeClientError({ operation: "getDiffsBatch", cause }),
				}),
			generateChangeIds: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.generateChangeIds(params),
					catch: (cause) => new NativeClientError({ operation: "generateChangeIds", cause }),
				}),
			jjNew: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.jjNew(params),
					catch: (cause) => new NativeClientError({ operation: "jjNew", cause }),
				}),
			jjEdit: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.jjEdit(params),
					catch: (cause) => new NativeClientError({ operation: "jjEdit", cause }),
				}),
			jjAbandon: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.jjAbandon(params),
					catch: (cause) => new NativeClientError({ operation: "jjAbandon", cause }),
				}),
			jjDescribe: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.jjDescribe(params),
					catch: (cause) => new NativeClientError({ operation: "jjDescribe", cause }),
				}),
			jjSquash: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.jjSquash(params),
					catch: (cause) => new NativeClientError({ operation: "jjSquash", cause }),
				}),
			jjRebase: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.jjRebase(params),
					catch: (cause) => new NativeClientError({ operation: "jjRebase", cause }),
				}),
			getOperations: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.getOperations(params),
					catch: (cause) => new NativeClientError({ operation: "getOperations", cause }),
				}),
			undoOperation: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.undoOperation(params),
					catch: (cause) => new NativeClientError({ operation: "undoOperation", cause }),
				}),
			gitFetch: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.gitFetch(params),
					catch: (cause) => new NativeClientError({ operation: "gitFetch", cause }),
				}),
			gitPush: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.gitPush(params),
					catch: (cause) => new NativeClientError({ operation: "gitPush", cause }),
				}),
			getProjects: () =>
				Effect.tryPromise({
					try: () => appRpc.request.getProjects({}),
					catch: (cause) => new NativeClientError({ operation: "getProjects", cause }),
				}),
			upsertProject: (params) =>
				Effect.tryPromise({
					try: () => appRpc.request.upsertProject(params),
					catch: (cause) => new NativeClientError({ operation: "upsertProject", cause }),
				}),
			removeProject: (id) =>
				Effect.tryPromise({
					try: () => appRpc.request.removeProject({ id }),
					catch: (cause) => new NativeClientError({ operation: "removeProject", cause }),
				}),
			getLayout: () =>
				Effect.tryPromise({
					try: () => appRpc.request.getLayout({}),
					catch: (cause) => new NativeClientError({ operation: "getLayout", cause }),
				}),
			updateLayout: (layout) =>
				Effect.tryPromise({
					try: () => appRpc.request.updateLayout(layout),
					catch: (cause) => new NativeClientError({ operation: "updateLayout", cause }),
				}),
			openRepositoryDialog: () =>
				Effect.tryPromise({
					try: () => appRpc.request.openRepositoryDialog({}),
					catch: (cause) => new NativeClientError({ operation: "openRepositoryDialog", cause }),
				}),
			watchRepository: (repoPath) =>
				Effect.tryPromise({
					try: () => appRpc.request.watchRepository({ repoPath }),
					catch: (cause) => new NativeClientError({ operation: "watchRepository", cause }),
				}),
			unwatchRepository: (repoPath) =>
				Effect.tryPromise({
					try: () => appRpc.request.unwatchRepository({ repoPath }),
					catch: (cause) => new NativeClientError({ operation: "unwatchRepository", cause }),
				}),
			openExternal: (url) =>
				Effect.tryPromise({
					try: () => appRpc.request.openExternal({ url }),
					catch: (cause) => new NativeClientError({ operation: "openExternal", cause }),
				}),
			openPath: (path) =>
				Effect.tryPromise({
					try: () => appRpc.request.openPath({ path }),
					catch: (cause) => new NativeClientError({ operation: "openPath", cause }),
				}),
			showItemInFolder: (path) =>
				Effect.tryPromise({
					try: () => appRpc.request.showItemInFolder({ path }),
					catch: (cause) => new NativeClientError({ operation: "showItemInFolder", cause }),
				}),
			showMessageBox: (options) =>
				Effect.tryPromise({
					try: () => appRpc.request.showMessageBox(options),
					catch: (cause) => new NativeClientError({ operation: "showMessageBox", cause }),
				}),
		}),
	);
}
