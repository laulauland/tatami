/**
 * Suite 2: Watcher lifecycle
 *
 * Tests setup, events, cleanup on switch, and ref-counting of
 * repository file-system watchers.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { resetIdCounter } from "./fixtures";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	unlisten: vi.fn(),
	watchRepository: vi.fn(),
	unwatchRepository: vi.fn(),
	invalidateQueries: vi.fn(),
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
	getRevisionChanges: vi.fn().mockResolvedValue([]),
	getRevisionDiff: vi.fn().mockResolvedValue(""),
	getRevisions: vi.fn().mockResolvedValue([]),
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

import { setupRepoWatcher, teardownRepoWatcher } from "@/db";

describe("Watcher lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetIdCounter();
		mocks.listen.mockResolvedValue(mocks.unlisten);
		mocks.watchRepository.mockResolvedValue(undefined);
		mocks.unwatchRepository.mockResolvedValue(undefined);
	});

	// ── Setup ───────────────────────────────────────────────────────────────

	test("setup calls watchRepository and listen once", async () => {
		const repoPath = "/tmp/watcher-setup";

		await setupRepoWatcher(repoPath);

		expect(mocks.watchRepository).toHaveBeenCalledTimes(1);
		expect(mocks.watchRepository).toHaveBeenCalledWith(repoPath);
		expect(mocks.listen).toHaveBeenCalledTimes(1);
		expect(mocks.listen).toHaveBeenCalledWith("repo-changed", expect.any(Function));
	});

	test("setup is idempotent via ref-counting (no duplicate watchers)", async () => {
		const repoPath = "/tmp/watcher-idempotent";

		await setupRepoWatcher(repoPath);
		await setupRepoWatcher(repoPath);
		await setupRepoWatcher(repoPath);

		expect(mocks.watchRepository).toHaveBeenCalledTimes(1);
		expect(mocks.listen).toHaveBeenCalledTimes(1);
	});

	// ── Ref-counting teardown ───────────────────────────────────────────────

	test("teardown decrements refCount without cleanup until zero", async () => {
		const repoPath = "/tmp/watcher-refcount";

		// Setup twice (refCount = 2)
		await setupRepoWatcher(repoPath);
		await setupRepoWatcher(repoPath);

		// First teardown: refCount → 1 (no cleanup yet)
		await teardownRepoWatcher(repoPath);
		expect(mocks.unlisten).not.toHaveBeenCalled();
		expect(mocks.unwatchRepository).not.toHaveBeenCalled();

		// Second teardown: refCount → 0 (cleanup)
		await teardownRepoWatcher(repoPath);
		expect(mocks.unlisten).toHaveBeenCalledTimes(1);
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(1);
		expect(mocks.unwatchRepository).toHaveBeenCalledWith(repoPath);
	});

	test("teardown is a no-op for unknown repositories", async () => {
		await teardownRepoWatcher("/tmp/watcher-unknown");

		expect(mocks.unwatchRepository).not.toHaveBeenCalled();
		expect(mocks.unlisten).not.toHaveBeenCalled();
	});

	// ── Cleanup on switch ───────────────────────────────────────────────────

	test("switching repos tears down old watcher before setting up new", async () => {
		const events: string[] = [];

		mocks.watchRepository.mockImplementation(async (path: string) => {
			events.push(`watch:${path}`);
		});
		mocks.unwatchRepository.mockImplementation(async (path: string) => {
			events.push(`unwatch:${path}`);
		});

		// Setup repo A
		await setupRepoWatcher("/tmp/repo-a");

		// Tear down repo A, setup repo B (simulates project switch)
		await teardownRepoWatcher("/tmp/repo-a");
		await setupRepoWatcher("/tmp/repo-b");

		expect(events).toEqual(["watch:/tmp/repo-a", "unwatch:/tmp/repo-a", "watch:/tmp/repo-b"]);
	});

	test("rapid switches do not accumulate active watchers", async () => {
		const switchCount = 10;

		for (let i = 0; i < switchCount; i++) {
			const repoPath = `/tmp/rapid-switch-${i}`;
			await setupRepoWatcher(repoPath);
			await teardownRepoWatcher(repoPath);
		}

		// Each repo was watched and unwatched exactly once
		expect(mocks.watchRepository).toHaveBeenCalledTimes(switchCount);
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(switchCount);
	});

	// ── Event callback ──────────────────────────────────────────────────────

	test("setup registers event listener for repo-changed events", async () => {
		await setupRepoWatcher("/tmp/watcher-events");

		// The listen call should have registered a handler for "repo-changed"
		const listenCall = mocks.listen.mock.calls[0];
		expect(listenCall[0]).toBe("repo-changed");
		expect(typeof listenCall[1]).toBe("function");
	});

	test("teardown calls the unlisten function from setup", async () => {
		const customUnlisten = vi.fn();
		mocks.listen.mockResolvedValueOnce(customUnlisten);

		await setupRepoWatcher("/tmp/watcher-unlisten");
		await teardownRepoWatcher("/tmp/watcher-unlisten");

		expect(customUnlisten).toHaveBeenCalledTimes(1);
	});

	// ── Independent watchers ────────────────────────────────────────────────

	test("different repos have independent watchers and ref-counts", async () => {
		await setupRepoWatcher("/tmp/independent-a");
		await setupRepoWatcher("/tmp/independent-b");

		// Tear down only A
		await teardownRepoWatcher("/tmp/independent-a");

		// A should be unwatched, B still active
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(1);
		expect(mocks.unwatchRepository).toHaveBeenCalledWith("/tmp/independent-a");

		// Tear down B
		await teardownRepoWatcher("/tmp/independent-b");
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(2);
		expect(mocks.unwatchRepository).toHaveBeenCalledWith("/tmp/independent-b");
	});

	test("re-setup after full teardown creates fresh watcher", async () => {
		const repoPath = "/tmp/watcher-re-setup";

		await setupRepoWatcher(repoPath);
		await teardownRepoWatcher(repoPath);

		// Should be fully torn down
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(1);

		// Re-setup should create a new watcher
		await setupRepoWatcher(repoPath);
		expect(mocks.watchRepository).toHaveBeenCalledTimes(2);
		expect(mocks.listen).toHaveBeenCalledTimes(2);
	});
});
