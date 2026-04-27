import { listen } from "@tauri-apps/api/event";
import { unwatchRepository, watchRepository } from "@/tauri-commands";
import { inFlightMutations } from "./mutation-tracker";
import { queryClient } from "./query-client";

// ============================================================================
// Shared Repository Watcher (one per repo, invalidates all queries)
// ============================================================================

const repoWatchers = new Map<string, { unlisten: () => void; refCount: number }>();

export async function setupRepoWatcher(repoPath: string): Promise<void> {
	const existing = repoWatchers.get(repoPath);
	if (existing) {
		existing.refCount++;
		return;
	}

	await watchRepository(repoPath);
	const unlisten = await listen<string>("repo-changed", async (event) => {
		if (event.payload === repoPath) {
			// Skip if there are in-flight mutations - let the mutation handle state
			if (inFlightMutations.size > 0) {
				return;
			}

			// Invalidate ALL queries for this repo - TanStack Query will refetch
			await queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["revision-changes", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["revision-diff", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["commit-recency", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["status", repoPath] });
			await queryClient.invalidateQueries({ queryKey: ["conflict-paths", repoPath] });
		}
	});

	repoWatchers.set(repoPath, { unlisten, refCount: 1 });
}

export async function teardownRepoWatcher(repoPath: string): Promise<void> {
	const existing = repoWatchers.get(repoPath);
	if (!existing) {
		return;
	}

	existing.refCount--;
	if (existing.refCount > 0) {
		return;
	}

	repoWatchers.delete(repoPath);
	existing.unlisten();
	await unwatchRepository(repoPath);
}

export async function invalidateRepositoryQueries(repoPath: string): Promise<void> {
	await queryClient.invalidateQueries({ queryKey: ["revisions", repoPath] });
	await queryClient.invalidateQueries({ queryKey: ["revision-changes", repoPath] });
	await queryClient.invalidateQueries({ queryKey: ["revision-diff", repoPath] });
	await queryClient.invalidateQueries({ queryKey: ["commit-recency", repoPath] });
	await queryClient.invalidateQueries({ queryKey: ["status", repoPath] });
	await queryClient.invalidateQueries({ queryKey: ["conflict-paths", repoPath] });
}
