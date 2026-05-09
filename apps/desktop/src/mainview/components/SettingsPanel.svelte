<script lang="ts">
	type Props = { open: boolean; onClose: () => void };
	let { open = $bindable(false), onClose }: Props = $props();
	let performanceTracing = $state(localStorage.getItem("tatami-performance-tracing") === "true");
	$effect(() => localStorage.setItem("tatami-performance-tracing", String(performanceTracing)));
</script>

{#if open}
	<div class="modal-backdrop" role="presentation" onclick={onClose}>
		<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.key === "Escape" && onClose()}>
			<header><h2 id="settings-title">Settings</h2><button type="button" class="secondary" onclick={onClose}>Close</button></header>
			<div class="setting-row">
				<div><h3>Developer</h3><p>Enable performance tracing markers in the UI.</p></div>
				<label><input type="checkbox" bind:checked={performanceTracing} /> Performance tracing</label>
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
		place-items: center;
		background: color-mix(in oklab, var(--background) 60%, rgb(0 0 0 / 50%));
	}
	.dialog {
		width: min(560px, calc(100vw - 32px));
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 18px;
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-md);
	}
	header, .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
	header { margin-bottom: 14px; }
	h2, h3, p { margin: 0; }
	h2 { font-size: 1.05rem; font-weight: 600; }
	h3 { font-size: 0.875rem; font-weight: 600; }
	p { margin-top: 4px; color: var(--muted-foreground); font-size: 0.85rem; }
	label { display: flex; align-items: center; gap: 8px; white-space: nowrap; font-size: 0.875rem; }
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
</style>
