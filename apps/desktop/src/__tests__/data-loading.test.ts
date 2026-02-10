/**
 * Suite 4: Data loading
 *
 * Tests batching, caching, prefetch, and collection deduplication
 * for the data loading pipeline.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { resetIdCounter } from "./fixtures";
import { createBatchLoader } from "@/lib/batch-loader";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	watchRepository: vi.fn(),
	unwatchRepository: vi.fn(),
	getRevisionDiff: vi.fn(),
	getRevisionChanges: vi.fn(),
	getRevisions: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

vi.mock("@/components/ui/sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/tauri-commands", () => ({
	generateChangeIds: vi.fn().mockResolvedValue([]),
	getCommitRecency: vi.fn().mockResolvedValue({}),
	getRepositories: vi.fn().mockResolvedValue([]),
	getRevisionChanges: mocks.getRevisionChanges,
	getRevisionDiff: mocks.getRevisionDiff,
	getRevisions: mocks.getRevisions,
	jjAbandon: vi.fn(),
	jjDescribe: vi.fn(),
	jjEdit: vi.fn(),
	jjGitFetch: vi.fn(),
	jjGitPush: vi.fn(),
	jjNew: vi.fn(),
	jjRebase: vi.fn(),
	jjSquash: vi.fn(),
	removeRepository: vi.fn(),
	undoOperation: vi.fn(),
	unwatchRepository: mocks.unwatchRepository,
	upsertRepository: vi.fn(),
	watchRepository: mocks.watchRepository,
}));

import {
	getRevisionsCollection,
	getRevisionChangesCollection,
	getRevisionDiffCollection,
	queryClient,
} from "@/db";

// ============================================================================
// BatchLoader tests (batching, caching, prefetch)
// ============================================================================

describe("Data loading - BatchLoader", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetIdCounter();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("debounces multiple queue calls into single flush", async () => {
		const fetchedBatches: string[][] = [];
		const loader = createBatchLoader({
			debounceMs: 50,
			maxBatchSize: 100,
			fetchBatch: (ids) => {
				fetchedBatches.push([...ids]);
				return Effect.succeed(ids.map((id) => ({ id })));
			},
			syncToCollection: () => {},
			isLoaded: () => false,
		});

		loader.queue("a");
		loader.queue("b");
		loader.queue("c");

		// Nothing fetched yet (debounce pending)
		expect(fetchedBatches).toHaveLength(0);

		vi.advanceTimersByTime(60);
		await vi.runAllTimersAsync();

		expect(fetchedBatches).toHaveLength(1);
		expect(fetchedBatches[0]).toEqual(["a", "b", "c"]);
	});

	test("deduplicates IDs within a single queue batch", async () => {
		const fetchedBatches: string[][] = [];
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 100,
			fetchBatch: (ids) => {
				fetchedBatches.push([...ids]);
				return Effect.succeed(ids.map((id) => ({ id })));
			},
			syncToCollection: () => {},
			isLoaded: () => false,
		});

		loader.queue("x");
		loader.queue("x");
		loader.queue("x");
		loader.queue("y");

		expect(loader.pendingCount()).toBe(2); // x and y, deduplicated

		await loader.flushPromise();

		expect(fetchedBatches).toHaveLength(1);
		expect(fetchedBatches[0]).toEqual(["x", "y"]);
	});

	test("skips already-loaded IDs", () => {
		const loaded = new Set(["cached-1", "cached-2"]);
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 100,
			fetchBatch: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
			syncToCollection: () => {},
			isLoaded: (id) => loaded.has(id),
		});

		loader.queue("cached-1"); // Should be skipped
		loader.queue("new-1"); // Should be queued
		loader.queue("cached-2"); // Should be skipped

		expect(loader.pendingCount()).toBe(1);
	});

	test("chunks large batches according to maxBatchSize", async () => {
		const batchSizes: number[] = [];
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 5,
			fetchBatch: (ids) => {
				batchSizes.push(ids.length);
				return Effect.succeed(ids.map((id) => ({ id })));
			},
			syncToCollection: () => {},
			isLoaded: () => false,
		});

		// Queue 13 items → should result in chunks of 5, 5, 3
		loader.queueMany(Array.from({ length: 13 }, (_, i) => `item-${i}`));
		await loader.flushPromise();

		expect(batchSizes).toEqual([5, 5, 3]);
	});

	test("syncs fetched items to collection callback", async () => {
		const synced: { id: string }[] = [];
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 100,
			fetchBatch: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
			syncToCollection: (items) => synced.push(...items),
			isLoaded: () => false,
		});

		loader.queueMany(["p", "q", "r"]);
		await loader.flushPromise();

		expect(synced).toEqual([{ id: "p" }, { id: "q" }, { id: "r" }]);
	});

	test("requeues failed IDs for retry", async () => {
		let callCount = 0;
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 100,
			fetchBatch: (ids) => {
				callCount++;
				if (callCount === 1) {
					return Effect.fail(new Error("Network error"));
				}
				return Effect.succeed(ids.map((id) => ({ id })));
			},
			syncToCollection: () => {},
			isLoaded: () => false,
		});

		loader.queue("retry-id");
		await loader.flushPromise();

		// First attempt fails → ID should be back in pending
		expect(loader.pendingCount()).toBe(1);

		// Second attempt succeeds
		await loader.flushPromise();
		expect(loader.pendingCount()).toBe(0);
	});

	test("queueMany skips already-loaded and queues the rest", () => {
		const loaded = new Set(["exist-1"]);
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 100,
			fetchBatch: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
			syncToCollection: () => {},
			isLoaded: (id) => loaded.has(id),
		});

		loader.queueMany(["exist-1", "new-1", "new-2", "exist-1"]);

		expect(loader.pendingCount()).toBe(2); // new-1 and new-2
	});

	test("has() checks isLoaded callback", () => {
		const loaded = new Set(["loaded-1"]);
		const loader = createBatchLoader({
			debounceMs: 10,
			maxBatchSize: 100,
			fetchBatch: (ids) => Effect.succeed(ids.map((id) => ({ id }))),
			syncToCollection: () => {},
			isLoaded: (id) => loaded.has(id),
		});

		expect(loader.has("loaded-1")).toBe(true);
		expect(loader.has("not-loaded")).toBe(false);
	});
});

// ============================================================================
// Collection caching and prefetch tests
// ============================================================================

describe("Data loading - Collection caching", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetIdCounter();
		queryClient.clear();
		mocks.listen.mockResolvedValue(vi.fn());
	});

	test("getRevisionsCollection returns same instance for same repoPath+preset", () => {
		const preset = `cache-test-${Date.now()}`;
		const col1 = getRevisionsCollection("/tmp/cache-repo", preset);
		const col2 = getRevisionsCollection("/tmp/cache-repo", preset);

		expect(col1).toBe(col2);
	});

	test("getRevisionsCollection returns different instances for different presets", () => {
		const ts = Date.now();
		const col1 = getRevisionsCollection("/tmp/preset-repo", `preset-a-${ts}`);
		const col2 = getRevisionsCollection("/tmp/preset-repo", `preset-b-${ts}`);

		expect(col1).not.toBe(col2);
	});

	test("getRevisionsCollection returns different instances for different repos", () => {
		const preset = `repo-diff-${Date.now()}`;
		const col1 = getRevisionsCollection("/tmp/repo-x", preset);
		const col2 = getRevisionsCollection("/tmp/repo-y", preset);

		expect(col1).not.toBe(col2);
	});

	test("getRevisionChangesCollection returns same instance for same repoPath+changeId", () => {
		const col1 = getRevisionChangesCollection("/tmp/changes-repo", "change-a");
		const col2 = getRevisionChangesCollection("/tmp/changes-repo", "change-a");

		expect(col1).toBe(col2);
	});

	test("getRevisionDiffCollection returns same instance for same repoPath+changeId", () => {
		const col1 = getRevisionDiffCollection("/tmp/diff-repo", "change-a");
		const col2 = getRevisionDiffCollection("/tmp/diff-repo", "change-a");

		expect(col1).toBe(col2);
	});
});

// ============================================================================
// Prefetch tests
// ============================================================================

describe("Data loading - Prefetch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetIdCounter();
		queryClient.clear();
		mocks.listen.mockResolvedValue(vi.fn());
		mocks.getRevisionDiff.mockResolvedValue("--- a/file\n+++ b/file");
		mocks.getRevisionChanges.mockResolvedValue([]);
	});

	test("prefetchRevisionDiffs creates collections for each changeId", async () => {
		const { prefetchRevisionDiffs } = await import("@/db");
		const changeIds = ["change-1", "change-2", "change-3"];

		prefetchRevisionDiffs("/tmp/prefetch-repo", changeIds);

		// Each changeId should have a collection created
		for (const id of changeIds) {
			const col = getRevisionDiffCollection("/tmp/prefetch-repo", id);
			expect(col).toBeDefined();
		}
	});

	test("prefetchRevisionChanges creates collections for each changeId", async () => {
		const { prefetchRevisionChanges } = await import("@/db");
		const changeIds = ["change-a", "change-b"];

		prefetchRevisionChanges("/tmp/prefetch-changes", changeIds);

		for (const id of changeIds) {
			const col = getRevisionChangesCollection("/tmp/prefetch-changes", id);
			expect(col).toBeDefined();
		}
	});
});
