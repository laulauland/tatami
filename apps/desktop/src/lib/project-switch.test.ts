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

import { setupRepoWatcher } from "@/db";
import type { Repository } from "@/tauri-commands";
import { switchProjectWithWatcherCleanup } from "./project-switch";

describe("switchProjectWithWatcherCleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listen.mockResolvedValue(mocks.unlisten);
		mocks.watchRepository.mockResolvedValue(undefined);
		mocks.unwatchRepository.mockResolvedValue(undefined);
	});

	test("tears down previous watcher before navigation callback", async () => {
		const previousRepoPath = "/tmp/repo-previous";
		const nextRepository: Repository = {
			id: "repo-next",
			path: "/tmp/repo-next",
			name: "Next",
			last_opened_at: Date.now(),
			revset_preset: "full_history",
		};
		const events: string[] = [];

		mocks.unwatchRepository.mockImplementation(async (repoPath: string) => {
			events.push(`unwatch:${repoPath}`);
		});

		await setupRepoWatcher(previousRepoPath);

		await switchProjectWithWatcherCleanup(previousRepoPath, nextRepository, {
			onTeardownSuccess: (repoPath) => {
				events.push(`teardown-success:${repoPath}`);
			},
			navigateToProject: (projectId) => {
				events.push(`navigate:${projectId}`);
			},
		});

		expect(events).toEqual([
			`unwatch:${previousRepoPath}`,
			`teardown-success:${previousRepoPath}`,
			`navigate:${nextRepository.id}`,
		]);
	});

	test("navigates without teardown when selecting the same repository", async () => {
		const repository: Repository = {
			id: "repo-a",
			path: "/tmp/repo-a",
			name: "Repo A",
			last_opened_at: Date.now(),
			revset_preset: "full_history",
		};
		const navigateToProject = vi.fn();
		const onTeardownSuccess = vi.fn();

		await switchProjectWithWatcherCleanup(repository.path, repository, {
			navigateToProject,
			onTeardownSuccess,
		});

		expect(mocks.unwatchRepository).not.toHaveBeenCalled();
		expect(onTeardownSuccess).not.toHaveBeenCalled();
		expect(navigateToProject).toHaveBeenCalledWith(repository.id);
	});
});
