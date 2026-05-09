<script lang="ts">
	import { useLiveQuery } from "@tanstack/svelte-db";
	import { Effect } from "effect";
	import { onMount } from "svelte";
	import DiffPanel from "./components/DiffPanel.svelte";
	import OperationsLog from "./components/OperationsLog.svelte";
	import ProjectPicker from "./components/ProjectPicker.svelte";
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
	import type { Project } from "../../src-electrobun/shared/rpc.ts";

	let clickCount = $state(0);
	let errorMessage = $state<string | null>(null);
	let projectMessage = $state<string | null>(null);
	let activeProjectId = $state<string | null>(null);
	let isProjectBusy = $state(false);
	let mutationInFlight = $state<RevisionMutationOperation | null>(null);
	let isSyncing = $state(false);
	let operationsLogOpen = $state(false);
	let watchedRepoPath: string | null = null;

	const revisionsQuery = useLiveQuery((query) =>
		query.from({ revisions: revisionsCollection }).select(({ revisions }) => revisions),
	);
	const { data: revisions, isLoading } = $derived(revisionsQuery);

	const repositoriesQuery = useLiveQuery((query) =>
		query.from({ repositories: repositoriesCollection }).select(({ repositories }) => repositories),
	);
	const { data: projects } = $derived(repositoriesQuery);
	const activeProject = $derived(projects.find((project) => project.id === activeProjectId) ?? null);

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
		if (!window.confirm("Abandon this revision?")) return;
		await runRevisionMutation("jjAbandon", (repoPath) => jjAbandon(repoPath, changeId));
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
		const destinationChangeId = window.prompt("Destination change id");
		if (destinationChangeId == null || destinationChangeId.trim() === "") return;
		await runRevisionMutation("jjRebase", (repoPath) => jjRebase({
			repoPath,
			sourceChangeId,
			destinationChangeId: destinationChangeId.trim(),
		}));
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

	<section class="rpc-panel" aria-labelledby="rpc-title">
		<div class="panel-heading">
			<div>
				<p class="eyebrow">Electrobun RPC native smoke test</p>
				<h2 id="rpc-title">Real jj revisions</h2>
			</div>
			<div class="toolbar-actions">
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
			{#if isSyncing}
				<p class="muted status-line">Sync in progress…</p>
			{/if}
			<RevisionGraph
				{revisions}
				mutationsDisabled={mutationInFlight != null}
				onnew={newRevision}
				onedit={editRevision}
				onabandon={abandonRevision}
				ondescribe={describeRevision}
				onsquash={squashRevision}
				onrebase={rebaseRevision}
			/>
		{/if}
	</section>

	<DiffPanel {activeProject} revisions={revisions ?? []} />

	<OperationsLog
		repoPath={activeProject?.path ?? null}
		open={operationsLogOpen}
		onClose={() => operationsLogOpen = false}
		onError={(message) => errorMessage = message}
		onMessage={(message) => projectMessage = message}
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

	.rpc-panel {
		margin-top: 24px;
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

	.error {
		color: #ffb4a8;
	}

	@media (max-width: 760px) {
		.hero {
			grid-template-columns: 1fr;
		}
	}
</style>
