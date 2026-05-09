import { Context, Data, Effect, Layer } from "effect";
import { loadNativeAddon, type NativeAddon } from "../native.ts";

export type JjNativeAddonOperation =
	| "load"
	| "getRevisionsJson"
	| "getRevisionChangesJson"
	| "getRevisionDiffJson"
	| "getChangesBatchJson"
	| "getDiffsBatchJson";

export class JjNativeAddonError extends Data.TaggedError("JjNativeAddonError")<{
	readonly operation: JjNativeAddonOperation;
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
		readonly getRevisionChangesJson: (
			repoPath: string,
			changeId: string,
		) => Effect.Effect<string, JjNativeAddonError>;
		readonly getRevisionDiffJson: (
			repoPath: string,
			changeId: string,
		) => Effect.Effect<string, JjNativeAddonError>;
		readonly getChangesBatchJson: (
			repoPath: string,
			changeIds: string[],
		) => Effect.Effect<string, JjNativeAddonError>;
		readonly getDiffsBatchJson: (
			repoPath: string,
			changeIds: string[],
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
					getRevisionChangesJson: (repoPath, changeId) =>
						Effect.try({
							try: () => addon.getRevisionChangesJson(repoPath, changeId),
							catch: (cause) =>
								new JjNativeAddonError({ operation: "getRevisionChangesJson", cause }),
						}),
					getRevisionDiffJson: (repoPath, changeId) =>
						Effect.try({
							try: () => addon.getRevisionDiffJson(repoPath, changeId),
							catch: (cause) =>
								new JjNativeAddonError({ operation: "getRevisionDiffJson", cause }),
						}),
					getChangesBatchJson: (repoPath, changeIds) =>
						Effect.try({
							try: () => addon.getChangesBatchJson(repoPath, changeIds),
							catch: (cause) =>
								new JjNativeAddonError({ operation: "getChangesBatchJson", cause }),
						}),
					getDiffsBatchJson: (repoPath, changeIds) =>
						Effect.try({
							try: () => addon.getDiffsBatchJson(repoPath, changeIds),
							catch: (cause) =>
								new JjNativeAddonError({ operation: "getDiffsBatchJson", cause }),
						}),
				}),
			),
		),
	);
}
