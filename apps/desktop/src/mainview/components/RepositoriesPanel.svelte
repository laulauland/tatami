<script lang="ts">
	import type { Project } from "../../../src-electrobun/shared/rpc.ts";
	type Props = { open: boolean; projects: readonly Project[]; activeProjectId: string | null; busy?: boolean; onClose: () => void; onSelect: (project: Project) => void; onRemove: (project: Project) => void; onAdd: () => void };
	let { open = $bindable(false), projects, activeProjectId, busy = false, onClose, onSelect, onRemove, onAdd }: Props = $props();
	let pendingDelete = $state<Project | null>(null);

	$effect(() => {
		if (!open) pendingDelete = null;
	});

	function closePanel(): void {
		pendingDelete = null;
		onClose();
	}

	function confirmRemove(project: Project): void { pendingDelete = project; }
	function cancelRemove(): void { pendingDelete = null; }
	function removePending(): void { if (pendingDelete) onRemove(pendingDelete); pendingDelete = null; }
</script>

{#if open}
	<div class="modal-backdrop" role="presentation" onclick={closePanel}>
		<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="repositories-title" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && closePanel()}>
			<header><h2 id="repositories-title">Repositories</h2><div><button type="button" onclick={onAdd} disabled={busy}>Add</button><button type="button" class="secondary" onclick={closePanel}>Close</button></div></header>
			<div class="repo-list">
				{#each projects as project (project.id)}
					<div class="repo-row" class:active={project.id === activeProjectId}>
						<button type="button" class="repo-main" onclick={() => onSelect(project)} disabled={busy}>
							<strong>{project.name}</strong><span>{project.path}</span>
						</button>
						<button type="button" class="danger" onclick={() => confirmRemove(project)} disabled={busy}>Remove</button>
					</div>
				{:else}
					<p class="empty">No repositories added yet.</p>
				{/each}
			</div>
		</section>
	</div>
{/if}

{#if open && pendingDelete}
	<div class="modal-backdrop top" role="presentation" onclick={cancelRemove}>
		<section
			class="confirm"
			role="alertdialog"
			aria-modal="true"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				cancelRemove();
			}}
		>
			<h3>Remove {pendingDelete.name}?</h3><p>{pendingDelete.path}</p>
			<div><button type="button" class="secondary" onclick={cancelRemove}>Cancel</button><button type="button" class="danger" onclick={removePending}>Remove</button></div>
		</section>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		background: color-mix(in oklab, var(--background) 60%, rgb(0 0 0 / 50%));
	}
	.modal-backdrop.top { z-index: 60; }
	.dialog, .confirm {
		width: min(760px, calc(100vw - 32px));
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 18px;
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-md);
	}
	.confirm { width: min(420px, calc(100vw - 32px)); }
	header, header div, .repo-row, .confirm div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	header { margin-bottom: 14px; }
	h2 { font-size: 1.05rem; font-weight: 600; margin: 0; }
	h3 { font-size: 0.95rem; font-weight: 600; margin: 0; }
	p { margin: 0; }
	.repo-list { display: grid; gap: 6px; max-height: 440px; overflow: auto; }
	.repo-row {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 2px);
		padding: 8px;
		background: var(--card);
	}
	.repo-row.active {
		border-color: color-mix(in oklab, var(--ring) 60%, var(--border));
	}
	.repo-main {
		flex: 1;
		display: grid;
		gap: 4px;
		text-align: left;
		background: transparent;
		color: inherit;
		border: 0;
		padding: 4px 6px;
		cursor: pointer;
	}
	.repo-main strong { font-size: 0.875rem; font-weight: 600; }
	.repo-main span, .empty, .confirm p { color: var(--muted-foreground); font-size: 0.8rem; }
	button {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 2px);
		padding: 6px 10px;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		background: var(--card);
		color: var(--card-foreground);
	}
	button:hover:not(:disabled) { background: var(--muted); }
	button:disabled { opacity: 0.55; cursor: not-allowed; }
	button.secondary { background: transparent; }
	button.danger {
		border-color: color-mix(in oklab, var(--destructive) 50%, var(--border));
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
	}
	button.danger:hover:not(:disabled) {
		background: color-mix(in oklab, var(--destructive) 18%, transparent);
	}
</style>
