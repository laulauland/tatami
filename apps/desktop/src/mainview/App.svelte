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

	let clickCount = $state(0);
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
	<header class="titlebar">
		<div>
			<p class="eyebrow">Electrobun + Svelte 5</p>
			<h1>Tatami</h1>
		</div>
		<ProjectPicker
			{projects}
			{activeProjectId}
			busy={isProjectBusy}
			onAdd={addRepository}
			onSelect={selectProject}
			onRemove={removeProject}
		/>
	</header>

	<section class="hero" aria-labelledby="welcome-title">
		<div>
			<h2 id="welcome-title">A new desktop shell is opening.</h2>
			<p>
				This minimal Svelte view lives beside the existing React/Tauri app while the rewrite is
				validated slice by slice.
			</p>
		</div>

		<div class="rune-card">
			<p>Svelte rune interaction</p>
			<strong>{clickCount}</strong>
			<div class="actions">
				<button type="button" onclick={() => clickCount += 1}>Increment</button>
				<button type="button" class="secondary" onclick={() => clickCount = 0}>Reset</button>
			</div>
		</div>
	</section>

	<div class="workspace-split" bind:this={splitContainer} style:grid-template-columns={`${sidebarWidth}% 10px minmax(0, 1fr)`}>
		<section class="rpc-panel" aria-labelledby="rpc-title">
			<div class="panel-heading">
				<div>
					<p class="eyebrow">Electrobun RPC native smoke test</p>
					<h2 id="rpc-title">Real jj revisions</h2>
				</div>
				<div class="toolbar-actions">
					<button type="button" class="secondary" onclick={() => searchOpen = true} disabled={!activeProject}>Search</button>
					<button type="button" class="secondary" onclick={() => operationsLogOpen = true} disabled={!activeProject}>Operations</button>
					<button type="button" onclick={() => void runSync()} disabled={!activeProject || isSyncing}>
						{isSyncing ? "Syncing…" : "Sync"}
					</button>
					<span class="status">{activeProject ? activeProject.name : "no repository"}</span>
				</div>
			</div>

			{#if errorMessage}
				<p class="error">RPC failed: {errorMessage}</p>
			{:else if projectMessage && !activeProject}
				<p class="muted">{projectMessage}</p>
			{:else if !activeProject}
				<div class="empty-state">
					<h3>Add a repository to begin</h3>
					<p class="muted">Pick a folder containing a jj repository. The active repository will persist across restarts.</p>
					<button type="button" onclick={() => void addRepository()} disabled={isProjectBusy}>Add repository</button>
				</div>
			{:else if isProjectBusy || isLoading}
				<p class="muted">Loading jj revisions through typed webview-to-Bun RPC…</p>
			{:else}
				{#if projectMessage}
					<p class="muted status-line">{projectMessage}</p>
				{/if}
				{#if mutationInFlight}
					<p class="muted status-line">Running {mutationInFlight}…</p>
				{/if}
				{#if pendingAbandon}
					<div class="keyboard-confirmation" role="alert">
						<span>Abandon selected revision?</span>
						<button type="button" onclick={() => void confirmAbandonRevision()} disabled={mutationInFlight != null}>Yes <kbd>y</kbd></button>
						<button type="button" class="secondary" onclick={cancelAbandonRevision}>No <kbd>n</kbd></button>
					</div>
				{/if}
				{#if rebaseSourceChangeId}
					<div class="keyboard-confirmation" role="status">
						<span>Select destination, then press <kbd>Enter</kbd> to rebase. <kbd>Esc</kbd>/<kbd>r</kbd> cancels.</span>
						<button type="button" onclick={() => void confirmRebaseRevision()} disabled={mutationInFlight != null || selectedRevision == null || selectedRevision.change_id === rebaseSourceChangeId}>Rebase here</button>
						<button type="button" class="secondary" onclick={cancelRebaseRevision}>Cancel</button>
					</div>
				{/if}
				{#if isSyncing}
					<p class="muted status-line">Sync in progress…</p>
				{/if}
				<RevisionGraph
					bind:this={revisionGraph}
					{revisions}
					mutationsDisabled={mutationInFlight != null}
					onselect={onGraphSelect}
					onnew={newRevision}
					onedit={editRevision}
					onabandon={abandonRevision}
					ondescribe={describeRevision}
					onsquash={squashRevision}
					onrebase={rebaseRevision}
				/>
			{/if}
		</section>

		<div class="resize-handle" role="separator" aria-orientation="vertical" tabindex="0" onpointerdown={startResize}></div>

		<DiffPanel {activeProject} revisions={revisions ?? []} onReturnFocus={() => revisionGraph?.focus()} />
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
		min-height: 100vh;
		padding: 28px;
		background:
			radial-gradient(circle at top left, rgba(119, 114, 255, 0.22), transparent 30rem),
			#101116;
		color: #f6f2ea;
	}

	.titlebar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 18px 20px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 18px;
		background: rgba(255, 255, 255, 0.06);
		backdrop-filter: blur(18px);
	}

	.eyebrow,
	.rune-card p {
		margin: 0 0 6px;
		color: #b8b3a7;
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	h1 {
		font-size: 1.35rem;
	}

	.status {
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 999px;
		padding: 7px 12px;
		color: #d9d1c4;
		font-size: 0.85rem;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 260px;
		gap: 24px;
		align-items: stretch;
		margin-top: 28px;
	}

	.hero > div,
	.rune-card,
	.rpc-panel {
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 24px;
		padding: 28px;
		background: rgba(19, 20, 29, 0.82);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
	}

	h2 {
		max-width: 720px;
		font-size: clamp(2rem, 5vw, 4rem);
		line-height: 0.96;
		letter-spacing: -0.05em;
	}

	h2 + p {
		max-width: 620px;
		margin-top: 18px;
		color: #c8c0b2;
		font-size: 1rem;
		line-height: 1.7;
	}

	.rune-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 20px;
	}

	.rune-card strong {
		font-size: 5rem;
		line-height: 1;
	}

	.actions,
	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	button {
		border: 0;
		border-radius: 12px;
		padding: 10px 14px;
		background: #ece5d8;
		color: #15151d;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	button.secondary {
		background: rgba(255, 255, 255, 0.1);
		color: #f6f2ea;
	}

	.workspace-split {
		display: grid;
		gap: 0;
		align-items: stretch;
		margin-top: 24px;
	}

	.rpc-panel {
		min-width: 0;
		overflow: hidden;
	}

	.resize-handle {
		align-self: stretch;
		cursor: col-resize;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		transition: background 120ms ease;
	}

	.resize-handle:hover,
	.resize-handle:focus-visible {
		background: rgba(119, 114, 255, 0.5);
		outline: none;
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 20px;
	}

	.rpc-panel h2 {
		font-size: 2rem;
		letter-spacing: -0.04em;
	}

	.empty-state {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 16px;
	}

	.empty-state {
		align-items: center;
		justify-content: space-between;
		border: 1px solid rgba(255, 255, 255, 0.09);
		border-radius: 16px;
		padding: 16px;
		background: rgba(255, 255, 255, 0.045);
	}

	.empty-state h3 {
		width: 100%;
		font-size: 1.2rem;
	}

	.muted,
	.error {
		color: #c8c0b2;
	}

	.status-line {
		margin-bottom: 10px;
	}

	.keyboard-confirmation {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 14px;
		padding: 10px 12px;
		background: rgba(119, 114, 255, 0.14);
		color: #f6f2ea;
	}

	kbd {
		border: 1px solid rgba(255, 255, 255, 0.22);
		border-radius: 6px;
		padding: 1px 5px;
		background: rgba(255, 255, 255, 0.1);
		font: inherit;
		font-size: 0.82em;
	}

	.error {
		color: #ffb4a8;
	}

	@media (max-width: 760px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}
</style>
