import { Context, Data, Effect, Layer } from "effect";
import type {
	AppLayout,
	GetRevisionsParams,
	Project,
	RevisionStub,
	UpsertProjectParams,
} from "../../../src-electrobun/shared/rpc.ts";
import { appRpc } from "../rpc.ts";

export class NativeClientError extends Data.TaggedError("NativeClientError")<{
	readonly operation:
		| "getRevisions"
		| "getProjects"
		| "upsertProject"
		| "removeProject"
		| "getLayout"
		| "updateLayout"
		| "openRepositoryDialog";
	readonly cause: unknown;
}> {}

export class NativeClient extends Context.Tag("tatami/NativeClient")<
	NativeClient,
	{
		readonly getRevisions: (
			params: GetRevisionsParams,
		) => Effect.Effect<RevisionStub[], NativeClientError>;
		readonly getProjects: () => Effect.Effect<Project[], NativeClientError>;
		readonly upsertProject: (
			params: UpsertProjectParams,
		) => Effect.Effect<Project, NativeClientError>;
		readonly removeProject: (id: string) => Effect.Effect<void, NativeClientError>;
		readonly getLayout: () => Effect.Effect<AppLayout, NativeClientError>;
		readonly updateLayout: (layout: Partial<AppLayout>) => Effect.Effect<void, NativeClientError>;
		readonly openRepositoryDialog: () => Effect.Effect<string | null, NativeClientError>;
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
		}),
	);
}
