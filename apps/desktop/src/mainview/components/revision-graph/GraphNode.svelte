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
	const selectedRingRadius = $derived(isWorkingCopy ? NODE_RADIUS + 6 : NODE_RADIUS + 4);
</script>

<g>
	{#if isSelected}
		<circle cx={x} cy={y} r={selectedRingRadius} fill={color} fill-opacity="0.3" />
	{/if}
	{#if hasConflict}
		<circle
			cx={x}
			cy={y}
			r={NODE_RADIUS + 3}
			stroke="var(--destructive)"
			stroke-width="2"
			stroke-dasharray="3 2"
			fill="none"
		/>
	{/if}
	{#if isWorkingCopy}
		<circle cx={x} cy={y} r={NODE_RADIUS + 3} fill={color} fill-opacity="0.2" />
		<text
			x={x}
			y={y}
			text-anchor="middle"
			dominant-baseline="central"
			fill={color}
			font-weight="bold"
			font-size="12">@</text
		>
	{:else if isImmutable}
		<rect
			x={x - NODE_RADIUS}
			y={y - NODE_RADIUS}
			width={NODE_RADIUS * 2}
			height={NODE_RADIUS * 2}
			transform={`rotate(45 ${x} ${y})`}
			fill={color}
		/>
	{:else}
		<circle cx={x} cy={y} r={NODE_RADIUS} fill={color} />
	{/if}
</g>

<style>
	text {
		pointer-events: none;
		user-select: none;
	}
</style>
