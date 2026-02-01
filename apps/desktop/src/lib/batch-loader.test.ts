import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { createBatchLoader } from "./batch-loader";

describe("BatchLoader", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("queues IDs and flushes after debounce", async () => {
		const synced: string[] = [];
		const loader = createBatchLoader({
			debounceMs: 50,
			maxBatchSize: 10,
			fetchBatch: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
			syncToCollection: (items) => synced.push(...items.map((i) => i.id)),
			isLoaded: () => false,
		});

		loader.queue("a");
		loader.queue("b");
		expect(synced).toEqual([]);

		vi.advanceTimersByTime(60);
		await vi.runAllTimersAsync();

		expect(synced).toContain("a");
		expect(synced).toContain("b");
	});

	test("skips already-loaded IDs", () => {
		const loaded = new Set(["existing"]);
		const loader = createBatchLoader({
			debounceMs: 50,
			maxBatchSize: 10,
			fetchBatch: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
			syncToCollection: () => {},
			isLoaded: (id) => loaded.has(id),
		});

		loader.queue("existing");
		expect(loader.pendingCount()).toBe(0);

		loader.queue("new");
		expect(loader.pendingCount()).toBe(1);
	});

	test("chunks large batches", async () => {
		const batchSizes: number[] = [];
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 3,
			fetchBatch: (ids) => {
				batchSizes.push(ids.length);
				return Effect.succeed(ids.map((id) => ({ id })));
			},
			syncToCollection: () => {},
			isLoaded: () => false,
		});

		loader.queueMany(["a", "b", "c", "d", "e", "f", "g"]);
		await loader.flushPromise();

		expect(batchSizes).toEqual([3, 3, 1]);
	});

	test("requeues failed IDs for retry", async () => {
		let failCount = 0;
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 10,
			fetchBatch: (ids) => {
				if (failCount++ < 1) {
					return Effect.fail(new Error("Network error"));
				}
				return Effect.succeed(ids.map((id) => ({ id })));
			},
			syncToCollection: () => {},
			isLoaded: () => false,
		});

		loader.queue("retry-me");
		await loader.flushPromise();

		// Failed ID should be back in pending
		expect(loader.pendingCount()).toBe(1);
	});
});
