<script lang="ts">
	import { laneColor, laneToX, NODE_RADIUS, ROW_HEIGHT } from "../../graph/constants.ts";

	let {
		lane,
		isWorkingCopy = false,
		isImmutable = false,
		hasConflict = false,
		isSelected = false,
	}: {
		lane: number;
		isWorkingCopy?: boolean;
		isImmutable?: boolean;
		hasConflict?: boolean;
		isSelected?: boolean;
	} = $props();

	const x = $derived(laneToX(lane));
	const y = ROW_HEIGHT / 2;
	const color = $derived(laneColor(lane));
</script>

<g class:selected={isSelected} class:conflict={hasConflict}>
	{#if isImmutable}
		<rect
			x={x - NODE_RADIUS}
			y={y - NODE_RADIUS}
			width={NODE_RADIUS * 2}
			height={NODE_RADIUS * 2}
			transform={`rotate(45 ${x} ${y})`}
			fill={isWorkingCopy ? color : "#101116"}
			stroke={color}
			stroke-width={isSelected ? 3 : 2}
		/>
	{:else}
		<circle
			cx={x}
			cy={y}
			r={isSelected ? NODE_RADIUS + 1 : NODE_RADIUS}
			fill={isWorkingCopy ? color : "#101116"}
			stroke={hasConflict ? "#ffb4a8" : color}
			stroke-width={isSelected ? 3 : 2}
		/>
	{/if}
	{#if isWorkingCopy}
		<text x={x} y={y - 10} text-anchor="middle" aria-hidden="true">@</text>
	{/if}
</g>

<style>
	text {
		fill: #ece5d8;
		font-size: 11px;
		font-weight: 800;
	}

	.selected {
		filter: drop-shadow(0 0 6px rgba(236, 229, 216, 0.45));
	}
</style>
