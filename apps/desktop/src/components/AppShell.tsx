import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useState } from "react";
import { AceJump } from "@/components/AceJump";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { RevisionGraph, reorderForGraph } from "@/components/RevisionGraph";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import {
	editRevision,
	emptyRevisionsCollection,
	getRevisionsCollection,
	newRevision,
	projectsCollection,
} from "@/db";
import { useKeyboardNavigation, useKeyboardShortcut, useKeySequence } from "@/hooks/useKeyboard";
import {
	findProjectByPath,
	findRepository,
	type Project,
	type Revision,
	upsertProject,
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

	useKeyboardShortcut({
		key: ",",
		modifiers: { meta: true, ctrl: true },
		onPress: () => navigate({ to: "/settings" }),
	});

	const { data: projects = [] } = useLiveQuery(projectsCollection);

	const activeProject = projects.find((p) => p.id === projectId) ?? null;

	const revisionsCollection = activeProject
		? getRevisionsCollection(activeProject.path)
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

			const existingProject = yield* Effect.tryPromise({
				try: () => findProjectByPath(repoPath),
				catch: () => null,
			});

			const projectId = existingProject?.id ?? crypto.randomUUID();
			const name = repoPath.split("/").pop() ?? repoPath;

			const project: Project = {
				id: projectId,
				path: repoPath,
				name,
				last_opened_at: Date.now(),
			};

			yield* Effect.tryPromise({
				try: () => upsertProject(project),
				catch: (error) => new Error(`Failed to save project: ${error}`),
			});

			yield* Effect.sync(() => {
				projectsCollection.utils.writeUpsert([project]);
				navigate({ to: "/project/$projectId", params: { projectId } });
			});
		}).pipe(
			Effect.tapError((error) => Effect.logError("handleOpenRepo failed", error)),
			Effect.catchAll(() => Effect.void),
		);
		Effect.runPromise(program);
	}

	function handleSelectProject(project: Project) {
		navigate({ to: "/project/$projectId", params: { projectId: project.id } });
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
			<CommandPalette
				projects={projects}
				onSelectProject={handleSelectProject}
				onOpenRepo={handleOpenRepo}
			/>
			<KeyboardShortcutsHelp />
			<AceJump revisions={orderedRevisions} onJump={handleNavigateToChangeId} />
			<div className="flex flex-col h-screen overflow-hidden">
				<Toolbar repoPath={activeProject?.path ?? null} />
				<section className="flex-1 min-h-0" aria-label="Revision list">
					<RevisionGraph
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
