<script lang="ts">
	import { laneColor, laneToX, NODE_RADIUS, ROW_HEIGHT } from "../../graph/constants.ts";
	import type { EdgeBinding } from "../../graph/types.ts";

	let {
		binding,
		sourceY,
		targetY,
	}: {
		binding: EdgeBinding;
		sourceY: number;
		targetY: number;
	} = $props();

	const sourceX = $derived(laneToX(binding.sourceLane));
	const targetX = $derived(laneToX(binding.targetLane));
	const sourceColor = $derived(laneColor(binding.sourceLane));
	const targetColor = $derived(laneColor(binding.targetLane));

	const isDashed = $derived(binding.edgeType === "indirect");
	const isDeemphasized = $derived(binding.isDeemphasized === true);
	const sameLane = $derived(binding.sourceLane === binding.targetLane);

	const stroke = $derived(
		isDeemphasized ? "var(--muted-foreground)" : sameLane ? sourceColor : targetColor,
	);
	const strokeWidth = $derived(isDeemphasized ? 1 : 2);
	const strokeOpacity = $derived(isDeemphasized ? 0.4 : 0.8);
	const strokeDasharray = $derived(isDashed ? "4 4" : undefined);

	const stubLength = ROW_HEIGHT * 0.4;

	const path = $derived.by(() => {
		if (sameLane) {
			return `M ${sourceX} ${sourceY + NODE_RADIUS} L ${targetX} ${targetY - NODE_RADIUS}`;
		}
		const goingRight = targetX > sourceX;
		const arcRadius = 10;
		return `M ${sourceX} ${sourceY + NODE_RADIUS} L ${targetX - arcRadius * (goingRight ? 1 : -1)} ${sourceY + NODE_RADIUS} Q ${targetX} ${sourceY + NODE_RADIUS} ${targetX} ${sourceY + NODE_RADIUS + arcRadius} L ${targetX} ${targetY - NODE_RADIUS}`;
	});
</script>

{#if binding.isMissingStub}
	<line
		x1={sourceX}
		y1={sourceY + NODE_RADIUS}
		x2={sourceX}
		y2={sourceY + NODE_RADIUS + stubLength}
		stroke={sourceColor}
		stroke-width="1.5"
		stroke-opacity="0.4"
		stroke-dasharray="3 3"
		stroke-linecap="round"
	/>
{:else}
	<path
		d={path}
		fill="none"
		stroke={stroke}
		stroke-width={strokeWidth}
		stroke-opacity={strokeOpacity}
		stroke-dasharray={strokeDasharray}
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
{/if}
