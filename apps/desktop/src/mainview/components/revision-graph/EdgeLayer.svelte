<script lang="ts">
	import { queryEdgeIntervalIndex } from "../../graph/utils.ts";
	import { ROW_HEIGHT } from "../../graph/constants.ts";
	import type { EdgeIntervalIndex } from "../../graph/types.ts";
	import GraphEdge from "./GraphEdge.svelte";

	let {
		edgeIntervalIndex,
		commitToRow,
		visibleStartRow,
		visibleEndRow,
		totalHeight,
		graphWidth,
	}: {
		edgeIntervalIndex: EdgeIntervalIndex;
		commitToRow: Map<string, number>;
		visibleStartRow: number;
		visibleEndRow: number;
		totalHeight: number;
		graphWidth: number;
	} = $props();

	const edges = $derived(
		queryEdgeIntervalIndex(
			edgeIntervalIndex,
			Math.max(0, visibleStartRow - 15),
			visibleEndRow + 15,
		),
	);

	function rowCenter(row: number): number {
		return row * ROW_HEIGHT + ROW_HEIGHT / 2;
	}

	function sourceY(commitId: string): number {
		return rowCenter(commitToRow.get(commitId) ?? 0);
	}

	function targetY(commitId: string, fallbackSourceY: number): number {
		if (commitId.length === 0) return fallbackSourceY + ROW_HEIGHT * 0.72;
		return rowCenter(commitToRow.get(commitId) ?? 0);
	}
</script>

<svg
	class="edge-layer"
	width={graphWidth}
	height={totalHeight}
	viewBox={`0 0 ${graphWidth} ${Math.max(totalHeight, 1)}`}
	aria-hidden="true"
>
	{#each edges as edge (edge.id)}
		{@const y1 = sourceY(edge.sourceRevisionId)}
		<GraphEdge binding={edge} sourceY={y1} targetY={targetY(edge.targetRevisionId, y1)} />
	{/each}
</svg>

<style>
	.edge-layer {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 0;
		pointer-events: none;
		overflow: visible;
	}
</style>
