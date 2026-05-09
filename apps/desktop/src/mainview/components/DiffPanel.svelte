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
	};

	let { activeProject, revisions }: Props = $props();

	let displayMode = $state<DiffDisplayMode>("unified");
	let files = $state<ChangedFile[]>([]);
	let selectedFilePath = $state<string | null>(null);
	let diffPatch = $state("");
	let isLoading = $state(false);
	let errorMessage = $state<string | null>(null);

	const selectedChangeId = $derived(getSelectedRevisionId());
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

<section class="diff-panel" aria-labelledby="diff-title">
	<div class="panel-heading">
		<div>
			<p class="eyebrow">Read-only jj diff</p>
			<h2 id="diff-title">Changed files</h2>
		</div>
		<span class="status">{selectedChangeId ? selectedChangeId.slice(0, 8) : "no revision"}</span>
	</div>

	{#if activeProject == null}
		<p class="muted">Add or select a repository to inspect revision diffs.</p>
	{:else if selectedChangeId == null}
		<p class="muted">Select a revision in the graph to load its changed files and diff.</p>
	{:else if errorMessage}
		<p class="error">Diff failed: {errorMessage}</p>
	{:else}
		<div class="diff-toolbar" aria-label="Diff display controls">
			<button type="button" class:secondary={displayMode !== "unified"} onclick={() => displayMode = "unified"}>Unified</button>
			<button type="button" class:secondary={displayMode !== "split"} onclick={() => displayMode = "split"}>Split</button>
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
					<div class="status-list" aria-label="Changed file statuses">
						{#each files as file (file.path)}
							<button
								type="button"
								class="file-status"
								class:selected={file.path === selectedFilePath}
								data-status={file.status}
								onclick={() => selectedFilePath = file.path}
							>
								<span>{statusLabel(file.status)}</span>
								{file.path}
							</button>
						{/each}
					</div>
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
		margin-top: 24px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 24px;
		padding: 28px;
		background: rgba(19, 20, 29, 0.82);
		box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
	}

	.panel-heading,
	.diff-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 16px;
	}

	.diff-toolbar {
		justify-content: flex-start;
		flex-wrap: wrap;
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

	.status-list {
		display: grid;
		gap: 6px;
		margin-top: 12px;
	}

	.file-status {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr);
		gap: 8px;
		align-items: center;
		width: 100%;
		border-radius: 10px;
		padding: 7px 8px;
		background: rgba(255, 255, 255, 0.055);
		color: #f6f2ea;
		font-size: 0.82rem;
		font-weight: 500;
		text-align: left;
	}

	.file-status.selected {
		background: rgba(119, 114, 255, 0.28);
	}

	.file-status span,
	.selected-file span {
		display: inline-grid;
		place-items: center;
		border-radius: 6px;
		padding: 2px 5px;
		font-size: 0.72rem;
		font-weight: 800;
	}

	[data-status="added"] span,
	.selected-file span[data-status="added"] {
		background: rgba(82, 196, 107, 0.22);
		color: #9af0ad;
	}

	[data-status="deleted"] span,
	.selected-file span[data-status="deleted"] {
		background: rgba(255, 99, 99, 0.22);
		color: #ffb4a8;
	}

	[data-status="modified"] span,
	.selected-file span[data-status="modified"] {
		background: rgba(255, 204, 102, 0.2);
		color: #ffe09a;
	}

	.selected-file {
		display: flex;
		gap: 8px;
		align-items: center;
		margin: 0 0 10px;
		color: #d9d1c4;
		font-size: 0.9rem;
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

	.eyebrow {
		margin: 0 0 6px;
		color: #b8b3a7;
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h2,
	p {
		margin: 0;
	}

	h2 {
		font-size: 2rem;
		letter-spacing: -0.04em;
	}

	.status {
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 999px;
		padding: 7px 12px;
		color: #d9d1c4;
		font-size: 0.85rem;
	}

	.muted,
	.error {
		color: #c8c0b2;
	}

	.error {
		color: #ffb4a8;
	}

	@media (max-width: 900px) {
		.diff-layout {
			grid-template-columns: 1fr;
		}
	}
</style>
