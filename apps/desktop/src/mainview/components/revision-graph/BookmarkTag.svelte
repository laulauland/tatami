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
		gap: 4px;
		max-width: 220px;
		border: 1px solid rgba(119, 114, 255, 0.35);
		border-radius: 999px;
		padding: 2px 7px;
		background: rgba(119, 114, 255, 0.12);
		color: #d7d3ff;
		font-size: 0.72rem;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.remote {
		border-color: rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.07);
		color: #c8c0b2;
	}

	.conflicted {
		border-color: rgba(255, 180, 168, 0.45);
		color: #ffb4a8;
	}

	small {
		font-size: 0.68rem;
		opacity: 0.9;
	}
</style>
