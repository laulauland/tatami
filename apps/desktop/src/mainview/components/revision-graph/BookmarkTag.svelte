<script lang="ts">
	import type { BookmarkInfo } from "../../../../src-electrobun/shared/rpc.ts";

	let { bookmark }: { bookmark: BookmarkInfo } = $props();

	const status = $derived(
		[
			bookmark.is_ahead ? "↑" : "",
			bookmark.is_behind ? "↓" : "",
			bookmark.is_conflicted ? "!" : "",
		]
			.filter(Boolean)
			.join(""),
	);
</script>

<span class:remote={bookmark.remote != null} class:conflicted={bookmark.is_conflicted}>
	{bookmark.name}{#if bookmark.remote}@{bookmark.remote}{/if}{#if status}<small>{status}</small>{/if}
</span>

<style>
	span {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		max-width: 220px;
		height: 16px;
		padding: 0 6px;
		border: 1px solid color-mix(in oklab, var(--primary) 40%, transparent);
		border-radius: calc(var(--radius) - 4px);
		background: color-mix(in oklab, var(--primary) 14%, transparent);
		color: var(--primary);
		font-size: 0.68rem;
		line-height: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.remote {
		border-color: var(--border);
		background: var(--muted);
		color: var(--muted-foreground);
	}

	.conflicted {
		border-color: color-mix(in oklab, var(--destructive) 50%, transparent);
		color: var(--destructive);
	}

	small {
		font-size: 0.62rem;
		opacity: 0.9;
	}
</style>
