import { useNavigate } from "@tanstack/react-router";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useState } from "react";
import { addRepository, repositoriesCollection } from "@/db";
import { findRepository, findRepositoryByPath, type Repository } from "@/tauri-commands";

const openDirectoryDialogEffect = Effect.gen(function* () {
	const home = yield* Effect.tryPromise({
		try: () => homeDir(),
		catch: (error) => new Error(`Failed to get home directory: ${error}`),
	});

	return yield* Effect.tryPromise({
		try: () =>
			open({
				directory: true,
				multiple: false,
				defaultPath: home,
				title: "Select Repository",
			}),
		catch: (error) => new Error(`Failed to open directory dialog: ${error}`),
	});
});

const findRepositoryEffect = (startPath: string) =>
	Effect.tryPromise({
		try: () => findRepository(startPath),
		catch: (error) => new Error(`Failed to find repository: ${error}`),
	});

/**
 * Hook for adding a new repository via directory picker dialog.
 * Returns a handler that opens the dialog and navigates to the project.
 */
export function useAddRepository() {
	const navigate = useNavigate();
	const [isAdding, setIsAdding] = useState(false);

	function handleAddRepository() {
		if (isAdding) return;
		setIsAdding(true);

		const program = Effect.gen(function* () {
			const selected = yield* openDirectoryDialogEffect;
			if (!selected) return;

			const repoPath = yield* findRepositoryEffect(selected);
			if (!repoPath) return;

			const existingRepository = yield* Effect.tryPromise({
				try: () => findRepositoryByPath(repoPath),
				catch: () => null,
			});

			const repositoryId = existingRepository?.id ?? crypto.randomUUID();
			const name = repoPath.split("/").pop() ?? repoPath;

			const repository: Repository = {
				id: repositoryId,
				path: repoPath,
				name,
				last_opened_at: Date.now(),
				revset_preset: null,
			};

			yield* Effect.tryPromise({
				try: () => addRepository(repositoriesCollection, repository),
				catch: (error) => new Error(`Failed to save repository: ${error}`),
			});

			yield* Effect.sync(() => {
				navigate({ to: "/project/$projectId", params: { projectId: repositoryId } });
			});
		}).pipe(
			Effect.tapError((error) => Effect.logError("handleAddRepository failed", error)),
			Effect.catchAll(() => Effect.void),
		);

		Effect.runPromise(program).finally(() => setIsAdding(false));
	}

	return { handleAddRepository, isAdding };
}
