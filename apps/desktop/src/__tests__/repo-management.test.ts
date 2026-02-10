/**
 * Suite 1: Repository management
 *
 * Tests add, remove, list, and persistence of repositories through
 * the db.ts functions with mock collections for optimistic updates.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	createMockRepository,
	createMockCollectionForRepos,
	resetIdCounter,
	type MockCollection,
} from "./fixtures";
import type { Repository } from "@/schemas";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
	getRepositories: vi.fn(),
	upsertRepository: vi.fn(),
	removeRepository: vi.fn(),
	listen: vi.fn(),
	watchRepository: vi.fn(),
	unwatchRepository: vi.fn(),
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
	getRepositories: mocks.getRepositories,
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
	removeRepository: mocks.removeRepository,
	undoOperation: vi.fn(),
	unwatchRepository: mocks.unwatchRepository,
	upsertRepository: mocks.upsertRepository,
	watchRepository: mocks.watchRepository,
}));

import {
	addRepository,
	deleteRepository,
	updateRepository,
	ensureRepositories,
	queryClient,
} from "@/db";

// Type alias to make the mock collection compatible with db.ts functions.
// The mock collection duck-types the real TanStack DB collection.
type AnyCollection = Parameters<typeof addRepository>[0];

describe("Repository management", () => {
	let collection: MockCollection<Repository>;

	beforeEach(() => {
		vi.clearAllMocks();
		resetIdCounter();
		mocks.getRepositories.mockResolvedValue([]);
		mocks.upsertRepository.mockResolvedValue(undefined);
		mocks.removeRepository.mockResolvedValue(undefined);
		mocks.listen.mockResolvedValue(vi.fn());

		collection = createMockCollectionForRepos();
	});

	// ── Add ─────────────────────────────────────────────────────────────────

	test("addRepository inserts into collection optimistically", async () => {
		const repo = createMockRepository({ id: "add-1", name: "new-repo" });

		await addRepository(collection as unknown as AnyCollection, repo);

		expect(collection.state.get("add-1")).toBeDefined();
		expect(collection.state.get("add-1")?.name).toBe("new-repo");
	});

	test("addRepository calls upsertRepository backend", async () => {
		const repo = createMockRepository({ id: "add-2" });

		await addRepository(collection as unknown as AnyCollection, repo);

		expect(mocks.upsertRepository).toHaveBeenCalledTimes(1);
		expect(mocks.upsertRepository).toHaveBeenCalledWith(repo);
	});

	test("addRepository reverts optimistic insert on backend failure", async () => {
		mocks.upsertRepository.mockRejectedValueOnce(new Error("DB write failed"));
		const repo = createMockRepository({ id: "add-fail" });

		await expect(addRepository(collection as unknown as AnyCollection, repo)).rejects.toThrow(
			"DB write failed",
		);

		expect(collection.state.get("add-fail")).toBeUndefined();
	});

	// ── Remove ──────────────────────────────────────────────────────────────

	test("deleteRepository removes from collection optimistically", async () => {
		const repo = createMockRepository({ id: "del-1" });
		collection.state.set("del-1", repo);

		await deleteRepository(collection as unknown as AnyCollection, "del-1");

		expect(collection.state.get("del-1")).toBeUndefined();
	});

	test("deleteRepository calls removeRepository backend", async () => {
		const repo = createMockRepository({ id: "del-2" });
		collection.state.set("del-2", repo);

		await deleteRepository(collection as unknown as AnyCollection, "del-2");

		expect(mocks.removeRepository).toHaveBeenCalledWith("del-2");
	});

	test("deleteRepository reverts on backend failure", async () => {
		mocks.removeRepository.mockRejectedValueOnce(new Error("Delete failed"));
		const repo = createMockRepository({ id: "del-fail" });
		collection.state.set("del-fail", repo);

		await expect(
			deleteRepository(collection as unknown as AnyCollection, "del-fail"),
		).rejects.toThrow("Delete failed");

		expect(collection.state.get("del-fail")).toBeDefined();
		expect(collection.state.get("del-fail")?.id).toBe("del-fail");
	});

	// ── Update ──────────────────────────────────────────────────────────────

	test("updateRepository applies changes optimistically", async () => {
		const repo = createMockRepository({ id: "upd-1", name: "old-name" });
		collection.state.set("upd-1", repo);

		const updated = { ...repo, name: "new-name" };
		await updateRepository(collection as unknown as AnyCollection, updated);

		expect(collection.state.get("upd-1")?.name).toBe("new-name");
	});

	test("updateRepository reverts to previous state on failure", async () => {
		mocks.upsertRepository.mockRejectedValueOnce(new Error("Update failed"));
		const repo = createMockRepository({ id: "upd-fail", name: "original" });
		collection.state.set("upd-fail", repo);

		const updated = { ...repo, name: "attempted-change" };
		await expect(updateRepository(collection as unknown as AnyCollection, updated)).rejects.toThrow(
			"Update failed",
		);

		expect(collection.state.get("upd-fail")?.name).toBe("original");
	});

	// ── List / ensureRepositories ────────────────────────────────────────────

	test("ensureRepositories fetches from backend on first call", async () => {
		const repos = [createMockRepository({ id: "list-1" }), createMockRepository({ id: "list-2" })];
		// Clear cache to ensure fresh fetch
		queryClient.removeQueries({ queryKey: ["repositories"] });
		mocks.getRepositories.mockResolvedValueOnce(repos);

		const result = await ensureRepositories();

		expect(result).toHaveLength(2);
		expect(mocks.getRepositories).toHaveBeenCalledTimes(1);
	});

	test("ensureRepositories returns cached data on subsequent calls", async () => {
		const repos = [createMockRepository({ id: "cached-1" })];
		queryClient.removeQueries({ queryKey: ["repositories"] });
		mocks.getRepositories.mockResolvedValueOnce(repos);

		await ensureRepositories();
		const result = await ensureRepositories();

		expect(result).toHaveLength(1);
		// Only called once due to caching
		expect(mocks.getRepositories).toHaveBeenCalledTimes(1);
	});

	// ── Persistence (round-trip) ────────────────────────────────────────────

	test("add then remove leaves collection empty for that ID", async () => {
		const repo = createMockRepository({ id: "roundtrip-1" });

		await addRepository(collection as unknown as AnyCollection, repo);
		expect(collection.state.get("roundtrip-1")).toBeDefined();

		await deleteRepository(collection as unknown as AnyCollection, "roundtrip-1");
		expect(collection.state.get("roundtrip-1")).toBeUndefined();
	});

	test("multiple repositories can coexist in collection", async () => {
		const repo1 = createMockRepository({ id: "multi-1", name: "alpha" });
		const repo2 = createMockRepository({ id: "multi-2", name: "beta" });
		const repo3 = createMockRepository({ id: "multi-3", name: "gamma" });

		await addRepository(collection as unknown as AnyCollection, repo1);
		await addRepository(collection as unknown as AnyCollection, repo2);
		await addRepository(collection as unknown as AnyCollection, repo3);

		expect(collection.state.get("multi-1")?.name).toBe("alpha");
		expect(collection.state.get("multi-2")?.name).toBe("beta");
		expect(collection.state.get("multi-3")?.name).toBe("gamma");
	});

	test("add, update, then remove is a clean lifecycle", async () => {
		const repo = createMockRepository({ id: "lifecycle-1", name: "v1" });

		await addRepository(collection as unknown as AnyCollection, repo);
		expect(collection.state.get("lifecycle-1")?.name).toBe("v1");

		await updateRepository(collection as unknown as AnyCollection, { ...repo, name: "v2" });
		expect(collection.state.get("lifecycle-1")?.name).toBe("v2");

		await deleteRepository(collection as unknown as AnyCollection, "lifecycle-1");
		expect(collection.state.get("lifecycle-1")).toBeUndefined();
	});
});
