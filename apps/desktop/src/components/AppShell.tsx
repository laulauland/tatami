import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useRef, useState } from "react";
import { stackViewChangeIdAtom } from "@/atoms";
import { AceJump } from "@/components/AceJump";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { ProjectPicker } from "@/components/ProjectPicker";
import {
	RevisionGraph,
	type RevisionGraphHandle,
	reorderForGraph,
} from "@/components/RevisionGraph";
import { StackIndicator } from "@/components/StackIndicator";
import { StatusBar } from "@/components/StatusBar";

import {
	editRevision,
	emptyRevisionsCollection,
	getRevisionsCollection,
	newRevision,
	repositoriesCollection,
} from "@/db";
import { useKeyboardNavigation, useKeyboardShortcut, useKeySequence } from "@/hooks/useKeyboard";
import {
	findRepository,
	findRepositoryByPath,
	type Repository,
	type Revision,
	upsertRepository,
} from "@/tauri-commands";

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

export function AppShell() {
	const navigate = useNavigate();
	const { projectId } = useParams({ strict: false });
	const { rev } = useSearch({ strict: false });
	const [flash, setFlash] = useState<{ changeId: string; key: number } | null>(null);
	const [stackViewChangeId, setStackViewChangeId] = useAtom(stackViewChangeIdAtom);
	const revisionGraphRef = useRef<RevisionGraphHandle>(null);

	useKeyboardShortcut({
		key: ",",
		modifiers: { meta: true, ctrl: true },
		onPress: () => navigate({ to: "/settings" }),
	});

	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);

	const activeProject = repositories.find((p) => p.id === projectId) ?? null;

	// Build the stack revset: the full branch containing the selected commit
	// (::X ~ ::trunk()) gives ancestors of X that are NOT ancestors of trunk (the branch below X)
	// X:: gives descendants of X (the branch above X)
	// roots(...)- gives the parent of the first branch commit (the merge base)
	// (X & ::trunk()) handles the case where X is already an ancestor of trunk (just show X)
	const stackRevset = stackViewChangeId
		? `(::${stackViewChangeId} ~ ::trunk()) | (${stackViewChangeId}:: ~ ::trunk()) | roots(::${stackViewChangeId} ~ ::trunk())- | (${stackViewChangeId} & ::trunk())`
		: undefined;

	const revisionsCollection = activeProject
		? getRevisionsCollection(
				activeProject.path,
				activeProject.revset_preset ?? "full_history",
				stackRevset,
			)
		: emptyRevisionsCollection;

	const { data: revisions = [], isLoading = false } = useLiveQuery(revisionsCollection);

	const orderedRevisions = reorderForGraph(revisions);

	const selectedRevision = (() => {
		if (revisions.length === 0) return null;
		if (rev) {
			const found = revisions.find((r) => r.change_id === rev);
			if (found) return found;
		}
		return revisions.find((r) => r.is_working_copy) || revisions[0];
	})();

	function handleOpenRepo() {
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
				try: () => upsertRepository(repository),
				catch: (error) => new Error(`Failed to save repository: ${error}`),
			});

			yield* Effect.sync(() => {
				repositoriesCollection.utils.writeUpsert([repository]);
				navigate({ to: "/project/$projectId", params: { projectId: repositoryId } });
			});
		}).pipe(
			Effect.tapError((error) => Effect.logError("handleOpenRepo failed", error)),
			Effect.catchAll(() => Effect.void),
		);
		Effect.runPromise(program);
	}

	function handleSelectRepository(repository: Repository) {
		setStackViewChangeId(null); // Clear stack view when switching repositories
		navigate({ to: "/project/$projectId", params: { projectId: repository.id } });
	}

	function handleSelectRevision(revision: Revision) {
		if (!projectId) return;
		navigate({
			to: "/project/$projectId",
			params: { projectId },
			search: { rev: revision.change_id },
		});
	}

	function handleNavigateToChangeId(changeId: string) {
		if (!projectId) return;
		navigate({
			to: "/project/$projectId",
			params: { projectId },
			search: { rev: changeId || undefined },
		});
	}

	useKeyboardNavigation({
		orderedRevisions,
		selectedChangeId: rev ?? null,
		onNavigate: handleNavigateToChangeId,
		scrollToChangeId: (changeId) => revisionGraphRef.current?.scrollToChangeId(changeId),
	});

	function triggerFlash(changeId: string) {
		setFlash({ changeId, key: Date.now() });
		setTimeout(() => setFlash(null), 400);
	}

	function handleYankId() {
		if (!selectedRevision) return;
		navigator.clipboard.writeText(selectedRevision.change_id);
		triggerFlash(selectedRevision.change_id);
	}

	function handleYankLink() {
		if (!selectedRevision || !projectId) return;
		const link = `tatami://project/${projectId}/revision/${selectedRevision.change_id}`;
		navigator.clipboard.writeText(link);
		triggerFlash(selectedRevision.change_id);
	}

	useKeySequence({ sequence: "yy", onTrigger: handleYankId, enabled: !!selectedRevision });
	useKeySequence({
		sequence: "yY",
		onTrigger: handleYankLink,
		enabled: !!selectedRevision && !!projectId,
	});

	function handleNew() {
		if (!activeProject || !selectedRevision) return;
		newRevision(activeProject.path, [selectedRevision.change_id]);
	}

	function handleEdit() {
		if (!activeProject || !selectedRevision) return;
		const currentWC = revisions.find((r) => r.is_working_copy);
		editRevision(activeProject.path, selectedRevision.change_id, currentWC?.change_id ?? null);
	}

	useKeyboardShortcut({
		key: "n",
		onPress: handleNew,
		enabled: !!activeProject && !!selectedRevision,
	});

	useKeyboardShortcut({
		key: "e",
		onPress: handleEdit,
		enabled: !!activeProject && !!selectedRevision,
	});

	// Toggle stack view: show only ancestors from selected revision to trunk
	function handleToggleStackView() {
		if (!selectedRevision) return;
		if (stackViewChangeId) {
			// Turn off stack view
			setStackViewChangeId(null);
		} else {
			// Turn on stack view anchored to selected revision
			setStackViewChangeId(selectedRevision.change_id);
		}
	}

	useKeyboardShortcut({
		key: "s",
		onPress: handleToggleStackView,
		enabled: !!activeProject && !!selectedRevision,
	});

	const closestBookmark = (() => {
		const workingCopy = revisions.find((r) => r.is_working_copy);
		if (!workingCopy) return null;

		if (workingCopy.bookmarks.length > 0) {
			return workingCopy.bookmarks[0];
		}

		// BFS to find closest ancestor with bookmarks
		const byCommitId = new Map<string, Revision>();
		for (const rev of revisions) {
			byCommitId.set(rev.commit_id, rev);
		}

		const visited = new Set<string>();
		const queue = [...workingCopy.parent_ids];

		while (queue.length > 0) {
			const commitId = queue.shift();
			if (!commitId || visited.has(commitId)) continue;
			visited.add(commitId);

			const rev = byCommitId.get(commitId);
			if (!rev) continue;

			if (rev.bookmarks.length > 0) {
				return rev.bookmarks[0];
			}

			queue.push(...rev.parent_ids);
		}

		return null;
	})();

	return (
		<>
			<ProjectPicker
				repositories={repositories}
				onSelectRepository={handleSelectRepository}
			/>
			<CommandPalette
				onOpenRepo={handleOpenRepo}
				onOpenProjects={() => navigate({ to: "/repositories" })}
			/>
			<KeyboardShortcutsHelp />
			<AceJump
				revisions={orderedRevisions}
				onJump={(changeId) => {
					handleNavigateToChangeId(changeId);
					revisionGraphRef.current?.scrollToChangeId(changeId, { align: "center", smooth: true });
				}}
			/>
			<div className="flex flex-col h-screen overflow-hidden">
				<section className="flex-1 min-h-0 relative" aria-label="Revision list">
					<StackIndicator
						onDismiss={() => {
							// Clear selection - default logic will pick working copy
							handleNavigateToChangeId("");
						}}
					/>
					<RevisionGraph
						ref={revisionGraphRef}
						revisions={revisions}
						selectedRevision={selectedRevision}
						onSelectRevision={handleSelectRevision}
						isLoading={isLoading}
						flash={flash}
					/>
				</section>
				<StatusBar branch={closestBookmark} isConnected={!!activeProject} />
			</div>
		</>
	);
}
