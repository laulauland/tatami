<script lang="ts">
	import { useLiveQuery } from "@tanstack/svelte-db";
	import type { Operation } from "../../../src-electrobun/shared/rpc.ts";
	import { loadOperations, operationsCollection, undoOperation } from "../data/operations.ts";

	type Props = {
		repoPath: string | null;
		open: boolean;
		onClose: () => void;
		onError?: (message: string) => void;
		onMessage?: (message: string) => void;
	};

	let { repoPath, open, onClose, onError, onMessage }: Props = $props();
	let isLoadingOperations = $state(false);
	let loadingError = $state<string | null>(null);
	let undoingOperationId = $state<string | null>(null);
	let loadedRepoPath = $state<string | null>(null);

	const operationsQuery = useLiveQuery((query) =>
		query.from({ operations: operationsCollection }).select(({ operations }) => operations),
	);
	const { data: operations } = $derived(operationsQuery);

	const sortedOperations = $derived.by(() => {
		const copy = [...operations];
		copy.sort((left, right) => operationTimestampMillis(right) - operationTimestampMillis(left));
		return copy;
	});

	$effect(() => {
		if (!open) return;
		if (repoPath == null) {
			loadedRepoPath = null;
			return;
		}
		if (repoPath !== loadedRepoPath) {
			void refreshOperations(true);
		}
	});

	function formatTimestamp(timestamp: string): string {
		const parsed = new Date(timestamp);
		return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleString();
	}

	function operationTimestampMillis(operation: Operation): number {
		const millis = new Date(operation.timestamp).getTime();
		return Number.isNaN(millis) ? 0 : millis;
	}

	function formatError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function getUndoHint(errorMessage: string): string {
		const lower = errorMessage.toLowerCase();
		if (lower.includes("root") || lower.includes("initial")) return "The initial/root operation cannot be undone.";
		if (lower.includes("descendant") || lower.includes("head") || lower.includes("newer") || lower.includes("conflict")) {
			return "Undo a newer operation first, then retry.";
		}
		return "Check the operation order and try again.";
	}

	async function refreshOperations(force = false): Promise<void> {
		if (repoPath == null || isLoadingOperations) return;
		if (!force && repoPath === loadedRepoPath) return;
		isLoadingOperations = true;
		loadingError = null;
		try {
			await loadOperations(repoPath);
			loadedRepoPath = repoPath;
		} catch (error) {
			loadingError = formatError(error);
			onError?.(`Failed to load operations: ${loadingError}`);
		} finally {
			isLoadingOperations = false;
		}
	}

	async function handleUndo(operation: Operation): Promise<void> {
		if (repoPath == null || undoingOperationId != null) return;
		undoingOperationId = operation.id;
		loadingError = null;
		try {
			await undoOperation(repoPath, operation.id);
			onMessage?.(`Undid operation ${operation.id.slice(0, 8)}.`);
		} catch (error) {
			const message = formatError(error);
			const fullMessage = `Failed to undo operation: ${message} ${getUndoHint(message)}`;
			loadingError = fullMessage;
			onError?.(fullMessage);
		} finally {
			undoingOperationId = null;
		}
	}
</script>

{#if open}
	<div class="dialog-backdrop" role="button" tabindex="0" aria-label="Close operations log" onclick={onClose} onkeydown={(event) => event.key === "Escape" && onClose()}>
		<div class="operations-dialog" role="dialog" aria-modal="true" aria-labelledby="operations-title" tabindex="-1" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
			<header class="dialog-header">
				<div>
					<p class="eyebrow">Jujutsu history</p>
					<h3 id="operations-title">Operations log</h3>
				</div>
				<div class="dialog-actions">
					<button type="button" class="secondary" onclick={() => void refreshOperations(true)} disabled={repoPath == null || isLoadingOperations}>
						{isLoadingOperations ? "Refreshing…" : "Refresh"}
					</button>
					<button type="button" class="secondary" onclick={onClose}>Close</button>
				</div>
			</header>

			<div class="operation-list">
				{#if repoPath == null}
					<p class="muted">Select a repository first.</p>
				{:else if isLoadingOperations && sortedOperations.length === 0}
					<p class="muted">Loading operations…</p>
				{:else if loadingError != null}
					<p class="error">{loadingError}</p>
				{:else if sortedOperations.length === 0}
					<p class="muted">No operations found.</p>
				{:else}
					<ul>
						{#each sortedOperations as operation (operation.id)}
							<li>
								<div class="operation-main">
									<p class="description">{operation.description || "(no description)"}</p>
									<p class="meta">{formatTimestamp(operation.timestamp)} • {operation.user}@{operation.hostname}</p>
									{#if operation.working_copy_change_id}
										<p class="meta">working copy: {operation.working_copy_change_id.slice(0, 12)}</p>
									{/if}
								</div>
								<div class="operation-actions">
									<code>{operation.id.slice(0, 8)}</code>
									<button type="button" class="secondary" onclick={() => void handleUndo(operation)} disabled={undoingOperationId != null}>
										{undoingOperationId === operation.id ? "Undoing…" : "Undo"}
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 24px;
		background: color-mix(in oklab, var(--background) 60%, rgb(0 0 0 / 50%));
	}

	.operations-dialog {
		width: min(760px, 100%);
		max-height: min(680px, 90vh);
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-md);
	}

	.dialog-header,
	.operation-actions,
	.dialog-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.dialog-header {
		justify-content: space-between;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
	}

	.eyebrow,
	.meta {
		margin: 0;
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}

	.eyebrow {
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h3,
	.description,
	.muted,
	.error {
		margin: 0;
	}

	h3 { font-size: 1rem; font-weight: 600; }

	.operation-list {
		overflow: auto;
		padding: 6px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--border);
	}

	li:last-child { border-bottom: 0; }

	.description {
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.4;
	}

	.operation-main {
		min-width: 0;
	}

	button {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 2px);
		padding: 6px 10px;
		background: var(--card);
		color: var(--card-foreground);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	button.secondary { background: transparent; }
	button:hover:not(:disabled) { background: var(--muted); }

	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	code {
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 0.75rem;
	}

	.muted {
		padding: 14px;
		color: var(--muted-foreground);
		font-size: 0.85rem;
	}

	.error {
		padding: 14px;
		color: var(--destructive);
		font-size: 0.85rem;
	}
</style>
