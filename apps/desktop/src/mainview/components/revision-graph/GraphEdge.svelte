<script lang="ts">
	import { laneColor, laneToX } from "../../graph/constants.ts";
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
	const stroke = $derived(laneColor(binding.sourceLane));
	const opacity = $derived(binding.isDeemphasized ? 0.32 : 0.78);
	const dash = $derived(
		binding.edgeType === "missing" ? "2 4" : binding.edgeType === "indirect" ? "6 5" : undefined,
	);
	const path = $derived.by(() => {
		if (binding.isMissingStub) {
			return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
		}
		if (sourceX === targetX) {
			return `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
		}
		const midY = sourceY + Math.min(18, Math.abs(targetY - sourceY) / 2);
		return `M ${sourceX} ${sourceY} C ${sourceX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
	});
</script>

<path
	d={path}
	fill="none"
	stroke={stroke}
	stroke-width={binding.isDeemphasized ? 1.5 : 2}
	stroke-opacity={opacity}
	stroke-dasharray={dash}
	stroke-linecap="round"
	stroke-linejoin="round"
/>
