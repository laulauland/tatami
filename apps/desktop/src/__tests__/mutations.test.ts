/**
 * Suite 3: Mutations
 *
 * Tests new/edit/abandon with undo via operation_id through
 * mock collections with optimistic updates.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	createMockRevision,
	createMockCollectionForRevisions,
	resetIdCounter,
	flushMicrotasks,
	type MockCollection,
} from "./fixtures";
import type { Revision } from "@/schemas";

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
	listen: vi.fn(),
	watchRepository: vi.fn(),
	unwatchRepository: vi.fn(),
	jjNew: vi.fn(),
	jjEdit: vi.fn(),
	jjAbandon: vi.fn(),
	jjDescribe: vi.fn(),
	jjSquash: vi.fn(),
	undoOperation: vi.fn(),
	generateChangeIds: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: mocks.listen,
}));

vi.mock("@/components/ui/sonner", () => ({
	toast: {
		success: mocks.toastSuccess,
		error: mocks.toastError,
	},
}));

vi.mock("@/tauri-commands", () => ({
	generateChangeIds: mocks.generateChangeIds,
	getCommitRecency: vi.fn().mockResolvedValue({}),
	getRepositories: vi.fn().mockResolvedValue([]),
	getRevisionChanges: vi.fn().mockResolvedValue([]),
	getRevisionDiff: vi.fn().mockResolvedValue(""),
	getRevisions: vi.fn().mockResolvedValue([]),
	jjAbandon: mocks.jjAbandon,
	jjDescribe: mocks.jjDescribe,
	jjEdit: mocks.jjEdit,
	jjGitFetch: vi.fn(),
	jjGitPush: vi.fn(),
	jjNew: mocks.jjNew,
	jjRebase: vi.fn(),
	jjSquash: mocks.jjSquash,
	removeRepository: vi.fn(),
	undoOperation: mocks.undoOperation,
	unwatchRepository: mocks.unwatchRepository,
	upsertRepository: vi.fn(),
	watchRepository: mocks.watchRepository,
}));

import {
	editRevision,
	newRevision,
	abandonRevision,
	describeRevision,
	squashRevision,
	getRevisionKey,
	queryClient,
} from "@/db";

const REPO_PATH = "/tmp/test-mutations";

// Type alias for mock collection compatibility with db.ts functions
type AnyRevisionsCollection = Parameters<typeof editRevision>[0];

describe("Mutations", () => {
	let parentRev: Revision;
	let wcRev: Revision;
	let collection: MockCollection<Revision>;

	beforeEach(() => {
		vi.clearAllMocks();
		resetIdCounter();

		mocks.listen.mockResolvedValue(vi.fn());
		mocks.jjEdit.mockResolvedValue({ operation_id: "op-edit-1", change_id: null });
		mocks.jjNew.mockResolvedValue({ operation_id: "op-new-1", change_id: "newchangeid1" });
		mocks.jjAbandon.mockResolvedValue({ operation_id: "op-abandon-1", change_id: null });
		mocks.jjDescribe.mockResolvedValue({ operation_id: "op-describe-1", change_id: "wc-change" });
		mocks.jjSquash.mockResolvedValue({ operation_id: "op-squash-1", change_id: null });
		mocks.undoOperation.mockResolvedValue(undefined);
		mocks.generateChangeIds.mockResolvedValue([]);

		parentRev = createMockRevision({
			commit_id: "parent-commit-001",
			change_id: "parentchange1",
			change_id_short: "pare",
			description: "parent commit",
			is_immutable: true,
			is_trunk: true,
		});

		wcRev = createMockRevision({
			commit_id: "wc-commit-001",
			change_id: "wcchangeid01",
			change_id_short: "wcch",
			description: "",
			is_working_copy: true,
			parent_edges: [{ parent_id: parentRev.commit_id, edge_type: "direct" }],
		});

		collection = createMockCollectionForRevisions();
		collection.utils.writeUpsert([parentRev, wcRev]);
	});

	// ── editRevision ────────────────────────────────────────────────────────

	test("editRevision moves working copy flag optimistically", () => {
		const targetRev = createMockRevision({
			commit_id: "target-commit-001",
			change_id: "targetchangid",
			change_id_short: "targ",
			description: "target revision",
		});
		collection.utils.writeUpsert([targetRev]);

		editRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, targetRev, wcRev);

		// Target should now be WC
		const updated = collection.state.get(getRevisionKey(targetRev));
		expect(updated?.is_working_copy).toBe(true);

		// Old WC should no longer be WC
		const oldWc = collection.state.get(getRevisionKey(wcRev));
		expect(oldWc?.is_working_copy).toBe(false);
	});

	test("editRevision calls jjEdit backend", async () => {
		const targetRev = createMockRevision({
			change_id_short: "edit-target",
		});
		collection.utils.writeUpsert([targetRev]);

		editRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, targetRev, wcRev);
		await flushMicrotasks();

		expect(mocks.jjEdit).toHaveBeenCalledWith(REPO_PATH, "edit-target");
	});

	test("editRevision reverts on backend failure", async () => {
		mocks.jjEdit.mockRejectedValueOnce(new Error("Edit failed"));

		const targetRev = createMockRevision({
			commit_id: "fail-target-001",
			change_id: "failtargetid",
			change_id_short: "fail",
		});
		collection.utils.writeUpsert([targetRev]);

		editRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, targetRev, wcRev);

		// Wait for the promise rejection to propagate
		await flushMicrotasks();
		await flushMicrotasks();

		// WC should be reverted back
		const revertedWc = collection.state.get(getRevisionKey(wcRev));
		expect(revertedWc?.is_working_copy).toBe(true);

		const revertedTarget = collection.state.get(getRevisionKey(targetRev));
		expect(revertedTarget?.is_working_copy).toBe(false);
	});

	// ── newRevision ─────────────────────────────────────────────────────────

	test("newRevision calls jjNew with parent change IDs", async () => {
		newRevision(
			collection as unknown as AnyRevisionsCollection,
			REPO_PATH,
			[parentRev.change_id],
			parentRev,
			wcRev,
		);
		await flushMicrotasks();

		expect(mocks.jjNew).toHaveBeenCalledWith(
			REPO_PATH,
			[parentRev.change_id],
			undefined, // No pre-allocated ID when pool is empty
		);
	});

	test("newRevision with pre-allocated change ID uses pool", async () => {
		// Seed the change ID pool in query cache
		queryClient.setQueryData(["change-id-pool", REPO_PATH], {
			repoPath: REPO_PATH,
			ids: ["preallocated01"],
		});

		newRevision(
			collection as unknown as AnyRevisionsCollection,
			REPO_PATH,
			[parentRev.change_id],
			parentRev,
			wcRev,
		);
		await flushMicrotasks();

		expect(mocks.jjNew).toHaveBeenCalledWith(REPO_PATH, [parentRev.change_id], "preallocated01");
	});

	test("newRevision creates optimistic revision when pool has IDs", () => {
		queryClient.setQueryData(["change-id-pool", REPO_PATH], {
			repoPath: REPO_PATH,
			ids: ["optimisticid1", "spare000002"],
		});

		newRevision(
			collection as unknown as AnyRevisionsCollection,
			REPO_PATH,
			[parentRev.change_id],
			parentRev,
			wcRev,
		);

		// The optimistic revision should exist in the collection
		const optimistic = collection.state.get("optimisticid1");
		expect(optimistic).toBeDefined();
		expect(optimistic?.is_working_copy).toBe(true);
		expect(optimistic?.parent_edges[0]?.parent_id).toBe(parentRev.commit_id);
	});

	// ── abandonRevision ─────────────────────────────────────────────────────

	test("abandonRevision optimistically removes non-WC revision", () => {
		const nonWcRev = createMockRevision({
			commit_id: "abandon-target-001",
			change_id: "abandontarget",
			change_id_short: "aban",
			description: "to be abandoned",
		});
		collection.utils.writeUpsert([nonWcRev]);

		abandonRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, nonWcRev);

		expect(collection.state.get(getRevisionKey(nonWcRev))).toBeUndefined();
	});

	test("abandonRevision does NOT optimistically remove WC revision", () => {
		abandonRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, wcRev);

		// WC should still be in collection (backend handles the swap)
		expect(collection.state.get(getRevisionKey(wcRev))).toBeDefined();
	});

	test("abandonRevision calls jjAbandon backend", async () => {
		const rev = createMockRevision({ change_id_short: "aban-be" });
		collection.utils.writeUpsert([rev]);

		abandonRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, rev);
		await flushMicrotasks();

		expect(mocks.jjAbandon).toHaveBeenCalledWith(REPO_PATH, "aban-be");
	});

	test("abandonRevision shows toast with undo action on success", async () => {
		const rev = createMockRevision({
			change_id_short: "undo-test",
		});
		collection.utils.writeUpsert([rev]);

		abandonRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, rev);
		await flushMicrotasks();
		await flushMicrotasks();

		expect(mocks.toastSuccess).toHaveBeenCalledWith(
			expect.stringContaining("undo-test"),
			expect.objectContaining({
				action: expect.objectContaining({
					label: "Undo",
					onClick: expect.any(Function),
				}),
			}),
		);
	});

	test("abandonRevision undo calls undoOperation with operation_id", async () => {
		mocks.jjAbandon.mockResolvedValueOnce({ operation_id: "op-undo-test", change_id: null });

		const rev = createMockRevision({ change_id_short: "undo-op" });
		collection.utils.writeUpsert([rev]);

		abandonRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, rev);
		await flushMicrotasks();
		await flushMicrotasks();

		// Extract the undo onClick handler from the toast call
		const toastCall = mocks.toastSuccess.mock.calls[0];
		const undoAction = toastCall?.[1]?.action;
		expect(undoAction).toBeDefined();

		// Trigger undo
		undoAction.onClick();
		await flushMicrotasks();

		expect(mocks.undoOperation).toHaveBeenCalledWith(REPO_PATH, "op-undo-test");
	});

	test("abandonRevision reverts optimistic delete on backend failure", async () => {
		mocks.jjAbandon.mockRejectedValueOnce(new Error("Abandon failed"));

		const rev = createMockRevision({
			commit_id: "reverted-001",
			change_id: "revertedaban1",
			change_id_short: "reve",
		});
		collection.utils.writeUpsert([rev]);

		abandonRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, rev);
		await flushMicrotasks();
		await flushMicrotasks();

		// Should be restored
		expect(collection.state.get(getRevisionKey(rev))).toBeDefined();
	});

	// ── describeRevision ────────────────────────────────────────────────────

	test("describeRevision updates description optimistically", () => {
		describeRevision(
			collection as unknown as AnyRevisionsCollection,
			REPO_PATH,
			wcRev,
			"new description",
		);

		const updated = collection.state.get(getRevisionKey(wcRev));
		expect(updated?.description).toBe("new description");
	});

	test("describeRevision calls jjDescribe backend", async () => {
		describeRevision(
			collection as unknown as AnyRevisionsCollection,
			REPO_PATH,
			wcRev,
			"backend desc",
		);
		await flushMicrotasks();

		expect(mocks.jjDescribe).toHaveBeenCalledWith(REPO_PATH, wcRev.change_id_short, "backend desc");
	});

	test("describeRevision reverts description on backend failure", async () => {
		mocks.jjDescribe.mockRejectedValueOnce(new Error("Describe failed"));

		const rev = createMockRevision({
			commit_id: "desc-fail-001",
			change_id: "descfailid01",
			change_id_short: "desc",
			description: "original text",
		});
		collection.utils.writeUpsert([rev]);

		describeRevision(
			collection as unknown as AnyRevisionsCollection,
			REPO_PATH,
			rev,
			"attempted change",
		);

		// Optimistic update applied immediately
		expect(collection.state.get(getRevisionKey(rev))?.description).toBe("attempted change");

		await flushMicrotasks();
		await flushMicrotasks();

		// Should revert
		expect(collection.state.get(getRevisionKey(rev))?.description).toBe("original text");
	});

	// ── squashRevision ──────────────────────────────────────────────────────

	test("squashRevision rejects immutable revisions", () => {
		squashRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, parentRev);

		expect(mocks.jjSquash).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith(
			"Cannot squash immutable revision",
			expect.anything(),
		);
	});

	test("squashRevision rejects revisions with no parents", () => {
		const rootRev = createMockRevision({
			parent_edges: [],
			is_immutable: false,
		});
		collection.utils.writeUpsert([rootRev]);

		squashRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, rootRev);

		expect(mocks.jjSquash).not.toHaveBeenCalled();
		expect(mocks.toastError).toHaveBeenCalledWith("Cannot squash root revision", expect.anything());
	});

	test("squashRevision optimistically removes non-WC revision", () => {
		const rev = createMockRevision({
			commit_id: "squash-target-001",
			change_id: "squashtarget1",
			change_id_short: "squa",
			is_immutable: false,
			parent_edges: [{ parent_id: parentRev.commit_id, edge_type: "direct" }],
		});
		collection.utils.writeUpsert([rev]);

		squashRevision(collection as unknown as AnyRevisionsCollection, REPO_PATH, rev);

		expect(collection.state.get(getRevisionKey(rev))).toBeUndefined();
	});
});
