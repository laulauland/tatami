<script lang="ts">
	import type { RevisionStub } from "../../../../src-electrobun/shared/rpc.ts";
	import { LANE_PADDING, LANE_WIDTH, ROW_HEIGHT } from "../../graph/constants.ts";
	import BookmarkTag from "./BookmarkTag.svelte";
	import GraphNode from "./GraphNode.svelte";

	let {
		revision,
		lane,
		graphWidth,
		isSelected = false,
		isPendingAbandon = false,
		mutationsDisabled: _mutationsDisabled = false,
		onselect,
		onnew: _onnew,
		onedit: _onedit,
		onabandon: _onabandon,
		ondescribe: _ondescribe,
		onsquash: _onsquash,
		onrebase: _onrebase,
	}: {
		revision: RevisionStub;
		lane: number;
		graphWidth: number;
		isSelected?: boolean;
		isPendingAbandon?: boolean;
		mutationsDisabled?: boolean;
		onselect?: (revision: RevisionStub) => void;
		onnew?: (parentChangeIds: string[]) => void;
		onedit?: (changeId: string) => void;
		onabandon?: (changeId: string) => void;
		ondescribe?: (changeId: string, currentDescription: string) => void;
		onsquash?: (changeId: string) => void;
		onrebase?: (sourceChangeId: string) => void;
	} = $props();

	const description = $derived(revision.description.trim() || "(no description)");
	const firstLine = $derived(description.split("\n", 1)[0] ?? description);
	const nodeWidth = $derived(Math.max(graphWidth, LANE_PADDING * 2 + LANE_WIDTH));
	const authorShort = $derived(revision.author.split("@")[0] ?? revision.author);
</script>

<div
	class="revision-row"
	class:selected={isSelected}
	class:immutable={revision.is_immutable}
	style:height={`${ROW_HEIGHT}px`}
	role="option"
	aria-selected={isSelected}
	tabindex="-1"
	onclick={() => onselect?.(revision)}
	onkeydown={(event) => {
		if (event.key === "Enter" || event.key === " ") onselect?.(revision);
	}}
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

	<div class="content">
		<div class="content-inner" class:blurred={isPendingAbandon}>
			<div class="meta-row">
				<code class="change-id">
					{revision.change_id_short}
					{#if revision.has_conflict}<span class="conflict-badge">Conflicts</span>{/if}
				</code>
				<div class="bookmarks">
					{#each revision.bookmarks as bookmark (`${bookmark.name}:${bookmark.remote ?? "local"}`)}
						<BookmarkTag {bookmark} />
					{/each}
				</div>
				<span class="author-time">{authorShort} · {revision.timestamp}</span>
			</div>
			<div class="description">{firstLine}</div>
		</div>
		{#if isPendingAbandon}
			<div class="abandon-overlay" role="alert">
				<span>Abandon this revision? <kbd>Y</kbd> / <kbd>N</kbd></span>
			</div>
		{/if}
	</div>
</div>

<style>
	.revision-row {
		display: flex;
		align-items: stretch;
		width: 100%;
		border: 0;
		border-radius: 0;
		padding: 0;
		background: transparent;
		color: var(--foreground);
		font: inherit;
		text-align: left;
		cursor: pointer;
		user-select: none;
	}

	.revision-row.immutable {
		opacity: 0.6;
	}

	.node-cell {
		position: relative;
		z-index: 1;
		flex: 0 0 auto;
	}

	.content {
		position: relative;
		flex: 1;
		min-width: 0;
		margin-right: 8px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 6px 12px;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 30%, transparent);
		border-radius: calc(var(--radius) - 2px);
		color: var(--card-foreground);
		overflow: hidden;
	}

	.content-inner {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.content-inner.blurred {
		filter: blur(2px);
	}

	.revision-row.selected .content {
		background: color-mix(in oklab, var(--accent) 40%, transparent);
		border-bottom-color: transparent;
	}

	.abandon-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background: color-mix(in oklab, var(--destructive) 80%, transparent);
		color: var(--destructive-foreground);
		font-size: 0.85rem;
		font-weight: 500;
		border-radius: calc(var(--radius) - 2px);
	}

	.abandon-overlay kbd {
		display: inline-flex;
		align-items: center;
		border: 1px solid color-mix(in oklab, var(--destructive-foreground) 40%, transparent);
		border-radius: calc(var(--radius) - 4px);
		padding: 1px 5px;
		background: color-mix(in oklab, var(--destructive-foreground) 12%, transparent);
		color: var(--destructive-foreground);
		font: inherit;
		font-size: 0.78em;
	}

	.meta-row {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: 8px;
		min-width: 0;
		height: 20px;
	}

	.change-id {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		padding: 0 2px;
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.conflict-badge {
		display: inline-flex;
		align-items: center;
		height: 16px;
		padding: 0 4px;
		margin-left: 4px;
		border-radius: calc(var(--radius) - 4px);
		background: var(--destructive);
		color: var(--destructive-foreground);
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1;
	}

	.bookmarks {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		overflow: hidden;
	}

	.author-time {
		justify-self: end;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--muted-foreground);
		font-size: 0.72rem;
	}

	.description {
		margin-top: 2px;
		font-size: 0.85rem;
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
