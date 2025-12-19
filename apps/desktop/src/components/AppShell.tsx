import { useAtom } from "@effect-atom/atom-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo } from "react";
import { activeProjectIdAtom, selectedChangeIdAtom } from "@/atoms";
import { AppSidebar } from "@/components/AppSidebar";
import { RevisionGraph } from "@/components/RevisionGraph";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import {
	findProjectByPath,
	findRepository,
	getProjects,
	getRevisions,
	type Project,
	type Revision,
	unwatchRepository,
	upsertProject,
	watchRepository,
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
	const queryClient = useQueryClient();
	const [activeProjectId, setActiveProjectId] = useAtom(activeProjectIdAtom);
	const [selectedChangeId, setSelectedChangeId] = useAtom(selectedChangeIdAtom);

	const { data: projects = [] } = useQuery({
		queryKey: ["projects"],
		queryFn: getProjects,
	});

	const activeProject = useMemo(
		() => projects.find((p) => p.id === activeProjectId) ?? null,
		[projects, activeProjectId],
	);

	const { data: revisions = [], isLoading } = useQuery({
		queryKey: ["revisions", activeProject?.path],
		queryFn: () => (activeProject ? getRevisions(activeProject.path, 100) : []),
		enabled: !!activeProject,
	});

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
				queryClient.invalidateQueries({ queryKey: ["projects"] });
				setActiveProjectId(projectId);
				setSelectedChangeId(null);
			});
		}).pipe(
			Effect.tapError((error) => Effect.logError("handleOpenRepo failed", error)),
			Effect.catchAll(() => Effect.void),
		);
		Effect.runPromise(program);
	}, [queryClient, setActiveProjectId, setSelectedChangeId]);

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

	useEffect(() => {
		if (!activeProject) return;

		let unlisten: (() => void) | undefined;

		const setupWatcher = async () => {
			try {
				await watchRepository(activeProject.path);

				unlisten = await listen<string>("repo-changed", (event) => {
					if (event.payload === activeProject.path) {
						queryClient.invalidateQueries({ queryKey: ["revisions", activeProject.path] });
					}
				});
			} catch (error) {
				console.error("Failed to set up repository watcher:", error);
			}
		};

		setupWatcher();

		return () => {
			if (unlisten) {
				unlisten();
			}
			if (activeProject) {
				unwatchRepository(activeProject.path).catch((error) => {
					console.error("Failed to unwatch repository:", error);
				});
			}
		};
	}, [activeProject, queryClient]);

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
		<SidebarProvider>
			<AppSidebar
				projects={projects}
				activeProject={activeProject}
				onSelectProject={handleSelectProject}
				onOpenRepo={handleOpenRepo}
				onOpenSettings={() => {}}
			/>
			<SidebarInset className="flex flex-col h-screen overflow-hidden">
				<Toolbar repoPath={activeProject?.path ?? null} />
				<div className="flex-1 min-h-0">
					<RevisionGraph
						revisions={revisions}
						selectedRevision={selectedRevision}
						onSelectRevision={handleSelectRevision}
						isLoading={isLoading}
					/>
				</div>
				<StatusBar branch={closestBookmark} isConnected={!!activeProject} />
			</SidebarInset>
		</SidebarProvider>
	);
}
