import { Data, Effect } from "effect";
import type {
	JjDescribeParams,
	JjNewParams,
	JjRebaseParams,
	MutationResult,
} from "../../../src-electrobun/shared/rpc.ts";
import { FrontendRuntime } from "../runtime.ts";
import { NativeClient } from "../services/NativeClient.ts";
import { populateRevisions } from "./revisions.ts";

export type RevisionMutationOperation =
	| "generateChangeIds"
	| "jjNew"
	| "jjEdit"
	| "jjAbandon"
	| "jjDescribe"
	| "jjSquash"
	| "jjRebase";

export class MutationError extends Data.TaggedError("MutationError")<{
	readonly operation: RevisionMutationOperation;
	readonly cause: unknown;
}> {}

async function refreshRevisions(repoPath: string): Promise<void> {
	const loadedRevisions = await FrontendRuntime.runPromise(
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.getRevisions({ repoPath, limit: 50 });
		}),
	);
	await populateRevisions(loadedRevisions);
}

async function runMutation(
	operation: RevisionMutationOperation,
	repoPath: string,
	effect: Effect.Effect<MutationResult | string[], unknown, NativeClient>,
): Promise<MutationResult | string[]> {
	try {
		const result = await FrontendRuntime.runPromise(effect);
		// FIXME: optimistic updates deferred; mutations currently refresh TanStack DB after success.
		if (operation !== "generateChangeIds") {
			await refreshRevisions(repoPath);
		}
		return result;
	} catch (cause) {
		throw new MutationError({ operation, cause });
	}
}

export async function generateChangeIds(repoPath: string, count: number): Promise<string[]> {
	return (await runMutation(
		"generateChangeIds",
		repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.generateChangeIds({ repoPath, count });
		}),
	)) as string[];
}

export async function jjNew(params: JjNewParams): Promise<MutationResult> {
	return (await runMutation(
		"jjNew",
		params.repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.jjNew(params);
		}),
	)) as MutationResult;
}

export async function jjEdit(repoPath: string, changeId: string): Promise<MutationResult> {
	return (await runMutation(
		"jjEdit",
		repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.jjEdit({ repoPath, changeId });
		}),
	)) as MutationResult;
}

export async function jjAbandon(repoPath: string, changeId: string): Promise<MutationResult> {
	return (await runMutation(
		"jjAbandon",
		repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.jjAbandon({ repoPath, changeId });
		}),
	)) as MutationResult;
}

export async function jjDescribe(params: JjDescribeParams): Promise<MutationResult> {
	return (await runMutation(
		"jjDescribe",
		params.repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.jjDescribe(params);
		}),
	)) as MutationResult;
}

export async function jjSquash(repoPath: string, changeId: string): Promise<MutationResult> {
	return (await runMutation(
		"jjSquash",
		repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.jjSquash({ repoPath, changeId });
		}),
	)) as MutationResult;
}

export async function jjRebase(params: JjRebaseParams): Promise<MutationResult> {
	return (await runMutation(
		"jjRebase",
		params.repoPath,
		Effect.gen(function* () {
			const nativeClient = yield* NativeClient;
			return yield* nativeClient.jjRebase(params);
		}),
	)) as MutationResult;
}
