<script lang="ts">
	import { FileTree, type FileTreeIcons, type FileTreeInitialExpansion } from "@pierre/trees";
	import { onMount } from "svelte";

	/**
	 * Svelte lifecycle wrapper for the vanilla @pierre/trees FileTree runtime.
	 *
	 * Theming:
	 * - @pierre/trees renders into its own tree container and accepts `unsafeCSS` for
	 *   tree-local CSS. Use CSS custom properties there when mapping Tatami themes.
	 * - Later, `themeToTreeStyles()` from @pierre/trees can convert editor-style
	 *   theme objects into tree styles.
	 *
	 * Icons:
	 * - Pass `icons="minimal" | "standard" | "complete"`, or an icon config object
	 *   with `set`, `colored`, and extension/name remaps.
	 *
	 * Future git status integration:
	 * - Once real changed-file data is wired, keep the FileTree instance and call
	 *   `fileTree.setGitStatus([...])` from the diff/repo status boundary.
	 */
	type Props = {
		paths: readonly string[];
		icons?: FileTreeIcons;
		initialExpansion?: FileTreeInitialExpansion;
		onSelectionChange?: (paths: readonly string[]) => void;
	};

	let {
		paths,
		icons = { set: "standard", colored: true },
		initialExpansion = "open",
		onSelectionChange,
	}: Props = $props();

	let containerElement: HTMLDivElement;
	let selectedPaths = $state<readonly string[]>([]);

	onMount(() => {
		const fileTree = new FileTree({
			paths,
			icons,
			initialExpansion,
			search: true,
			unsafeCSS: `
				:host {
					--file-tree-background: transparent;
					--file-tree-foreground: #f6f2ea;
					--file-tree-muted-foreground: #b8b3a7;
					--file-tree-accent: rgba(119, 114, 255, 0.28);
					--file-tree-border: rgba(255, 255, 255, 0.1);
				}
			`,
			onSelectionChange: (nextSelectedPaths) => {
				selectedPaths = [...nextSelectedPaths];
				onSelectionChange?.(nextSelectedPaths);
			},
		});

		fileTree.render({ fileTreeContainer: containerElement });

		return () => {
			fileTree.unmount();
			fileTree.cleanUp();
		};
	});
</script>

<div class="file-tree-view">
	<div bind:this={containerElement} class="file-tree-container" aria-label="Fixture file tree"></div>
	{#if selectedPaths.length > 0}
		<p class="selection-summary">Selected in wrapper: {selectedPaths.join(", ")}</p>
	{/if}
</div>

<style>
	.file-tree-view {
		display: grid;
		gap: 12px;
	}

	.file-tree-container {
		min-height: 320px;
		max-height: 420px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.04);
	}

	.selection-summary {
		margin: 0;
		color: #c8c0b2;
		font-size: 0.85rem;
	}
</style>
