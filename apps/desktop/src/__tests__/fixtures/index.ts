/**
 * Shared test fixtures and helpers for integration tests.
 *
 * Provides deterministic mock data factories, mock collections,
 * and waitFor utilities.
 */

import { vi } from "vitest";
import type { Revision, Repository, ChangedFile, BookmarkInfo } from "@/schemas";

// ============================================================================
// Deterministic ID generation (no randomness for reproducible tests)
// ============================================================================

let idCounter = 0;

/** Reset the counter between tests for deterministic runs */
export function resetIdCounter(): void {
	idCounter = 0;
}

/** Generate a deterministic change ID (12 chars, k-z range like jj) */
export function deterministicChangeId(): string {
	const chars = "klmnopqrstuvwxyz";
	const num = idCounter++;
	let result = "";
	let remaining = num;
	for (let i = 0; i < 12; i++) {
		result = chars[remaining % chars.length] + result;
		remaining = Math.floor(remaining / chars.length);
	}
	return result;
}

/** Generate a deterministic commit ID (hex-like) */
export function deterministicCommitId(): string {
	return `commit${String(idCounter++).padStart(10, "0")}`;
}

// ============================================================================
// Mock data factories
// ============================================================================

export function createMockBookmark(
	name: string,
	overrides?: Partial<Omit<BookmarkInfo, "name">>,
): BookmarkInfo {
	return {
		name,
		is_tracked: overrides?.is_tracked ?? true,
		remote: overrides?.remote ?? "origin",
		is_ahead: overrides?.is_ahead ?? false,
		is_behind: overrides?.is_behind ?? false,
		is_conflicted: overrides?.is_conflicted ?? false,
	};
}

export function createMockRevision(overrides?: Partial<Revision>): Revision {
	const changeId = overrides?.change_id ?? deterministicChangeId();
	const commitId = overrides?.commit_id ?? deterministicCommitId();
	return {
		commit_id: commitId,
		change_id: changeId,
		change_id_short: overrides?.change_id_short ?? changeId.slice(0, 4),
		parent_edges: overrides?.parent_edges ?? [],
		children_ids: overrides?.children_ids ?? [],
		description: overrides?.description ?? "",
		author: overrides?.author ?? "test@example.com",
		timestamp: overrides?.timestamp ?? "2026-01-01T00:00:00Z",
		is_working_copy: overrides?.is_working_copy ?? false,
		is_immutable: overrides?.is_immutable ?? false,
		is_mine: overrides?.is_mine ?? true,
		is_trunk: overrides?.is_trunk ?? false,
		is_divergent: overrides?.is_divergent ?? false,
		divergent_index: overrides?.divergent_index ?? null,
		has_conflict: overrides?.has_conflict ?? false,
		bookmarks: overrides?.bookmarks ?? [],
	};
}

export function createMockRepository(overrides?: Partial<Repository>): Repository {
	const id = overrides?.id ?? `repo-${idCounter++}`;
	return {
		id,
		path: overrides?.path ?? `/tmp/test-repos/${id}`,
		name: overrides?.name ?? `test-repo-${id}`,
		last_opened_at: overrides?.last_opened_at ?? 1700000000000,
		revset_preset: overrides?.revset_preset ?? null,
	};
}

export function createMockChangedFile(overrides?: Partial<ChangedFile>): ChangedFile {
	return {
		path: overrides?.path ?? `src/file-${idCounter++}.ts`,
		status: overrides?.status ?? "modified",
	};
}

// ============================================================================
// Deterministic revision graph builder
// ============================================================================

/** Build a linear chain of revisions for testing */
export function buildRevisionChain(count: number): Revision[] {
	resetIdCounter();
	const revisions: Revision[] = [];

	for (let i = 0; i < count; i++) {
		const rev = createMockRevision({
			parent_edges: i > 0 ? [{ parent_id: revisions[i - 1].commit_id, edge_type: "direct" }] : [],
			is_working_copy: i === count - 1,
			is_immutable: i < count - 2,
			description: `Commit ${i}`,
		});

		// Set children_ids on parent
		if (i > 0) {
			revisions[i - 1] = {
				...revisions[i - 1],
				children_ids: [...revisions[i - 1].children_ids, rev.commit_id],
			};
		}

		revisions.push(rev);
	}

	return revisions;
}

// ============================================================================
// Mock collection (replaces TanStack DB collection for unit testing)
// ============================================================================

export interface MockCollection<T> {
	state: Map<string, T>;
	utils: {
		writeUpsert: (items: T[]) => void;
		writeDelete: (key: string) => void;
	};
}

/**
 * Creates a lightweight mock collection that implements the same interface
 * as TanStack DB collections used by db.ts functions.
 * This avoids the complex async sync initialization of real collections.
 */
export function createMockCollectionForRepos(): MockCollection<Repository> {
	const state = new Map<string, Repository>();
	return {
		state,
		utils: {
			writeUpsert: (items: Repository[]) => {
				for (const item of items) {
					state.set(item.id, item);
				}
			},
			writeDelete: (key: string) => {
				state.delete(key);
			},
		},
	};
}

/** Key function matching db.ts getRevisionKey */
function revisionKey(r: Revision): string {
	if (r.divergent_index != null) {
		return `${r.change_id}/${r.divergent_index}`;
	}
	return r.change_id;
}

export function createMockCollectionForRevisions(): MockCollection<Revision> {
	const state = new Map<string, Revision>();
	return {
		state,
		utils: {
			writeUpsert: (items: Revision[]) => {
				for (const item of items) {
					state.set(revisionKey(item), item);
				}
			},
			writeDelete: (key: string) => {
				state.delete(key);
			},
		},
	};
}

// ============================================================================
// waitFor utility for timing-sensitive tests
// ============================================================================

export interface WaitForOptions {
	timeout?: number;
	interval?: number;
}

/**
 * Poll a condition until it returns true or timeout is reached.
 * Works with both real and fake timers.
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	options?: WaitForOptions,
): Promise<void> {
	const { timeout = 2000, interval = 10 } = options ?? {};
	const start = Date.now();

	while (Date.now() - start < timeout) {
		const result = await condition();
		if (result) return;
		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Wait for a mock function to have been called a specified number of times.
 */
export async function waitForCalls(
	mockFn: ReturnType<typeof vi.fn>,
	count: number,
	options?: WaitForOptions,
): Promise<void> {
	await waitFor(() => mockFn.mock.calls.length >= count, options);
}

/**
 * Flush all pending microtasks and settled promises.
 */
export async function flushMicrotasks(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================================================
// Standard Tauri command mock creator
// ============================================================================

export function createTauriCommandMocks() {
	return {
		generateChangeIds: vi.fn().mockResolvedValue([]),
		getCommitRecency: vi.fn().mockResolvedValue({}),
		getRepositories: vi.fn().mockResolvedValue([]),
		getRevisionChanges: vi.fn().mockResolvedValue([]),
		getRevisionDiff: vi.fn().mockResolvedValue(""),
		getRevisions: vi.fn().mockResolvedValue([]),
		jjAbandon: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjDescribe: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjEdit: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjGitFetch: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjGitPush: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjNew: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjRebase: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		jjSquash: vi.fn().mockResolvedValue({ operation_id: "op-1", change_id: null }),
		removeRepository: vi.fn().mockResolvedValue(undefined),
		undoOperation: vi.fn().mockResolvedValue(undefined),
		unwatchRepository: vi.fn().mockResolvedValue(undefined),
		upsertRepository: vi.fn().mockResolvedValue(undefined),
		watchRepository: vi.fn().mockResolvedValue(undefined),
	};
}
