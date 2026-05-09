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
		if (graphData.rows.length === 0) return;
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

	export function focus(): void {
		scrollElement?.focus();
	}

	export function jumpTo(changeId: string): void {
		const revision = revisions.find((candidate) => candidate.change_id === changeId);
		if (revision) selectRevision(revision);
	}

	function selectWorkingCopy(): void {
		const index = graphData.rows.findIndex((row) => row.revision.is_working_copy);
		if (index >= 0) selectIndex(index);
	}

	function selectParentOrChild(direction: "parent" | "child"): void {
		const row = graphData.rows[selectedIndex >= 0 ? selectedIndex : 0];
		if (!row) return;
		const targetCommitId = direction === "parent"
			? row.revision.parent_edges.find((edge) => edge.edge_type !== "missing")?.parent_id
			: row.revision.children_ids[0];
		if (targetCommitId == null) return;
		const targetIndex = commitToRow.get(targetCommitId);
		if (targetIndex != null) selectIndex(targetIndex);
	}

	let gPressedAt = 0;
	function handleKeydown(event: KeyboardEvent): void {
		if (graphData.rows.length === 0) return;
		const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
		if (event.key === "ArrowDown" || event.key === "j") {
			event.preventDefault();
			selectIndex(currentIndex + 1);
		} else if (event.key === "ArrowUp" || event.key === "k") {
			event.preventDefault();
			selectIndex(currentIndex - 1);
		} else if (event.key === "Home") {
			event.preventDefault();
			selectIndex(0);
		} else if (event.key === "End" || event.key === "G") {
			event.preventDefault();
			selectIndex(graphData.rows.length - 1);
		} else if (event.key === "@") {
			event.preventDefault();
			selectWorkingCopy();
		} else if (event.key === "-" || event.key === "J") {
			event.preventDefault();
			selectParentOrChild("parent");
		} else if (event.key === "+" || event.key === "=" || event.key === "K") {
			event.preventDefault();
			selectParentOrChild("child");
		} else if (event.key === "g") {
			const now = Date.now();
			if (now - gPressedAt < 500) {
				event.preventDefault();
				selectIndex(0);
				gPressedAt = 0;
			} else {
				gPressedAt = now;
			}
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
