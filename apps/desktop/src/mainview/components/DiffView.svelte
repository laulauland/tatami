<script lang="ts">
	import { FileDiff, processPatch, type FileDiffOptions } from "@pierre/diffs";
	import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
	import "../../../node_modules/@pierre/diffs/dist/components/web-components.js";
	import { onMount } from "svelte";

	type DiffDisplayMode = "unified" | "split";

	type Props = {
		patch: string;
		displayMode?: DiffDisplayMode;
		large?: boolean;
	};

	let { patch, displayMode = "unified", large = false }: Props = $props();

	let containerElement: HTMLDivElement;
	let renderStatus = $state("Waiting to render fixture diff…");
	let workerStatus = $state("Worker pool not initialized");

	const createWorkerManager = (): {
		workerManager: WorkerPoolManager | undefined;
		unsubscribe: (() => void) | undefined;
	} => {
		try {
			const workerManager = getOrCreateWorkerPoolSingleton({
				poolOptions: {
					workerFactory: () =>
						new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
							type: "module",
						}),
					poolSize: 4,
				},
				highlighterOptions: {
					theme: { dark: "pierre-dark", light: "pierre-light" },
					lineDiffType: "word",
					maxLineDiffLength: 10_000,
					tokenizeMaxLineLength: 2_000,
					useTokenTransformer: true,
				},
			});
			const updateWorkerStatus = () => {
				const stats = workerManager.getStats();
				workerStatus = stats.workersFailed
					? "Worker pool failed after startup; rendered without highlighting"
					: `Worker pool ${stats.managerState} (${stats.totalWorkers} workers)`;
			};
			updateWorkerStatus();
			const unsubscribe = workerManager.subscribeToStatChanges(updateWorkerStatus);
			return { workerManager, unsubscribe };
		} catch (error) {
			workerStatus = `Worker pool unavailable; rendered without highlighting (${error instanceof Error ? error.message : String(error)})`;
			console.warn("@pierre/diffs worker pool failed; rendering without highlighting", error);
			return { workerManager: undefined, unsubscribe: undefined };
		}
	};

	onMount(() => {
		const { workerManager, unsubscribe } = createWorkerManager();
		const parsedPatch = processPatch(patch);
		const firstFile = parsedPatch.files[0];

		if (!firstFile) {
			renderStatus = "Patch parser returned no files.";
			return () => {
				unsubscribe?.();
			};
		}

		const options: FileDiffOptions = {
			diffStyle: displayMode,
			lineDiffType: "word",
			hunkSeparators: "line-info",
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType: "dark",
			overflow: displayMode === "split" ? "scroll" : "wrap",
			unsafeCSS: `
				:host {
					--diffs-background: transparent;
					color-scheme: dark;
				}

				.diffs-file,
				.diff-file,
				pre {
					background: transparent !important;
				}
			`,
		};

		const fileDiff = new FileDiff(options, workerManager, true);
		const startedAt = performance.now();
		fileDiff.render({
			fileDiff: firstFile,
			containerWrapper: containerElement,
		});
		const elapsedMs = Math.round(performance.now() - startedAt);
		renderStatus = `Rendered ${firstFile.name} (${displayMode}, ${large ? "large" : "moderate"} fixture) in ${elapsedMs}ms`;
		console.info("@pierre/diffs fixture rendered", {
			fileName: firstFile.name,
			displayMode,
			fixture: large ? "large" : "moderate",
			elapsedMs,
			workerStats: workerManager?.getStats(),
		});

		return () => {
			unsubscribe?.();
			fileDiff.cleanUp();
		};
	});
</script>

<div class="diff-view">
	<div class="diff-status" aria-live="polite">
		<span>{renderStatus}</span>
		<span>{workerStatus}</span>
	</div>
	<div bind:this={containerElement} class="diff-container" aria-label="Fixture text diff"></div>
</div>

<style>
	.diff-view {
		display: grid;
		gap: 12px;
	}

	.diff-status {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		color: #c8c0b2;
		font-size: 0.82rem;
	}

	.diff-status span {
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		padding: 5px 9px;
		background: rgba(255, 255, 255, 0.045);
	}

	.diff-container {
		min-height: 360px;
		max-height: 620px;
		overflow: auto;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.04);
	}
</style>
