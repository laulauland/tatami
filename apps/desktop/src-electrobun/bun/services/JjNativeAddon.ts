import { Context, Data, Effect, Layer } from "effect";
import { loadNativeAddon, type NativeAddon } from "../native.ts";

export type JjNativeAddonOperation =
	| "load"
	| "getRevisionsJson"
	| "getRevisionChangesJson"
	| "getRevisionDiffJson"
	| "getChangesBatchJson"
	| "getDiffsBatchJson"
	| "generateChangeIds"
	| "jjNew"
	| "jjEdit"
	| "jjAbandon"
	| "jjDescribe"
	| "jjSquash"
	| "jjRebase";

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
		readonly generateChangeIds: (
			repoPath: string,
			count: number,
		) => Effect.Effect<string[], JjNativeAddonError>;
		readonly jjNew: (
			repoPath: string,
			parentChangeIds: string[],
			changeId?: string | null,
		) => Effect.Effect<string, JjNativeAddonError>;
		readonly jjEdit: (repoPath: string, changeId: string) => Effect.Effect<string, JjNativeAddonError>;
		readonly jjAbandon: (repoPath: string, changeId: string) => Effect.Effect<string, JjNativeAddonError>;
		readonly jjDescribe: (
			repoPath: string,
			changeId: string,
			description: string,
		) => Effect.Effect<string, JjNativeAddonError>;
		readonly jjSquash: (repoPath: string, changeId: string) => Effect.Effect<string, JjNativeAddonError>;
		readonly jjRebase: (
			repoPath: string,
			sourceChangeId: string,
			destinationChangeId: string,
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
					generateChangeIds: (repoPath, count) =>
						Effect.try({
							try: () => addon.generateChangeIds(repoPath, count),
							catch: (cause) =>
								new JjNativeAddonError({ operation: "generateChangeIds", cause }),
						}),
					jjNew: (repoPath, parentChangeIds, changeId = null) =>
						Effect.try({
							try: () => addon.jjNew(repoPath, parentChangeIds, changeId),
							catch: (cause) => new JjNativeAddonError({ operation: "jjNew", cause }),
						}),
					jjEdit: (repoPath, changeId) =>
						Effect.try({
							try: () => addon.jjEdit(repoPath, changeId),
							catch: (cause) => new JjNativeAddonError({ operation: "jjEdit", cause }),
						}),
					jjAbandon: (repoPath, changeId) =>
						Effect.try({
							try: () => addon.jjAbandon(repoPath, changeId),
							catch: (cause) => new JjNativeAddonError({ operation: "jjAbandon", cause }),
						}),
					jjDescribe: (repoPath, changeId, description) =>
						Effect.try({
							try: () => addon.jjDescribe(repoPath, changeId, description),
							catch: (cause) => new JjNativeAddonError({ operation: "jjDescribe", cause }),
						}),
					jjSquash: (repoPath, changeId) =>
						Effect.try({
							try: () => addon.jjSquash(repoPath, changeId),
							catch: (cause) => new JjNativeAddonError({ operation: "jjSquash", cause }),
						}),
					jjRebase: (repoPath, sourceChangeId, destinationChangeId) =>
						Effect.try({
							try: () => addon.jjRebase(repoPath, sourceChangeId, destinationChangeId),
							catch: (cause) => new JjNativeAddonError({ operation: "jjRebase", cause }),
						}),
				}),
			),
		),
	);
}
