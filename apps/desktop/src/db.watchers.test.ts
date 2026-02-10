import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	unlisten: vi.fn(),
	watchRepository: vi.fn(),
	unwatchRepository: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

vi.mock("@/components/ui/sonner", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
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

describe("repo watcher lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listen.mockResolvedValue(mocks.unlisten);
		mocks.watchRepository.mockResolvedValue(undefined);
		mocks.unwatchRepository.mockResolvedValue(undefined);
	});

	test("setup and teardown are ref-counted", async () => {
		const repoPath = "/tmp/repo-watchers-ref-count";

		await setupRepoWatcher(repoPath);
		await setupRepoWatcher(repoPath);

		expect(mocks.watchRepository).toHaveBeenCalledTimes(1);
		expect(mocks.listen).toHaveBeenCalledTimes(1);

		await teardownRepoWatcher(repoPath);

		expect(mocks.unwatchRepository).not.toHaveBeenCalled();
		expect(mocks.unlisten).not.toHaveBeenCalled();

		await teardownRepoWatcher(repoPath);

		expect(mocks.unlisten).toHaveBeenCalledTimes(1);
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(1);
		expect(mocks.unwatchRepository).toHaveBeenCalledWith(repoPath);
	});

	test("teardown is a no-op for unknown repositories", async () => {
		await teardownRepoWatcher("/tmp/repo-watchers-missing");

		expect(mocks.unwatchRepository).not.toHaveBeenCalled();
		expect(mocks.unlisten).not.toHaveBeenCalled();
	});

	test("repeated switches do not accumulate active watchers", async () => {
		for (let i = 0; i < 12; i++) {
			const repoPath = `/tmp/repo-switch-${i}`;
			await setupRepoWatcher(repoPath);
			await teardownRepoWatcher(repoPath);
		}

		expect(mocks.watchRepository).toHaveBeenCalledTimes(12);
		expect(mocks.unwatchRepository).toHaveBeenCalledTimes(12);
	});
});
