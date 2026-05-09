<script lang="ts">
	type Props = { open: boolean; onClose: () => void };
	let { open = $bindable(false), onClose }: Props = $props();
	const shortcuts = [
		{ category: "Navigation", items: [["j / ↓", "Move down"], ["k / ↑", "Move up"], ["-", "Jump to parent"], ["+", "Jump to child"], ["@", "Jump to working copy"], ["g g", "Jump to first"], ["G", "Jump to last"], ["/", "Search revisions"]] },
		{ category: "Actions", items: [["n", "New revision"], ["e", "Edit revision"], ["s", "Squash into parent"], ["d", "Describe"], ["a", "Abandon"], ["r", "Rebase"], ["Enter", "Confirm rebase destination"], ["Esc", "Cancel/close"]] },
		{ category: "Yank", items: [["y y", "Copy change ID"], ["y Y", "Copy deep link"]] },
		{ category: "General", items: [["⌘/Ctrl K", "Command palette"], ["?", "Show this help"], ["h", "Return from diff to revisions"]] },
	];
</script>

{#if open}
	<div class="modal-backdrop" role="presentation" onclick={onClose} onkeydown={(event) => event.key === "Escape" && onClose()}>
		<section class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onclick={(event) => event.stopPropagation()}>
			<header><h2 id="shortcuts-title">Keyboard Shortcuts</h2><button type="button" class="secondary" onclick={onClose}>Close</button></header>
			<div class="grid">
				{#each shortcuts as section}
					<div>
						<h3>{section.category}</h3>
						{#each section.items as [keys, description]}
							<div class="shortcut"><span>{description}</span><kbd>{keys}</kbd></div>
						{/each}
					</div>
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
		place-items: center;
		background: color-mix(in oklab, var(--background) 60%, rgb(0 0 0 / 50%));
	}
	.dialog {
		width: min(760px, calc(100vw - 32px));
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 18px;
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-md);
	}
	header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
	h2, h3 { margin: 0; }
	h2 { font-size: 1.05rem; font-weight: 600; }
	h3 {
		margin-bottom: 6px;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; }
	.shortcut {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 4px 0;
		color: var(--foreground);
		font-size: 0.85rem;
	}
	kbd {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 4px);
		padding: 2px 6px;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 0.72rem;
		white-space: nowrap;
	}
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
	button.secondary { background: transparent; }
</style>
