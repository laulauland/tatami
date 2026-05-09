<script lang="ts">
	import { createVirtualizer } from "@tanstack/svelte-virtual";
	import { get } from "svelte/store";
	import { onDestroy, onMount } from "svelte";
	import { buildGraph } from "../../../components/revision-graph/build-graph";
	import { LANE_PADDING, LANE_WIDTH, ROW_HEIGHT } from "../../../components/revision-graph/constants";
	import type { RevisionStub } from "../../../../src-electrobun/shared/rpc.ts";
	import {
		getSelectedRevisionId,
		setSelectedRevisionId,
		syncSelectedRevisionFromLocation,
	} from "../../state/url.svelte.ts";
	import EdgeLayer from "./EdgeLayer.svelte";
	import RevisionRow from "./RevisionRow.svelte";

	let {
		revisions = [],
		mutationsDisabled = false,
		onselect,
		onnew,
		onedit,
		onabandon,
		ondescribe,
		onsquash,
		onrebase,
	}: {
		revisions?: RevisionStub[];
		mutationsDisabled?: boolean;
		onselect?: (revision: RevisionStub) => void;
		onnew?: (parentChangeIds: string[]) => void;
		onedit?: (changeId: string) => void;
		onabandon?: (changeId: string) => void;
		ondescribe?: (changeId: string, currentDescription: string) => void;
		onsquash?: (changeId: string) => void;
		onrebase?: (sourceChangeId: string) => void;
	} = $props();

	let scrollElement = $state<HTMLDivElement | null>(null);

	const graphData = $derived(buildGraph(revisions as Parameters<typeof buildGraph>[0]));
	const graphWidth = $derived(Math.max(64, graphData.laneCount * LANE_WIDTH + LANE_PADDING * 2));
	const commitToRow = $derived(new Map(graphData.rows.map((row, index) => [row.revision.commit_id, index])));
	const selectedRevisionId = $derived(getSelectedRevisionId());
	const selectedIndex = $derived(
		graphData.rows.findIndex((row) => row.revision.change_id === selectedRevisionId),
	);

	const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: 0,
		getScrollElement: () => scrollElement,
		estimateSize: () => ROW_HEIGHT,
		overscan: 5,
	});

	$effect(() => {
		get(virtualizer).setOptions({
			count: graphData.rows.length,
			getScrollElement: () => scrollElement,
			estimateSize: () => ROW_HEIGHT,
			overscan: 5,
		});
	});

	$effect(() => {
		if (graphData.rows.length === 0) {
			if (selectedRevisionId != null) setSelectedRevisionId(null);
			return;
		}
		if (selectedIndex === -1) {
			selectRevision(graphData.rows[0].revision as RevisionStub, false);
		}
	});

	const virtualItems = $derived($virtualizer.getVirtualItems());
	const totalHeight = $derived($virtualizer.getTotalSize());
	const visibleStartRow = $derived(virtualItems[0]?.index ?? 0);
	const visibleEndRow = $derived(virtualItems.at(-1)?.index ?? 0);

	function selectRevision(revision: RevisionStub, scrollIntoView = true): void {
		setSelectedRevisionId(revision.change_id);
		onselect?.(revision);
		if (scrollIntoView) {
			const index = graphData.rows.findIndex((row) => row.revision.change_id === revision.change_id);
			if (index >= 0) $virtualizer.scrollToIndex(index, { align: "auto" });
		}
	}

	function selectIndex(index: number): void {
		const row = graphData.rows[Math.max(0, Math.min(index, graphData.rows.length - 1))];
		if (row) selectRevision(row.revision as RevisionStub);
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (graphData.rows.length === 0) return;
		const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			selectIndex(currentIndex + 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			selectIndex(currentIndex - 1);
		} else if (event.key === "Home") {
			event.preventDefault();
			selectIndex(0);
		} else if (event.key === "End") {
			event.preventDefault();
			selectIndex(graphData.rows.length - 1);
		}
	}

	onMount(() => {
		window.addEventListener("popstate", syncSelectedRevisionFromLocation);
	});

	onDestroy(() => {
		window.removeEventListener("popstate", syncSelectedRevisionFromLocation);
	});
</script>

<div class="revision-graph" bind:this={scrollElement} tabindex="0" role="listbox" onkeydown={handleKeydown}>
	{#if graphData.rows.length === 0}
		<p class="empty">No revisions loaded.</p>
	{:else}
		<div class="spacer" style:height={`${totalHeight}px`}>
			<EdgeLayer
				edgeIntervalIndex={graphData.edgeIntervalIndex}
				{commitToRow}
				{visibleStartRow}
				{visibleEndRow}
				{totalHeight}
				{graphWidth}
			/>
			{#each virtualItems as virtualRow (virtualRow.key)}
				{@const row = graphData.rows[virtualRow.index]}
				{#if row}
					<div
						class="virtual-row"
						style:height={`${virtualRow.size}px`}
						style:transform={`translateY(${virtualRow.start}px)`}
					>
						<RevisionRow
							revision={row.revision as RevisionStub}
							lane={row.lane}
							{graphWidth}
							isSelected={row.revision.change_id === selectedRevisionId}
							{mutationsDisabled}
							onselect={selectRevision}
							onnew={onnew}
							onedit={onedit}
							onabandon={onabandon}
							ondescribe={ondescribe}
							onsquash={onsquash}
							onrebase={onrebase}
						/>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.revision-graph {
		min-height: 320px;
		max-height: 70vh;
		overflow: auto;
		border: 1px solid rgba(255, 255, 255, 0.09);
		border-radius: 16px;
		background: rgba(255, 255, 255, 0.035);
		outline: none;
	}

	.revision-graph:focus-visible {
		box-shadow: 0 0 0 2px rgba(119, 114, 255, 0.45);
	}

	.spacer {
		position: relative;
		min-width: 620px;
	}

	.virtual-row {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 1;
	}

	.empty {
		margin: 0;
		padding: 18px;
		color: #c8c0b2;
	}
</style>
