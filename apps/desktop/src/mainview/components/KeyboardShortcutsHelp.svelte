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
	.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(0,0,0,.55); }
	.dialog { width: min(760px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,.14); border-radius: 18px; padding: 22px; background: #15161f; color: #f6f2ea; box-shadow: 0 30px 120px rgba(0,0,0,.55); }
	header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
	h2, h3 { margin: 0; }
	h2 { font-size: 1.3rem; }
	h3 { margin-bottom: 8px; color: #b8b3a7; font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; }
	.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 28px; }
	.shortcut { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 5px 0; color: #e6ded2; font-size: .9rem; }
	kbd { border: 1px solid rgba(255,255,255,.16); border-radius: 6px; padding: 2px 6px; color: #c8c0b2; font-size: .75rem; white-space: nowrap; }
	button { border: 0; border-radius: 12px; padding: 8px 12px; font: inherit; font-weight: 700; cursor: pointer; }
	button.secondary { background: rgba(255,255,255,.1); color: #f6f2ea; }
</style>
