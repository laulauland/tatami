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
	.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(0,0,0,.55); }
	.dialog { width: min(560px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 22px; background: #15161f; color: #f6f2ea; box-shadow: 0 30px 120px rgba(0,0,0,.55); }
	header, .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
	header { margin-bottom: 18px; }
	h2, h3, p { margin: 0; }
	h2 { font-size: 1.3rem; }
	p { margin-top: 6px; color: #c8c0b2; }
	label { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
	button { border: 0; border-radius: 12px; padding: 8px 12px; font: inherit; font-weight: 700; cursor: pointer; }
	button.secondary { background: rgba(255,255,255,.1); color: #f6f2ea; }
</style>
