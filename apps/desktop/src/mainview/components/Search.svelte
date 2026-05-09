<script lang="ts">
	import { Effect } from "effect";
	import type { RevisionStub } from "../../../src-electrobun/shared/rpc.ts";
	import { FrontendRuntime } from "../runtime.ts";
	import { NativeClient } from "../services/NativeClient.ts";

	type Props = {
		open: boolean;
		revisions: readonly RevisionStub[];
		repoPath: string | null;
		onClose: () => void;
		onJump: (changeId: string) => void;
	};

	let { open = $bindable(false), revisions, repoPath, onClose, onJump }: Props = $props();
	let searchText = $state("");
	let selectedIndex = $state(0);
	let revsetChangeIds = $state<string[]>([]);
	let revsetError = $state<string | null>(null);
	let revsetLoading = $state(false);
	let resolveSequence = 0;

	const trimmedSearch = $derived(searchText.trim());
	const isRevset = $derived(isRevsetExpression(trimmedSearch));
	const revsetChangeIdSet = $derived(new Set(revsetChangeIds));
	const isRevsetMode = $derived(isRevset && (revsetLoading || revsetChangeIds.length > 0 || revsetError != null));
	const filteredRevisions = $derived.by(() => {
		if (isRevsetMode) return revisions.filter((revision) => revsetChangeIdSet.has(revision.change_id));
		if (trimmedSearch.length === 0) return revisions;
		const lowerSearch = trimmedSearch.toLowerCase();
		return revisions
			.filter((revision) => matchType(revision, lowerSearch) != null)
			.toSorted((a, b) => matchPriority(a, lowerSearch) - matchPriority(b, lowerSearch));
	});

	$effect(() => {
		if (open) {
			searchText = "";
			selectedIndex = 0;
		}
	});

	$effect(() => {
		const query = trimmedSearch;
		const sequence = ++resolveSequence;
		revsetChangeIds = [];
		revsetError = null;
		if (!open || !repoPath || !isRevset || query.length === 0) {
			revsetLoading = false;
			return;
		}
		revsetLoading = true;
		void FrontendRuntime.runPromise(
			Effect.gen(function* () {
				const nativeClient = yield* NativeClient;
				return yield* nativeClient.resolveRevset({ repoPath, revset: query });
			}),
		).then((result) => {
			if (sequence !== resolveSequence) return;
			revsetChangeIds = result.change_ids;
			revsetError = result.error;
		}).catch((error) => {
			if (sequence !== resolveSequence) return;
			revsetError = error instanceof Error ? error.message : String(error);
		}).finally(() => {
			if (sequence === resolveSequence) revsetLoading = false;
		});
	});

	function isRevsetExpression(query: string): boolean {
		if (!query) return false;
		return query === "@" || /^@-+$/.test(query) || /^[a-z0-9]+[-+]$/i.test(query) || /[()|&]/.test(query) || query.includes("::") || query.includes("..");
	}

	function matchType(revision: RevisionStub, lowerSearch: string): "changeId" | "bookmark" | "description" | null {
		if (revision.change_id.toLowerCase().startsWith(lowerSearch) || revision.change_id_short.toLowerCase().startsWith(lowerSearch)) return "changeId";
		if (revision.bookmarks.some((bookmark) => bookmark.name.toLowerCase().includes(lowerSearch))) return "bookmark";
		if (revision.description.toLowerCase().includes(lowerSearch)) return "description";
		return null;
	}

	function matchPriority(revision: RevisionStub, lowerSearch: string): number {
		const type = matchType(revision, lowerSearch);
		return type === "changeId" ? 0 : type === "bookmark" ? 1 : type === "description" ? 2 : 3;
	}

	function jumpTo(changeId: string): void {
		onJump(changeId);
		onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, Math.max(0, filteredRevisions.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex = Math.max(0, selectedIndex - 1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const revision = filteredRevisions[selectedIndex];
			if (revision) jumpTo(revision.change_id);
		}
	}
</script>

{#if open}
	<div class="modal-backdrop" role="presentation" onclick={onClose}>
		<section class="dialog search-dialog" role="dialog" aria-modal="true" aria-label="Jump to revision" onclick={(event) => event.stopPropagation()}>
			<input autofocus class="dialog-input" placeholder="Search or use revset (@, @-, trunk(), mine())..." bind:value={searchText} onkeydown={handleKeydown} />
			{#if isRevsetMode}
				<p class="hint">{revsetLoading ? "Resolving revset…" : revsetError ? revsetError : `revset: ${trimmedSearch} (${revsetChangeIds.length})`}</p>
			{/if}
			<div class="result-list">
				{#each filteredRevisions as revision, index (revision.change_id)}
					<button type="button" class="result" class:selected={index === selectedIndex} onmouseenter={() => selectedIndex = index} onclick={() => jumpTo(revision.change_id)}>
						<code>{revision.change_id_short}</code>
						<span>{revision.description.split("\n")[0] || "(no description)"}</span>
						{#if revision.is_working_copy}<strong>@</strong>{/if}
						{#each revision.bookmarks as bookmark}<em>{bookmark.name}</em>{/each}
					</button>
				{:else}
					<p class="empty">No revisions found.</p>
				{/each}
			</div>
		</section>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: start center;
		padding-top: 12vh;
		background: color-mix(in oklab, var(--background) 60%, rgb(0 0 0 / 50%));
	}
	.dialog {
		width: min(760px, calc(100vw - 32px));
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}
	.dialog-input {
		width: 100%;
		box-sizing: border-box;
		border: 0;
		border-bottom: 1px solid var(--border);
		padding: 12px 14px;
		background: transparent;
		color: inherit;
		font: inherit;
		outline: none;
	}
	.hint, .empty { margin: 0; padding: 12px 14px; color: var(--muted-foreground); font-size: 0.85rem; }
	.result-list { max-height: 460px; overflow: auto; padding: 6px; }
	.result {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 0;
		border-radius: calc(var(--radius) - 4px);
		background: transparent;
		color: inherit;
		text-align: left;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}
	.result.selected, .result:hover {
		background: color-mix(in oklab, var(--accent) 18%, transparent);
	}
	.result code {
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}
	.result span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.result em {
		color: var(--primary);
		font-style: normal;
		font-size: 0.78rem;
	}
	.result strong {
		color: var(--primary);
		font-weight: 700;
	}
</style>
