import { Context, Data, Effect, Layer } from "effect";
import type { GetRevisionsParams, RevisionStub } from "../../../src-electrobun/shared/rpc.ts";
import { appRpc } from "../rpc.ts";

export class NativeClientError extends Data.TaggedError("NativeClientError")<{
	readonly operation: "getRevisions";
	readonly cause: unknown;
}> {}

export class NativeClient extends Context.Tag("tatami/NativeClient")<
	NativeClient,
	{
		readonly getRevisions: (
			params: GetRevisionsParams,
		) => Effect.Effect<RevisionStub[], NativeClientError>;
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
		}),
	);
}
