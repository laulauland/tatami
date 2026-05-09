import { Context, Data, Effect, Layer, Schema } from "effect";
import type { GetRevisionsParams, RevisionStub } from "../../shared/rpc.ts";
import { Revisions, type Revision } from "../../shared/schemas.ts";
import { JjNativeAddon, type JjNativeAddonError } from "./JjNativeAddon.ts";

export class RepoError extends Data.TaggedError("RepoError")<{
	readonly operation: "getRevisions";
	readonly reason: "native" | "parse" | "validation";
	readonly cause: unknown;
}> {}

const DEFAULT_REVISION_LIMIT = 50;

const parseJson = (input: string) =>
	Effect.try({
		try: () => JSON.parse(input) as unknown,
		catch: (cause) => new RepoError({ operation: "getRevisions", reason: "parse", cause }),
	});

const decodeRevisions = (input: unknown) =>
	Schema.decodeUnknown(Revisions)(input).pipe(
		Effect.mapError(
			(cause) => new RepoError({ operation: "getRevisions", reason: "validation", cause }),
		),
	);

export class RepoService extends Context.Tag("tatami/RepoService")<
	RepoService,
	{
		readonly getRevisions: (
			params: GetRevisionsParams,
		) => Effect.Effect<RevisionStub[], RepoError>;
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
						Effect.mapError(
							(cause: JjNativeAddonError) =>
								new RepoError({ operation: "getRevisions", reason: "native", cause }),
						),
						Effect.flatMap(parseJson),
						Effect.flatMap(decodeRevisions),
						Effect.map((revisions) => [...revisions] as RevisionStub[]),
					);
				},
			});
		}),
	);
}
