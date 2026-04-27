import { generateChangeIds } from "@/tauri-commands";
import { queryClient } from "./query-client";

// ============================================================================
// Change ID Pool Collection (pre-allocated IDs for optimistic updates)
// ============================================================================

const POOL_SIZE = 10;
const POOL_REFILL_THRESHOLD = 3;

interface ChangeIdPool {
	repoPath: string;
	ids: string[];
}

function changeIdPoolQueryKey(repoPath: string) {
	return ["change-id-pool", repoPath] as const;
}

async function fetchChangeIdPool(repoPath: string): Promise<ChangeIdPool> {
	const ids = await generateChangeIds(repoPath, POOL_SIZE);
	return { repoPath, ids };
}

/** Ensure the change ID pool is loaded. Call from router beforeLoad. */
export async function ensureChangeIdPool(repoPath: string): Promise<void> {
	// Fast path: if already cached, return immediately without async work
	const existing = queryClient.getQueryData<ChangeIdPool>(changeIdPoolQueryKey(repoPath));
	if (existing && existing.ids.length > 0) {
		return;
	}

	await queryClient.ensureQueryData({
		queryKey: changeIdPoolQueryKey(repoPath),
		queryFn: () => fetchChangeIdPool(repoPath),
	});
}

/** Consume a change ID from the pool, triggering refill if needed */
export function consumeChangeId(repoPath: string): string | null {
	const poolEntry = queryClient.getQueryData<ChangeIdPool>(changeIdPoolQueryKey(repoPath));
	if (!poolEntry || poolEntry.ids.length === 0) return null;

	const [id, ...remaining] = poolEntry.ids;

	// Update the cache directly
	queryClient.setQueryData<ChangeIdPool>(changeIdPoolQueryKey(repoPath), {
		repoPath,
		ids: remaining,
	});

	// Trigger refill if running low
	if (remaining.length < POOL_REFILL_THRESHOLD) {
		generateChangeIds(repoPath, POOL_SIZE).then((newIds) => {
			const current = queryClient.getQueryData<ChangeIdPool>(changeIdPoolQueryKey(repoPath));
			const currentIds = current?.ids ?? [];
			queryClient.setQueryData<ChangeIdPool>(changeIdPoolQueryKey(repoPath), {
				repoPath,
				ids: [...currentIds, ...newIds],
			});
		});
	}

	return id;
}
