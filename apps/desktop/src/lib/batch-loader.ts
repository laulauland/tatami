/**
 * BatchLoader - Queues IDs and flushes them in batched IPC calls with debouncing.
 *
 * Uses Effect for fetch operations, with a single Promise bridge at the React boundary.
 */

import { Effect, pipe } from "effect";
import { traceEnd, traceLog, traceStart } from "@/lib/trace";

export interface BatchLoaderConfig<T> {
	/** Debounce delay in milliseconds before flushing queued IDs */
	debounceMs: number;
	/** Maximum number of IDs to include in a single batch fetch */
	maxBatchSize: number;
	/** Fetch function that retrieves data for a batch of IDs (Effect-based) */
	fetchBatch: (ids: string[]) => Effect.Effect<T[], Error>;
	/** Callback to sync fetched items to storage (e.g., TanStack DB collection) */
	syncToCollection: (items: T[]) => void;
	/** Check if an ID is already loaded (to avoid redundant fetches) */
	isLoaded: (id: string) => boolean;
}

export interface BatchLoader {
	/** Queue a single ID for loading */
	queue(id: string): void;
	/** Queue multiple IDs for loading */
	queueMany(ids: string[]): void;
	/** Force immediate flush of all pending IDs (Effect-based) */
	flush(): Effect.Effect<void, Error>;
	/** Force immediate flush, returning Promise for React interop */
	flushPromise(): Promise<void>;
	/** Check if an ID is already loaded */
	has(id: string): boolean;
	/** Get the count of pending IDs waiting to be loaded */
	pendingCount(): number;
}

/**
 * Creates a BatchLoader instance with the given configuration.
 *
 * The loader queues IDs and automatically flushes them after the debounce
 * period expires. It handles chunking for large batches and protects
 * against concurrent flush operations.
 */
export function createBatchLoader<T>(config: BatchLoaderConfig<T>): BatchLoader {
	const { debounceMs, maxBatchSize, fetchBatch, syncToCollection, isLoaded } = config;

	const pending = new Set<string>();
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let flushInProgress: Promise<void> | null = null;

	function scheduleFlush(): void {
		if (debounceTimer !== null) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			Effect.runPromise(flush());
		}, debounceMs);
	}

	function flush(): Effect.Effect<void, Error> {
		return Effect.gen(function* () {
			// Wait for any in-progress flush to complete first
			if (flushInProgress !== null) {
				yield* Effect.tryPromise({
					try: () => flushInProgress as Promise<void>,
					catch: () => new Error("Previous flush failed"),
				});
			}

			// Cancel any scheduled debounce since we're flushing now
			if (debounceTimer !== null) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}

			// Filter out already-loaded IDs and grab the pending set
			const idsToFetch = Array.from(pending).filter((id) => !isLoaded(id));
			pending.clear();

			if (idsToFetch.length === 0) {
				return;
			}

			const flushSpanId = traceStart("batch-flush", { pending: idsToFetch.length });

			// Process in chunks if exceeding max batch size
			const chunks: string[][] = [];
			for (let i = 0; i < idsToFetch.length; i += maxBatchSize) {
				chunks.push(idsToFetch.slice(i, i + maxBatchSize));
			}

			const failedIds: string[] = [];

			// Process chunks sequentially
			for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
				const chunk = chunks[chunkIndex];
				const chunkSpanId = traceStart("batch-chunk", {
					index: chunkIndex,
					size: chunk.length,
					total: chunks.length,
				});
				const result = yield* pipe(
					fetchBatch(chunk),
					Effect.tap((items) =>
						Effect.sync(() => {
							traceLog("collection-write", { records: items.length });
							syncToCollection(items);
						}),
					),
					Effect.matchEffect({
						onSuccess: () => {
							traceEnd(chunkSpanId, { success: true });
							return Effect.succeed("ok" as const);
						},
						onFailure: () => {
							// Re-queue failed IDs for retry
							for (const id of chunk) {
								failedIds.push(id);
							}
							traceEnd(chunkSpanId, { success: false });
							return Effect.succeed("failed" as const);
						},
					}),
				);
				// result is used to track success/failure, logged implicitly by match
				void result;
			}

			// Re-add failed IDs to pending for retry
			for (const id of failedIds) {
				pending.add(id);
			}

			traceEnd(flushSpanId, {
				fetched: idsToFetch.length - failedIds.length,
				failed: failedIds.length,
			});
		});
	}

	function flushPromise(): Promise<void> {
		const promise = Effect.runPromise(flush());
		flushInProgress = promise;
		promise.finally(() => {
			flushInProgress = null;
		});
		return promise;
	}

	function queue(id: string): void {
		if (isLoaded(id)) {
			return;
		}
		pending.add(id);
		scheduleFlush();
	}

	function queueMany(ids: string[]): void {
		let addedAny = false;
		let cacheHits = 0;
		let cacheMisses = 0;
		for (const id of ids) {
			if (!isLoaded(id)) {
				pending.add(id);
				addedAny = true;
				cacheMisses++;
			} else {
				cacheHits++;
			}
		}
		if (ids.length > 0) {
			traceLog("batch-queue", {
				total: ids.length,
				cacheHits,
				cacheMisses,
				alreadyPending: pending.size - cacheMisses,
			});
		}
		if (addedAny) {
			scheduleFlush();
		}
	}

	function has(id: string): boolean {
		return isLoaded(id);
	}

	function pendingCount(): number {
		return pending.size;
	}

	return {
		queue,
		queueMany,
		flush,
		flushPromise,
		has,
		pendingCount,
	};
}
