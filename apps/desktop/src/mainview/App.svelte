<script lang="ts">
	import { useLiveQuery } from "@tanstack/svelte-db";
	import { Effect } from "effect";
	import { onMount } from "svelte";
	import CommandPalette from "./components/CommandPalette.svelte";
	import DiffPanel from "./components/DiffPanel.svelte";
	import KeyboardShortcutsHelp from "./components/KeyboardShortcutsHelp.svelte";
	import OperationsLog from "./components/OperationsLog.svelte";
	import ProjectPicker from "./components/ProjectPicker.svelte";
	import RepositoriesPanel from "./components/RepositoriesPanel.svelte";
	import Search from "./components/Search.svelte";
	import SettingsPanel from "./components/SettingsPanel.svelte";
	import RevisionGraph from "./components/revision-graph/RevisionGraph.svelte";
	import {
		jjAbandon,
		jjDescribe,
		jjEdit,
		jjNew,
		jjRebase,
		jjSquash,
		type RevisionMutationOperation,
	} from "./data/mutations.ts";
	import { populateOperations } from "./data/operations.ts";
	import { populateRepositories, repositoriesCollection } from "./data/repositories.ts";
	import { populateRevisions, revisionsCollection } from "./data/revisions.ts";
	import { syncRepository } from "./data/sync.ts";
	import { FrontendRuntime } from "./runtime.ts";
	import { NativeClient } from "./services/NativeClient.ts";
	import { getSelectedRevisionId, setSelectedRevisionId } from "./state/url.svelte.ts";
	import { createKeyboardShortcut, createKeySequence, isEditableElement } from "./keyboard.svelte.ts";
	import type { Project } from "../../src-electrobun/shared/rpc.ts";

	let errorMessage = $state<string | null>(null);
	let projectMessage = $state<string | null>(null);
	let activeProjectId = $state<string | null>(null);
	let isProjectBusy = $state(false);
	let mutationInFlight = $state<RevisionMutationOperation | null>(null);
	let isSyncing = $state(false);
	let operationsLogOpen = $state(false);
	let searchOpen = $state(false);
	let commandPaletteOpen = $state(false);
	let shortcutsHelpOpen = $state(false);
	let settingsOpen = $state(false);
	let repositoriesOpen = $state(false);
	let pendingAbandon = $state<string | null>(null);
	let rebaseSourceChangeId = $state<string | null>(null);
	let sidebarWidth = $state(25);
	let layoutHydrated = $state(false);
	let revisionGraph: InstanceType<typeof RevisionGraph> | null = $state(null);
	let splitContainer = $state<HTMLDivElement | null>(null);
	let watchedRepoPath: string | null = null;
	let cleanupKeyboard: Array<() => void> = [];
	let layoutDebounce: ReturnType<typeof setTimeout> | null = null;
	let pendingLayoutUpdate: { selected_change_id?: string | null; sidebar_width?: number | null } = {};

	const revisionsQuery = useLiveQuery((query) =>
		query.from({ revisions: revisionsCollection }).select(({ revisions }) => revisions),
	);
	const { data: revisions, isLoading } = $derived(revisionsQuery);

	const repositoriesQuery = useLiveQuery((query) =>
		query.from({ repositories: repositoriesCollection }).select(({ repositories }) => repositories),
	);
	const { data: projects } = $derived(repositoriesQuery);
	const activeProject = $derived(projects.find((project) => project.id === activeProjectId) ?? null);
	const selectedRevisionId = $derived(getSelectedRevisionId());
	const selectedRevision = $derived((revisions ?? []).find((revision) => revision.change_id === selectedRevisionId) ?? null);
	const anyModalOpen = $derived(searchOpen || commandPaletteOpen || shortcutsHelpOpen || settingsOpen || repositoriesOpen || operationsLogOpen);

	async function refreshProjects(): Promise<Project[]> {
		const loadedProjects = await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				return yield* nativeClient.getProjects();
			}),
		);
		await populateRepositories(loadedProjects);
		return loadedProjects;
	}

	async function loadRevisionsForProject(project: Project | null): Promise<void> {
		if (project == null) {
			await populateRevisions([]);
			await populateOperations([]);
			return;
		}

		await populateOperations([]);
		const [loadedRevisions, loadedOperations] = await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				const loadedRevisions = yield* nativeClient.getRevisions({ repoPath: project.path, limit: 50 });
				const loadedOperations = yield* nativeClient.getOperations({ repoPath: project.path, limit: 50 });
				return [loadedRevisions, loadedOperations] as const;
			}),
		);
		await populateRevisions(loadedRevisions);
		await populateOperations(loadedOperations);
	}

	async function watchProject(project: Project | null): Promise<void> {
		const nextRepoPath = project?.path ?? null;
		if (watchedRepoPath === nextRepoPath) return;

		const previousRepoPath = watchedRepoPath;
		watchedRepoPath = nextRepoPath;

		await FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				if (previousRepoPath != null) {
					yield* nativeClient.unwatchRepository(previousRepoPath);
				}
				if (nextRepoPath != null) {
					yield* nativeClient.watchRepository(nextRepoPath);
				}
			}),
		);
	}

	async function refreshActiveRepository(reason: string): Promise<void> {
		if (activeProject == null) return;
		try {
			await loadRevisionsForProject(activeProject);
		} catch (error) {
			errorMessage = `Failed to refresh repository after ${reason}: ${formatError(error)}`;
			console.error("Failed to refresh repository", error);
		}
	}

	async function selectProject(project: Project): Promise<void> {
		isProjectBusy = true;
		errorMessage = null;
		projectMessage = null;
		pendingAbandon = null;
		rebaseSourceChangeId = null;
		try {
			await FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					return yield* nativeClient.updateLayout({ active_project_id: project.id });
				}),
			);
			activeProjectId = project.id;
			await watchProject(project);
			await loadRevisionsForProject(project);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Failed to select repository", error);
		} finally {
			isProjectBusy = false;
		}
	}

	async function addRepository(): Promise<void> {
		isProjectBusy = true;
		errorMessage = null;
		projectMessage = null;
		try {
			const project = await FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					const repoPath = yield* nativeClient.openRepositoryDialog();
					if (repoPath == null) return null;
					return yield* nativeClient.upsertProject({ path: repoPath });
				}),
			);

			if (project == null) {
				projectMessage = "No jj repository selected.";
				return;
			}

			await refreshProjects();
			await selectProject(project);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Failed to add repository", error);
		} finally {
			isProjectBusy = false;
		}
	}

	function formatError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function clampSidebarWidth(width: number): number {
		return Math.max(15, Math.min(70, width));
	}

	function persistLayout(update: { selected_change_id?: string | null; sidebar_width?: number | null }): void {
		if (!layoutHydrated) return;
		pendingLayoutUpdate = { ...pendingLayoutUpdate, ...update };
		if (layoutDebounce != null) clearTimeout(layoutDebounce);
		layoutDebounce = setTimeout(() => {
			const updateToPersist = pendingLayoutUpdate;
			pendingLayoutUpdate = {};
			void FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					return yield* nativeClient.updateLayout(updateToPersist);
				}),
			).catch((error) => console.warn("Failed to persist layout", error));
		}, 250);
	}

	function persistSelectedRevision(revisionId: string | null): void {
		persistLayout({ selected_change_id: revisionId });
	}

	function onGraphSelect(): void {
		persistSelectedRevision(getSelectedRevisionId());
	}

	function jumpToRevision(changeId: string): void {
		setSelectedRevisionId(changeId);
		revisionGraph?.jumpTo(changeId);
		persistSelectedRevision(changeId);
		revisionGraph?.focus();
	}

	function copyText(text: string): void {
		if (navigator.clipboard?.writeText) {
			void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
		} else {
			fallbackCopy(text);
		}
		projectMessage = "Copied to clipboard.";
	}

	function fallbackCopy(text: string): void {
		const textarea = document.createElement("textarea");
		textarea.value = text;
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand("copy");
		textarea.remove();
	}

	async function runRevisionMutation(
		operation: RevisionMutationOperation,
		action: (repoPath: string) => Promise<unknown>,
	): Promise<void> {
		if (activeProject == null || mutationInFlight != null) return;
		mutationInFlight = operation;
		errorMessage = null;
		try {
			await action(activeProject.path);
		} catch (error) {
			errorMessage = `${operation} failed: ${formatError(error)}`;
			console.error(`${operation} failed`, error);
		} finally {
			mutationInFlight = null;
		}
	}

	async function describeRevision(changeId: string, currentDescription: string): Promise<void> {
		const description = window.prompt("Describe revision", currentDescription);
		if (description == null) return;
		await runRevisionMutation("jjDescribe", (repoPath) => jjDescribe({ repoPath, changeId, description }));
	}

	async function newRevision(parentChangeIds: string[]): Promise<void> {
		await runRevisionMutation("jjNew", (repoPath) => jjNew({ repoPath, parentChangeIds }));
	}

	async function editRevision(changeId: string): Promise<void> {
		await runRevisionMutation("jjEdit", (repoPath) => jjEdit(repoPath, changeId));
	}

	async function abandonRevision(changeId: string): Promise<void> {
		pendingAbandon = changeId;
	}

	async function confirmAbandonRevision(): Promise<void> {
		const changeId = pendingAbandon;
		if (changeId == null) return;
		pendingAbandon = null;
		await runRevisionMutation("jjAbandon", (repoPath) => jjAbandon(repoPath, changeId));
	}

	function cancelAbandonRevision(): void {
		pendingAbandon = null;
	}

	async function squashRevision(changeId: string): Promise<void> {
		if (!window.confirm("Squash this revision into its parent?")) return;
		await runRevisionMutation("jjSquash", (repoPath) => jjSquash(repoPath, changeId));
	}

	async function runSync(): Promise<void> {
		if (activeProject == null || isSyncing) return;
		isSyncing = true;
		errorMessage = null;
		projectMessage = null;
		try {
			const result = await syncRepository(activeProject.path);
			projectMessage = result.pushedBookmarks.length > 0
				? `Fetched and pushed ${result.pushedBookmarks.join(", ")}.`
				: "Fetched latest remote changes.";
		} catch (error) {
			errorMessage = `Sync failed: ${formatError(error)}`;
			console.error("Sync failed", error);
		} finally {
			isSyncing = false;
		}
	}

	async function rebaseRevision(sourceChangeId: string): Promise<void> {
		rebaseSourceChangeId = rebaseSourceChangeId === sourceChangeId ? null : sourceChangeId;
	}

	async function confirmRebaseRevision(): Promise<void> {
		if (rebaseSourceChangeId == null || selectedRevision == null) return;
		const sourceChangeId = rebaseSourceChangeId;
		const destinationChangeId = selectedRevision.change_id;
		if (sourceChangeId === destinationChangeId) return;
		rebaseSourceChangeId = null;
		await runRevisionMutation("jjRebase", (repoPath) => jjRebase({
			repoPath,
			sourceChangeId,
			destinationChangeId,
		}));
	}

	function cancelRebaseRevision(): void {
		rebaseSourceChangeId = null;
	}

	function shortcutsEnabled(): boolean {
		return activeProject != null && !anyModalOpen && pendingAbandon == null && rebaseSourceChangeId == null && !isEditableElement();
	}

	function selectedAction(action: "new" | "edit" | "describe" | "squash" | "abandon" | "rebase"): void {
		if (!shortcutsEnabled() || selectedRevision == null || mutationInFlight != null) return;
		if (action === "new") void newRevision([selectedRevision.change_id]);
		else if (action === "edit" && !selectedRevision.is_immutable) void editRevision(selectedRevision.change_id);
		else if (action === "describe") void describeRevision(selectedRevision.change_id, selectedRevision.description);
		else if (action === "squash" && !selectedRevision.is_immutable && !selectedRevision.is_working_copy) void squashRevision(selectedRevision.change_id);
		else if (action === "abandon" && !selectedRevision.is_immutable && !selectedRevision.is_working_copy) void abandonRevision(selectedRevision.change_id);
		else if (action === "rebase" && !selectedRevision.is_immutable && !selectedRevision.is_working_copy) void rebaseRevision(selectedRevision.change_id);
	}

	function copySelectedChangeId(): void {
		if (!shortcutsEnabled() || selectedRevision == null) return;
		copyText(selectedRevision.change_id);
	}

	function copySelectedDeepLink(): void {
		if (!shortcutsEnabled() || selectedRevision == null || activeProject == null) return;
		copyText(`tatami://project/${activeProject.id}/revision/${selectedRevision.change_id}`);
	}

	function startResize(event: PointerEvent): void {
		if (splitContainer == null) return;
		event.preventDefault();
		const rect = splitContainer.getBoundingClientRect();
		function onPointerMove(moveEvent: PointerEvent): void {
			const nextWidth = clampSidebarWidth(((moveEvent.clientX - rect.left) / rect.width) * 100);
			sidebarWidth = nextWidth;
			persistLayout({ sidebar_width: nextWidth });
		}
		function onPointerUp(): void {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
		}
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
	}

	async function removeProject(project: Project): Promise<void> {
		isProjectBusy = true;
		errorMessage = null;
		projectMessage = null;
		try {
			await FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					return yield* nativeClient.removeProject(project.id);
				}),
			);
			const nextProjects = (await refreshProjects()).filter((nextProject) => nextProject.id !== project.id);
			const nextActiveProject = nextProjects[0] ?? null;
			activeProjectId = nextActiveProject?.id ?? null;
			pendingAbandon = null;
			rebaseSourceChangeId = null;
			await watchProject(nextActiveProject);
			await FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					return yield* nativeClient.updateLayout({ active_project_id: nextActiveProject?.id ?? null });
				}),
			);
			await loadRevisionsForProject(nextActiveProject);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			console.error("Failed to remove repository", error);
		} finally {
			isProjectBusy = false;
		}
	}

	onMount(() => {
		function handleRepoChanged(event: Event): void {
			const { repoPath } = (event as CustomEvent<{ repoPath: string; timestamp: number }>).detail;
			if (activeProject?.path !== repoPath) return;
			void refreshActiveRepository("external change");
		}

		function handleOpenRepositoryRequested(): void {
			void addRepository();
		}

		function handleDeepLink(event: Event): void {
			const { url } = (event as CustomEvent<{ url: string }>).detail;
			projectMessage = `Received deep link: ${url}`;
		}

		window.addEventListener("tatami:repo-changed", handleRepoChanged);
		window.addEventListener("tatami:open-repository-requested", handleOpenRepositoryRequested);
		window.addEventListener("tatami:deep-link", handleDeepLink);

		cleanupKeyboard = [
			createKeyboardShortcut("/", {}, () => searchOpen = true, { enabled: () => !anyModalOpen && pendingAbandon == null && rebaseSourceChangeId == null }),
			createKeyboardShortcut("k", { meta: true, ctrl: true }, () => commandPaletteOpen = !commandPaletteOpen, { enabled: () => !searchOpen && pendingAbandon == null && rebaseSourceChangeId == null }),
			createKeyboardShortcut("?", {}, () => shortcutsHelpOpen = !shortcutsHelpOpen, { enabled: () => !anyModalOpen && pendingAbandon == null && rebaseSourceChangeId == null }),
			createKeyboardShortcut(",", { meta: true, ctrl: true }, () => settingsOpen = true, { enabled: () => !anyModalOpen && pendingAbandon == null && rebaseSourceChangeId == null }),
			createKeyboardShortcut("n", {}, () => selectedAction("new"), { enabled: shortcutsEnabled }),
			createKeyboardShortcut("e", {}, () => selectedAction("edit"), { enabled: shortcutsEnabled }),
			createKeyboardShortcut("d", {}, () => selectedAction("describe"), { enabled: shortcutsEnabled }),
			createKeyboardShortcut("s", {}, () => selectedAction("squash"), { enabled: shortcutsEnabled }),
			createKeyboardShortcut("a", {}, () => selectedAction("abandon"), { enabled: shortcutsEnabled }),
			createKeyboardShortcut("r", {}, () => selectedAction("rebase"), { enabled: shortcutsEnabled }),
			createKeyboardShortcut("r", {}, cancelRebaseRevision, { enabled: () => rebaseSourceChangeId != null && !anyModalOpen }),
			createKeyboardShortcut("Enter", {}, () => void confirmRebaseRevision(), { enabled: () => rebaseSourceChangeId != null && !anyModalOpen && mutationInFlight == null }),
			createKeyboardShortcut("y", {}, () => void confirmAbandonRevision(), { enabled: () => pendingAbandon != null && !anyModalOpen && mutationInFlight == null }),
			createKeyboardShortcut("n", {}, cancelAbandonRevision, { enabled: () => pendingAbandon != null && !anyModalOpen }),
			createKeyboardShortcut("Escape", {}, () => {
				if (pendingAbandon != null) cancelAbandonRevision();
				if (rebaseSourceChangeId != null) cancelRebaseRevision();
			}, { enabled: () => pendingAbandon != null || rebaseSourceChangeId != null }),
			createKeyboardShortcut("Escape", {}, () => {
				searchOpen = false;
				commandPaletteOpen = false;
				shortcutsHelpOpen = false;
				settingsOpen = false;
				repositoriesOpen = false;
			}, { enabled: () => anyModalOpen }),
			createKeySequence(["y", "y"], copySelectedChangeId, { enabled: shortcutsEnabled }),
			createKeySequence(["y", "Y"], copySelectedDeepLink, { enabled: shortcutsEnabled }),
		];

		async function loadInitialState(): Promise<void> {
			isProjectBusy = true;
			try {
				const [loadedProjects, layout] = await FrontendRuntime.runPromise(
					Effect.gen(function* () {
						const nativeClient = yield* NativeClient;
						const loadedProjects = yield* nativeClient.getProjects();
						const layout = yield* nativeClient.getLayout();
						return [loadedProjects, layout] as const;
					}),
				);
				await populateRepositories(loadedProjects);
				if (layout.sidebar_width != null) sidebarWidth = clampSidebarWidth(layout.sidebar_width);
				setSelectedRevisionId(layout.selected_change_id);
				layoutHydrated = true;
				const project =
					loadedProjects.find((candidate) => candidate.id === layout.active_project_id) ??
					loadedProjects[0] ??
					null;
				activeProjectId = project?.id ?? null;
				if (project != null && project.id !== layout.active_project_id) {
					await FrontendRuntime.runPromise(
						Effect.gen(function* () {
							const nativeClient = yield* NativeClient;
							return yield* nativeClient.updateLayout({ active_project_id: project.id });
						}),
					);
				}
				await watchProject(project);
				await loadRevisionsForProject(project);
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : String(error);
				console.error("Failed to load project state", error);
			} finally {
				isProjectBusy = false;
			}
		}

		void loadInitialState();

		return () => {
			window.removeEventListener("tatami:repo-changed", handleRepoChanged);
			window.removeEventListener("tatami:open-repository-requested", handleOpenRepositoryRequested);
			window.removeEventListener("tatami:deep-link", handleDeepLink);
			for (const cleanup of cleanupKeyboard) cleanup();
			cleanupKeyboard = [];
			if (layoutDebounce != null) clearTimeout(layoutDebounce);
			pendingLayoutUpdate = {};
			if (watchedRepoPath != null) {
				const repoPath = watchedRepoPath;
				watchedRepoPath = null;
				void FrontendRuntime.runPromise(
					Effect.gen(function* () {
						const nativeClient = yield* NativeClient;
						return yield* nativeClient.unwatchRepository(repoPath);
					}),
				);
			}
		};
	});
