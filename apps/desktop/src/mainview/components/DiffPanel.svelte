<script lang="ts">
	import { Effect } from "effect";
	import type { ChangedFile, Project, RevisionStub } from "../../../src-electrobun/shared/rpc.ts";
	import { FrontendRuntime } from "../runtime.ts";
	import { NativeClient } from "../services/NativeClient.ts";
	import { getSelectedRevisionId } from "../state/url.svelte.ts";
	import DiffView from "./DiffView.svelte";
	import FileTreeView from "./FileTreeView.svelte";

	type DiffDisplayMode = "unified" | "split";

	type Props = {
		activeProject: Project | null;
		revisions: readonly RevisionStub[];
		onReturnFocus?: () => void;
	};

	let { activeProject, revisions, onReturnFocus }: Props = $props();

	let displayMode = $state<DiffDisplayMode>("unified");
	let files = $state<ChangedFile[]>([]);
	let selectedFilePath = $state<string | null>(null);
	let diffPatch = $state("");
	let isLoading = $state(false);
	let errorMessage = $state<string | null>(null);
	let panelElement = $state<HTMLElement | null>(null);

	const selectedChangeId = $derived(getSelectedRevisionId());
	const selectedRevision = $derived(
		selectedChangeId == null ? null : revisions.find((revision) => revision.change_id === selectedChangeId) ?? null,
	);
	const filePaths = $derived(files.map((file) => file.path));
	const selectedFile = $derived(files.find((file) => file.path === selectedFilePath) ?? null);
	const visiblePatch = $derived(
		selectedFilePath == null ? diffPatch : filterUnifiedDiffForFile(diffPatch, selectedFilePath),
	);

	const changesCache = new Map<string, ChangedFile[]>();
	const diffCache = new Map<string, string>();
	let loadSequence = 0;

	function statusLabel(status: ChangedFile["status"]): string {
		switch (status) {
			case "added":
				return "A";
			case "deleted":
				return "D";
			case "modified":
				return "M";
		}
	}

	function normalizeDiffPath(path: string): string {
		return path.replace(/^[ab]\//, "");
	}

	function diffBlockPath(headerLine: string): string | null {
		const match = headerLine.match(/^---\s+(?:a\/)?(.+)$/);
		if (!match) return null;
		return normalizeDiffPath(match[1]);
	}

	function filterUnifiedDiffForFile(patch: string, path: string): string {
		const blocks = patch.split(/(?=^---\s+)/m).filter((block) => block.trim().length > 0);
		const matchingBlocks = blocks.filter((block) => {
			const firstLine = block.split("\n", 1)[0] ?? "";
			return diffBlockPath(firstLine) === path;
		});
		return matchingBlocks.join("\n") || patch;
	}

	async function loadSelectedRevision(changeId: string): Promise<void> {
		if (activeProject == null) return;
		const sequence = ++loadSequence;
		isLoading = true;
		errorMessage = null;

		try {
			const cachedFiles = changesCache.get(changeId);
			const cachedDiff = diffCache.get(changeId);
			const [nextFiles, nextDiff] = await FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					const nextFiles = cachedFiles ?? (yield* nativeClient.getRevisionChanges({ repoPath: activeProject.path, changeId }));
					const nextDiff = cachedDiff ?? (yield* nativeClient.getRevisionDiff({ repoPath: activeProject.path, changeId }));
					return [nextFiles, nextDiff] as const;
				}),
			);

			if (sequence !== loadSequence) return;
			changesCache.set(changeId, nextFiles);
			diffCache.set(changeId, nextDiff);
			files = nextFiles;
			diffPatch = nextDiff;
			selectedFilePath = nextFiles[0]?.path ?? null;
		} catch (error) {
			if (sequence !== loadSequence) return;
			errorMessage = error instanceof Error ? error.message : String(error);
			files = [];
			diffPatch = "";
			selectedFilePath = null;
			console.error("Failed to load revision diff", error);
		} finally {
			if (sequence === loadSequence) isLoading = false;
		}
	}

	async function prefetchAdjacent(changeId: string): Promise<void> {
		if (activeProject == null) return;
		const index = revisions.findIndex((revision) => revision.change_id === changeId);
		if (index < 0) return;

		const adjacentChangeIds = revisions
			.slice(Math.max(0, index - 3), Math.min(revisions.length, index + 4))
			.map((revision) => revision.change_id)
			.filter((id) => id !== changeId && (!changesCache.has(id) || !diffCache.has(id)));

		if (adjacentChangeIds.length === 0) return;

		try {
			const [changes, diffs] = await FrontendRuntime.runPromise(
				Effect.gen(function* () {
					const nativeClient = yield* NativeClient;
					const changes = yield* nativeClient.getChangesBatch({ repoPath: activeProject.path, changeIds: adjacentChangeIds });
					const diffs = yield* nativeClient.getDiffsBatch({ repoPath: activeProject.path, changeIds: adjacentChangeIds });
					return [changes, diffs] as const;
				}),
			);
			for (const change of changes) changesCache.set(change.change_id, change.files);
			for (const diff of diffs) diffCache.set(diff.change_id, diff.diff);
		} catch (error) {
			console.warn("Adjacent diff prefetch failed", error);
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "j" || event.key === "k") {
			event.preventDefault();
			panelElement?.scrollBy({ top: event.key === "j" ? 90 : -90, behavior: "smooth" });
		} else if (event.key === "h") {
			event.preventDefault();
			onReturnFocus?.();
		}
	}

	$effect(() => {
		const changeId = selectedChangeId;
		if (activeProject == null || changeId == null) {
			files = [];
			diffPatch = "";
			selectedFilePath = null;
			return;
		}

		void loadSelectedRevision(changeId);
		void prefetchAdjacent(changeId);
	});
