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
	.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(0,0,0,.55); }
	.modal-backdrop.top { z-index: 60; }
	.dialog, .confirm { width: min(760px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 22px; background: #15161f; color: #f6f2ea; box-shadow: 0 30px 120px rgba(0,0,0,.55); }
	.confirm { width: min(420px, calc(100vw - 32px)); }
	header, header div, .repo-row, .confirm div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
	header { margin-bottom: 18px; }
	h2, h3, p { margin: 0; }
	.repo-list { display: grid; gap: 8px; max-height: 440px; overflow: auto; }
	.repo-row { border: 1px solid rgba(255,255,255,.1); border-radius: 14px; padding: 8px; background: rgba(255,255,255,.04); }
	.repo-row.active { border-color: rgba(119,114,255,.65); }
	.repo-main { flex: 1; display: grid; gap: 4px; text-align: left; background: transparent; color: inherit; }
	.repo-main span, .empty, .confirm p { color: #c8c0b2; font-size: .85rem; }
	button { border: 0; border-radius: 12px; padding: 8px 12px; font: inherit; font-weight: 700; cursor: pointer; background: #ece5d8; color: #15151d; }
	button.secondary { background: rgba(255,255,255,.1); color: #f6f2ea; }
	button.danger { background: #ffb4a8; color: #2b1110; }
</style>
