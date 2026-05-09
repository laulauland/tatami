<script lang="ts">
	type Props = {
		projectName: string | null;
		busy?: boolean;
		onOpen: () => void;
	};

	const { projectName, busy = false, onOpen }: Props = $props();
</script>

<button
	type="button"
	class="trigger"
	disabled={busy}
	aria-label="Open repository"
	title={projectName ?? "Open repository"}
	onclick={onOpen}
>
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
	</svg>
	<span>{projectName ?? "Open Repository"}</span>
</button>

<style>
	.trigger {
		flex: 1;
		min-width: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		border: 0;
		border-radius: calc(var(--radius) - 2px);
		background: transparent;
		color: var(--foreground);
		font-size: 0.875rem;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition: background 120ms ease;
	}

	.trigger:hover:not(:disabled),
	.trigger:focus-visible {
		background: color-mix(in oklab, var(--accent) 14%, transparent);
		outline: none;
	}

	.trigger:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.trigger svg {
		flex-shrink: 0;
		color: var(--muted-foreground);
	}

	.trigger span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
