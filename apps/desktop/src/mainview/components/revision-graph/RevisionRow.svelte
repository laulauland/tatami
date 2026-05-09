<script lang="ts">
	import type { RevisionStub } from "../../../../src-electrobun/shared/rpc.ts";
	import { LANE_PADDING, LANE_WIDTH, ROW_HEIGHT } from "../../../components/revision-graph/constants";
	import BookmarkTag from "./BookmarkTag.svelte";
	import GraphNode from "./GraphNode.svelte";

	let {
		revision,
		lane,
		graphWidth,
		isSelected = false,
		onselect,
	}: {
		revision: RevisionStub;
		lane: number;
		graphWidth: number;
		isSelected?: boolean;
		onselect?: (revision: RevisionStub) => void;
	} = $props();

	const description = $derived(revision.description.trim() || "(no description)");
	const firstLine = $derived(description.split("\n", 1)[0] ?? description);
	const shortCommit = $derived(revision.commit_id.slice(0, 12));
	const nodeWidth = $derived(Math.max(graphWidth, LANE_PADDING * 2 + LANE_WIDTH));
</script>

<button
	type="button"
	class="revision-row"
	class:selected={isSelected}
	style:height={`${ROW_HEIGHT}px`}
	onclick={() => onselect?.(revision)}
>
	<svg class="node-cell" width={nodeWidth} height={ROW_HEIGHT} aria-hidden="true">
		<GraphNode
			{lane}
			isWorkingCopy={revision.is_working_copy}
			isImmutable={revision.is_immutable}
			hasConflict={revision.has_conflict}
			{isSelected}
		/>
	</svg>

	<div class="metadata">
		<div class="summary">
			<strong>{firstLine}</strong>
			<div class="badges">
				{#if revision.is_working_copy}<span class="pill wc">working copy</span>{/if}
				{#if revision.has_conflict}<span class="pill conflict">conflict</span>{/if}
				{#if revision.is_immutable}<span class="pill">immutable</span>{/if}
			</div>
		</div>
		<div class="details">
			<span>{revision.author}</span>
			<span>{revision.timestamp}</span>
			<code>{revision.change_id_short}:{shortCommit}</code>
		</div>
		{#if revision.bookmarks.length > 0}
			<div class="bookmarks">
				{#each revision.bookmarks as bookmark (`${bookmark.name}:${bookmark.remote ?? "local"}`)}
					<BookmarkTag {bookmark} />
				{/each}
			</div>
		{/if}
	</div>
</button>

<style>
	.revision-row {
		display: flex;
		align-items: stretch;
		width: 100%;
		border: 0;
		border-radius: 0;
		padding: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.revision-row:hover,
	.revision-row:focus-visible {
		background: rgba(255, 255, 255, 0.045);
		outline: none;
	}

	.revision-row.selected {
		background: rgba(119, 114, 255, 0.16);
	}

	.node-cell {
		position: relative;
		z-index: 1;
		flex: 0 0 auto;
	}

	.metadata {
		position: relative;
		z-index: 1;
		display: grid;
		align-content: center;
		min-width: 0;
		padding: 8px 14px 8px 6px;
		gap: 4px;
		flex: 1 1 auto;
	}

	.summary,
	.details,
	.bookmarks,
	.badges {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.summary strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.94rem;
	}

	.details {
		color: #b8b3a7;
		font-size: 0.78rem;
	}

	.details span,
	.details code {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.details code {
		color: #c9c4ff;
	}

	.bookmarks {
		flex-wrap: wrap;
	}

	.pill {
		border-radius: 999px;
		padding: 2px 7px;
		background: rgba(255, 255, 255, 0.08);
		color: #c8c0b2;
		font-size: 0.68rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.pill.wc {
		background: rgba(119, 114, 255, 0.2);
		color: #d7d3ff;
	}

	.pill.conflict {
		background: rgba(255, 180, 168, 0.13);
		color: #ffb4a8;
	}
</style>
