import { useQuery, useQueryClient } from "@tanstack/react-query";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useCallback, useMemo } from "react";
import { DetailPanel } from "@/components/DetailPanel";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
	findProjectByPath,
	findRepository,
	getLayout,
	getProjects,
	getRevisions,
	updateLayout,
	upsertProject,
	type Project,
	type Revision,
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

	const { data: layout } = useQuery({
		queryKey: ["layout"],
		queryFn: getLayout,
	});

	const { data: projects = [] } = useQuery({
		queryKey: ["projects"],
		queryFn: getProjects,
	});

	const activeProject = useMemo(
		() => projects.find((p) => p.id === layout?.active_project_id) ?? null,
		[projects, layout?.active_project_id],
	);

	const { data: revisions = [], isLoading } = useQuery({
		queryKey: ["revisions", activeProject?.path],
		queryFn: () => (activeProject ? getRevisions(activeProject.path, 100) : []),
		enabled: !!activeProject,
	});

	const selectedRevision = useMemo(() => {
		if (revisions.length === 0) return null;
		if (layout?.selected_change_id) {
			const found = revisions.find((r) => r.change_id === layout.selected_change_id);
			if (found) return found;
		}
		return revisions.find((r) => r.is_working_copy) || revisions[0];
	}, [revisions, layout?.selected_change_id]);

	const handleRefresh = useCallback(() => {
		if (activeProject) {
			queryClient.invalidateQueries({ queryKey: ["revisions", activeProject.path] });
		}
	}, [activeProject, queryClient]);

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

			yield* Effect.tryPromise({
				try: () => updateLayout({ active_project_id: projectId, selected_change_id: null }),
				catch: (error) => new Error(`Failed to update layout: ${error}`),
			});

			yield* Effect.sync(() => {
				queryClient.invalidateQueries({ queryKey: ["projects"] });
				queryClient.invalidateQueries({ queryKey: ["layout"] });
			});
		}).pipe(Effect.catchAll(() => Effect.void));

		Effect.runPromise(program);
	}, [queryClient]);

	const handleSelectRevision = useCallback(
		(revision: Revision) => {
			Effect.runPromise(
				Effect.tryPromise({
					try: async () => {
						await updateLayout({ selected_change_id: revision.change_id });
						queryClient.invalidateQueries({ queryKey: ["layout"] });
					},
					catch: () => new Error("Failed to update layout"),
				}).pipe(Effect.catchAll(() => Effect.void)),
			);
		},
		[queryClient],
	);

	const currentBranch = revisions.find((r) => r.is_working_copy)?.bookmarks[0] ?? null;

	return (
		<div className="flex flex-col h-screen w-screen overflow-hidden">
			<Toolbar
				repoPath={activeProject?.path ?? null}
				isLoading={isLoading}
				onRefresh={handleRefresh}
				onOpenRepo={handleOpenRepo}
				onOpenSettings={() => {}}
			/>

			<ResizablePanelGroup orientation="horizontal" className="flex-1">
				<ResizablePanel id="sidebar" defaultSize="25%">
					<Sidebar
						revisions={revisions}
						selectedRevision={selectedRevision}
						onSelectRevision={handleSelectRevision}
						isLoading={isLoading}
					/>
				</ResizablePanel>

				<ResizableHandle withHandle />

				<ResizablePanel id="detail" defaultSize="75%">
					<DetailPanel />
				</ResizablePanel>
			</ResizablePanelGroup>

			<StatusBar branch={currentBranch} lastRefresh={null} isConnected={!!activeProject} />
		</div>
	);
}
