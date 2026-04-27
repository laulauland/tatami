import { toast } from "@/components/ui/sonner";
import { getRevisions, jjGitFetch, jjGitPush } from "@/tauri-commands";
import { reconcileOperation } from "../collections/operations";
import { invalidateRepositoryQueries } from "../watchers";

function isAuthError(errorText: string): boolean {
	const text = errorText.toLowerCase();
	return (
		text.includes("auth") ||
		text.includes("authentication") ||
		text.includes("permission denied") ||
		text.includes("publickey") ||
		text.includes("credential") ||
		text.includes("forbidden")
	);
}

export async function syncRepository(repoPath: string, preset?: string): Promise<void> {
	const limit = preset === "full_history" ? 10000 : 100;

	try {
		const fetchResult = await jjGitFetch(repoPath, "origin");
		await invalidateRepositoryQueries(repoPath);
		void reconcileOperation(repoPath, fetchResult.operation_id);

		const revisions = await getRevisions(repoPath, limit, undefined, preset);
		const aheadBookmarks = Array.from(
			new Set(
				revisions.flatMap((revision) =>
					revision.bookmarks
						.filter((bookmark) => bookmark.is_ahead)
						.map((bookmark) => bookmark.name),
				),
			),
		);

		if (aheadBookmarks.length > 0) {
			const pushResult = await jjGitPush(repoPath, aheadBookmarks, "origin");
			await invalidateRepositoryQueries(repoPath);
			void reconcileOperation(repoPath, pushResult.operation_id);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (isAuthError(message)) {
			toast.error("Sync failed: authentication error. Check SSH keys or credential helper.", {
				description: message,
				duration: Number.POSITIVE_INFINITY,
			});
			return;
		}

		toast.error(`Sync failed: ${message}`, {
			duration: Number.POSITIVE_INFINITY,
		});
	}
}
