import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate } from "@tanstack/react-router";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useCallback, useMemo } from "react";
import { activeProjectIdAtom, selectedChangeIdAtom } from "@/atoms";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { reorderForGraph, RevisionGraph } from "@/components/RevisionGraph";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { emptyRevisionsCollection, getRevisionsCollection, projectsCollection } from "@/db";
import { useKeyboardNavigation, useKeyboardShortcut } from "@/hooks/useKeyboard";
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
	const [activeProjectId, setActiveProjectId] = useAtom(activeProjectIdAtom);
	const [selectedChangeId, setSelectedChangeId] = useAtom(selectedChangeIdAtom);

	useKeyboardShortcut({
		key: ",",
		modifiers: { meta: true, ctrl: true },
		onPress: () => navigate({ to: "/settings" }),
	});

	const { data: projects = [] } = useLiveQuery(projectsCollection);

	const activeProject = useMemo(
		() => projects.find((p) => p.id === activeProjectId) ?? null,
		[projects, activeProjectId],
	);

	const revisionsCollection = useMemo(
		() => (activeProject ? getRevisionsCollection(activeProject.path) : emptyRevisionsCollection),
		[activeProject],
	);

	const { data: revisions = [], isLoading = false } = useLiveQuery(revisionsCollection);

	const orderedRevisions = useMemo(() => reorderForGraph(revisions), [revisions]);

	const selectedRevision = useMemo(() => {
		if (revisions.length === 0) return null;
		if (selectedChangeId) {
			const found = revisions.find((r) => r.change_id === selectedChangeId);
			if (found) return found;
		}
		return revisions.find((r) => r.is_working_copy) || revisions[0];
	}, [revisions, selectedChangeId]);

	const handleOpenRepo = useCallback(() => {
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
				setActiveProjectId(projectId);
				setSelectedChangeId(null);
			});
		}).pipe(
			Effect.tapError((error) => Effect.logError("handleOpenRepo failed", error)),
			Effect.catchAll(() => Effect.void),
		);
		Effect.runPromise(program);
	}, [setActiveProjectId, setSelectedChangeId]);

	const handleSelectProject = useCallback(
		(project: Project) => {
			setActiveProjectId(project.id);
			setSelectedChangeId(null);
		},
		[setActiveProjectId, setSelectedChangeId],
	);

	const handleSelectRevision = useCallback(
		(revision: Revision) => {
			setSelectedChangeId(revision.change_id);
		},
		[setSelectedChangeId],
	);

	const handleNavigateToChangeId = useCallback(
		(changeId: string) => {
			setSelectedChangeId(changeId || null);
		},
		[setSelectedChangeId],
	);

	useKeyboardNavigation({
		orderedRevisions,
		selectedChangeId,
		onNavigate: handleNavigateToChangeId,
	});

	const closestBookmark = useMemo(() => {
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
			const commitId = queue.shift()!;
			if (visited.has(commitId)) continue;
			visited.add(commitId);

			const rev = byCommitId.get(commitId);
			if (!rev) continue;

			if (rev.bookmarks.length > 0) {
				return rev.bookmarks[0];
			}

			queue.push(...rev.parent_ids);
		}

		return null;
	}, [revisions]);

	return (
		<>
			<CommandPalette
				projects={projects}
				onSelectProject={handleSelectProject}
				onOpenRepo={handleOpenRepo}
			/>
			<KeyboardShortcutsHelp />
			<div className="flex flex-col h-screen overflow-hidden">
				<Toolbar repoPath={activeProject?.path ?? null} />
				<section className="flex-1 min-h-0" aria-label="Revision list">
					<RevisionGraph
						revisions={revisions}
						selectedRevision={selectedRevision}
						onSelectRevision={handleSelectRevision}
						isLoading={isLoading}
					/>
				</section>
				<StatusBar branch={closestBookmark} isConnected={!!activeProject} />
			</div>
		</>
	);
}
