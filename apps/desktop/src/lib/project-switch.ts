import { teardownRepoWatcher } from "@/db";
import type { Repository } from "@/tauri-commands";

interface SwitchProjectOptions {
	navigateToProject: (projectId: string) => void;
	onTeardownSuccess?: (repoPath: string) => void;
}

export async function switchProjectWithWatcherCleanup(
	previousRepoPath: string | null,
	nextRepository: Repository,
	options: SwitchProjectOptions,
): Promise<void> {
	try {
		if (previousRepoPath && previousRepoPath !== nextRepository.path) {
			await teardownRepoWatcher(previousRepoPath);
			options.onTeardownSuccess?.(previousRepoPath);
		}
	} finally {
		options.navigateToProject(nextRepository.id);
	}
}