</script>

<section class="diff-panel" aria-labelledby="diff-title" tabindex="0" bind:this={panelElement} onkeydown={handleKeydown}>
	{#if selectedRevision}
		<header class="revision-header" id="diff-title">
			<div class="meta-line">
				<span class="meta-item">
					<span class="meta-label">Change ID:</span>
					<strong class="meta-value mono">{selectedRevision.change_id_short}</strong>
				</span>
				<span class="meta-item">
					<span class="meta-label">Commit ID:</span>
					<span class="meta-value mono">{selectedRevision.commit_id.slice(0, 12)}</span>
				</span>
			</div>
			<div class="meta-line">
				<span class="meta-label">Author:</span>
				<span class="meta-value">{selectedRevision.author}</span>
				<span class="meta-label meta-at">at</span>
				<span class="meta-value">{selectedRevision.timestamp}</span>
			</div>
			{#if selectedRevision.description.trim().length > 0}
				<pre class="description">{selectedRevision.description}</pre>
			{/if}
			{#if selectedRevision.has_conflict}
				<div class="conflict-callout" role="alert">⚠ This revision has conflicts.</div>
			{/if}
		</header>
	{:else}
		<header class="revision-header revision-header-empty" id="diff-title">
			<span class="meta-label">No revision selected</span>
		</header>
	{/if}

	{#if activeProject == null}
		<p class="muted">Add or select a repository to inspect revision diffs.</p>
	{:else if selectedChangeId == null}
		<p class="muted">Select a revision in the graph to load its changed files and diff.</p>
	{:else if errorMessage}
		<p class="error">Diff failed: {errorMessage}</p>
	{:else}
		<div class="diff-toolbar" aria-label="Diff display controls">
			<button type="button" class:active={displayMode === "unified"} onclick={() => displayMode = "unified"}>Unified</button>
			<button type="button" class:active={displayMode === "split"} onclick={() => displayMode = "split"}>Split</button>
			<span class="muted">{isLoading ? "Loading…" : `${files.length} changed file${files.length === 1 ? "" : "s"}`}</span>
		</div>

		<div class="diff-layout">
			<aside class="file-list" aria-label="Changed files">
				{#if filePaths.length > 0}
					{#key `${selectedChangeId}:${filePaths.join("|")}`}
						<FileTreeView
							paths={filePaths}
							onSelectionChange={(paths) => selectedFilePath = paths[0] ?? selectedFilePath}
						/>
					{/key}
				{:else if isLoading}
					<p class="muted">Loading changed files…</p>
				{:else}
					<p class="muted">No changed files for this revision.</p>
				{/if}
			</aside>

			<div class="diff-content">
				{#if selectedFile}
					<p class="selected-file">
						<span data-status={selectedFile.status}>{statusLabel(selectedFile.status)}</span>
						{selectedFile.path}
					</p>
				{/if}
				{#if visiblePatch.trim().length > 0}
					{#key `${selectedChangeId}:${selectedFilePath ?? "all"}:${displayMode}:${visiblePatch.length}`}
						<DiffView patch={visiblePatch} {displayMode} />
					{/key}
				{:else if isLoading}
					<p class="muted">Loading diff content…</p>
				{:else}
					<p class="muted">No text diff to render. Binary and image previews are deferred; binary files show a text placeholder when detected.</p>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.diff-panel {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: auto;
		padding: 0 16px 16px;
		background: var(--background);
		color: var(--foreground);
		outline: none;
	}

	.diff-panel:focus-visible {
		outline: 2px solid color-mix(in oklab, var(--ring) 60%, transparent);
		outline-offset: -2px;
	}

	.revision-header {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0 -16px 12px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--foreground);
	}

	.revision-header-empty {
		font-family: var(--font-sans);
		color: var(--muted-foreground);
	}

	.meta-line {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: baseline;
	}

	.meta-item {
		display: inline-flex;
		gap: 6px;
		align-items: baseline;
	}

	.meta-label {
		color: var(--muted-foreground);
	}

	.meta-at {
		margin-left: 8px;
	}

	.meta-value {
		color: var(--foreground);
		font-weight: 400;
	}

	.meta-value.mono {
		font-family: var(--font-mono);
	}

	strong.meta-value {
		font-weight: 600;
	}

	.description {
		margin: 4px 0 0;
		padding: 0;
		font-family: var(--font-sans);
		font-size: 0.85rem;
		color: var(--foreground);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.conflict-callout {
		margin-top: 4px;
		padding: 8px;
		border: 1px solid color-mix(in oklab, var(--destructive) 30%, transparent);
		border-radius: calc(var(--radius) - 2px);
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
		font-family: var(--font-sans);
		font-size: 0.8rem;
	}

	.diff-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}

	.diff-layout {
		display: grid;
		grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
		gap: 16px;
	}

	.file-list,
	.diff-content {
		min-width: 0;
	}

	.selected-file span {
		display: inline-grid;
		place-items: center;
		border-radius: calc(var(--radius) - 4px);
		padding: 1px 4px;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1;
	}

	.selected-file span[data-status="added"] {
		background: var(--diff-add-bg);
		color: var(--diff-add-fg);
	}

	.selected-file span[data-status="deleted"] {
		background: var(--diff-remove-bg);
		color: var(--diff-remove-fg);
	}

	.selected-file span[data-status="modified"] {
		background: var(--diff-hunk-header-bg);
		color: var(--diff-hunk-header-fg);
	}

	.selected-file {
		display: flex;
		gap: 8px;
		align-items: center;
		margin: 0 0 10px;
		color: var(--muted-foreground);
		font-size: 0.85rem;
	}

	button {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 2px);
		padding: 4px 10px;
		background: var(--card);
		color: var(--card-foreground);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	button:hover:not(.active) { background: var(--muted); }
	button.active {
		background: var(--accent);
		color: var(--accent-foreground);
		border-color: var(--accent);
	}

	p { margin: 0; }

	.muted,
	.error {
		color: var(--muted-foreground);
		font-size: 0.85rem;
	}

	.error { color: var(--destructive); }

	@media (max-width: 900px) {
		.diff-layout { grid-template-columns: 1fr; }
	}
</style>
