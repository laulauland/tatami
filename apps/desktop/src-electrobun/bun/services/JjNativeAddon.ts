import { Context, Data, Effect, Layer } from "effect";
import { loadNativeAddon, type NativeAddon } from "../native.ts";

export class JjNativeAddonError extends Data.TaggedError("JjNativeAddonError")<{
	readonly operation: "load" | "getRevisionsJson";
	readonly cause: unknown;
}> {}

export class JjNativeAddon extends Context.Tag("tatami/JjNativeAddon")<
	JjNativeAddon,
	{
		readonly getRevisionsJson: (
			repoPath: string,
			limit: number,
			revset?: string | null,
			preset?: string | null,
		) => Effect.Effect<string, JjNativeAddonError>;
	}
>() {
	static readonly Live = Layer.effect(
		JjNativeAddon,
		Effect.try({
			try: (): NativeAddon => loadNativeAddon(),
			catch: (cause) => new JjNativeAddonError({ operation: "load", cause }),
		}).pipe(
			Effect.map((addon) =>
				JjNativeAddon.of({
					getRevisionsJson: (repoPath, limit, revset = null, preset = null) =>
						Effect.try({
							try: () => addon.getRevisionsJson(repoPath, limit, revset, preset),
							catch: (cause) =>
								new JjNativeAddonError({ operation: "getRevisionsJson", cause }),
						}),
				}),
			),
		),
	);
}