</script>

<main class="shell">
	<div class="workspace" bind:this={splitContainer} style:grid-template-columns={activeProject ? `${sidebarWidth}% 6px minmax(0, 1fr)` : "1fr"}>
		<section class="revisions-pane" aria-label="Revision list">
			<div class="toolbar">
				<ProjectPicker
					projectName={activeProject?.name ?? null}
					busy={isProjectBusy}
					onOpen={() => repositoriesOpen = true}
				/>
				<button
					type="button"
					class="icon-button"
					aria-label="Search revisions"
					title="Search revisions (/)"
					disabled={!activeProject}
					onclick={() => searchOpen = true}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="11" cy="11" r="8" />
						<path d="m21 21-4.3-4.3" />
					</svg>
				</button>
				<button
					type="button"
					class="icon-button"
					aria-label="Sync repository"
					title="Sync repository"
					disabled={!activeProject || isSyncing}
					onclick={() => void runSync()}
				>
					<svg class:spinning={isSyncing} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
						<path d="M21 3v5h-5" />
						<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
						<path d="M8 16H3v5" />
					</svg>
				</button>
			</div>

			{#if errorMessage}
				<p class="error-bar" role="alert">{errorMessage}</p>
			{/if}

			<div class="graph-area">
				{#if !activeProject}
					{#if isProjectBusy}
						<p class="muted-center">Loading…</p>
					{:else}
						<div class="empty-wrap">
						<div class="empty-card">
							<div class="empty-card-header">
								<h2>Welcome to Tatami</h2>
								<p>A desktop client for Jujutsu version control</p>
							</div>
							<div class="empty-card-body">
								<div class="empty-row">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
									</svg>
									<span>Open a repository to get started</span>
									<button type="button" class="empty-button" disabled={isProjectBusy} onclick={() => void addRepository()}>Add Repository</button>
								</div>
								<div class="empty-row">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="m3 16 4 4 4-4" />
										<path d="M7 20V4" />
										<path d="m21 8-4-4-4 4" />
										<path d="M17 4v16" />
									</svg>
									<span>Navigate revisions with j/k keys</span>
								</div>
								<button type="button" class="empty-row empty-row-button" onclick={() => shortcutsHelpOpen = true}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
									</svg>
									<span>Press ? to view all keyboard shortcuts</span>
								</button>
							</div>
						</div>
						</div>
					{/if}
				{:else if isLoading}
					<p class="muted-center">Loading revisions…</p>
				{:else}
					<RevisionGraph
						bind:this={revisionGraph}
						{revisions}
						mutationsDisabled={mutationInFlight != null}
						pendingAbandonChangeId={pendingAbandon}
						onselect={onGraphSelect}
						onnew={newRevision}
						onedit={editRevision}
						onabandon={abandonRevision}
						ondescribe={describeRevision}
						onsquash={squashRevision}
						onrebase={rebaseRevision}
					/>
				{/if}
			</div>
		</section>

		{#if activeProject}
			<div
				class="resize-handle"
				role="separator"
				aria-orientation="vertical"
				tabindex="0"
				onpointerdown={startResize}
			></div>

			<aside class="diff-pane" aria-label="Diff viewer">
				<DiffPanel {activeProject} revisions={revisions ?? []} onReturnFocus={() => revisionGraph?.focus()} />
			</aside>
		{/if}
	</div>

	<OperationsLog
		repoPath={activeProject?.path ?? null}
		open={operationsLogOpen}
		onClose={() => operationsLogOpen = false}
		onError={(message) => errorMessage = message}
		onMessage={(message) => projectMessage = message}
	/>

	<Search open={searchOpen} revisions={revisions ?? []} repoPath={activeProject?.path ?? null} onClose={() => searchOpen = false} onJump={jumpToRevision} />
	<CommandPalette
		open={commandPaletteOpen}
		canOpenOperationsLog={activeProject != null}
		onClose={() => commandPaletteOpen = false}
		onOpenRepo={addRepository}
		onOpenRepositories={() => repositoriesOpen = true}
		onOpenSettings={() => settingsOpen = true}
		onOpenOperationsLog={() => operationsLogOpen = true}
		onOpenShortcuts={() => shortcutsHelpOpen = true}
	/>
	<KeyboardShortcutsHelp open={shortcutsHelpOpen} onClose={() => shortcutsHelpOpen = false} />
	<SettingsPanel open={settingsOpen} onClose={() => settingsOpen = false} />
	<RepositoriesPanel
		open={repositoriesOpen}
		{projects}
		{activeProjectId}
		busy={isProjectBusy}
		onClose={() => repositoriesOpen = false}
		onSelect={selectProject}
		onRemove={removeProject}
		onAdd={addRepository}
	/>

</main>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
		background: var(--background);
		color: var(--foreground);
	}

	.workspace {
		flex: 1;
		min-height: 0;
		display: grid;
		gap: 0;
		align-items: stretch;
	}

	.revisions-pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		outline: none;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px;
		flex-shrink: 0;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 28px;
		width: 28px;
		border: 0;
		border-radius: calc(var(--radius) - 2px);
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		transition: background 120ms ease, color 120ms ease;
	}

	.icon-button:hover:not(:disabled),
	.icon-button:focus-visible {
		background: color-mix(in oklab, var(--accent) 14%, transparent);
		color: var(--foreground);
		outline: none;
	}

	.icon-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinning {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0 8px 8px;
		padding: 8px 10px;
		border: 1px solid color-mix(in oklab, var(--destructive) 50%, transparent);
		border-radius: calc(var(--radius) - 2px);
		background: color-mix(in oklab, var(--destructive) 12%, transparent);
		color: var(--destructive-foreground);
		font-size: 0.85rem;
	}

	.graph-area {
		flex: 1;
		min-height: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.muted-center {
		margin: 0;
		padding: 24px;
		color: var(--muted-foreground);
		text-align: center;
	}

	.empty-wrap {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.empty-card {
		width: min(28rem, calc(100% - 32px));
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 24px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--card-foreground);
		box-shadow: var(--shadow-sm);
	}

	.empty-card-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
		text-align: center;
	}

	.empty-card-header h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.empty-card-header p {
		margin: 0;
		color: var(--muted-foreground);
		font-size: 0.85rem;
	}

	.empty-card-body {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.empty-row {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.78rem;
		color: var(--foreground);
	}

	.empty-row svg {
		flex-shrink: 0;
		color: var(--muted-foreground);
	}

	.empty-row span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty-button {
		margin-left: auto;
		height: 24px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 4px);
		background: var(--card);
		color: var(--card-foreground);
		font-size: 0.75rem;
		cursor: pointer;
	}

	.empty-button:hover:not(:disabled) {
		background: var(--muted);
	}

	.empty-button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.empty-row-button {
		margin: 0 -8px;
		padding: 4px 8px;
		border: 0;
		border-radius: calc(var(--radius) - 4px);
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 120ms ease;
	}

	.empty-row-button:hover {
		background: color-mix(in oklab, var(--muted) 60%, transparent);
	}

	.resize-handle {
		align-self: stretch;
		cursor: col-resize;
		background: var(--border);
		transition: background 120ms ease;
	}

	.resize-handle:hover,
	.resize-handle:focus-visible {
		background: color-mix(in oklab, var(--ring) 50%, var(--border));
		outline: none;
	}

	.diff-pane {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
