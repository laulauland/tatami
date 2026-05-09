<script lang="ts">
	import type { Project } from "../../../src-electrobun/shared/rpc.ts";

	type Props = {
		projects: readonly Project[];
		activeProjectId: string | null;
		busy?: boolean;
		onAdd: () => void | Promise<void>;
		onSelect: (project: Project) => void | Promise<void>;
		onRemove: (project: Project) => void | Promise<void>;
	};

	const { projects, activeProjectId, busy = false, onAdd, onSelect, onRemove }: Props = $props();

	const activeProject = $derived(projects.find((project) => project.id === activeProjectId) ?? null);
</script>

<div class="project-picker" aria-label="Repository picker">
	<label>
		<span>Repository</span>
		<select
			value={activeProjectId ?? ""}
			disabled={busy || projects.length === 0}
			onchange={(event) => {
				const selectedId = event.currentTarget.value;
				const selectedProject = projects.find((project) => project.id === selectedId);
				if (selectedProject) void onSelect(selectedProject);
			}}
		>
			<option value="" disabled>{projects.length === 0 ? "No repositories" : "Select repository"}</option>
			{#each projects as project}
				<option value={project.id}>{project.name}</option>
			{/each}
		</select>
	</label>

	{#if activeProject}
		<p title={activeProject.path}>{activeProject.path}</p>
	{/if}

	<div class="actions">
		<button type="button" disabled={busy} onclick={() => void onAdd()}>Add repository</button>
		{#if activeProject}
			<button
				type="button"
				class="secondary"
				disabled={busy}
				title={`Remove ${activeProject.name}`}
				onclick={() => void onRemove(activeProject)}
			>
				Remove
			</button>
		{/if}
	</div>
</div>

<style>
	.project-picker {
		display: grid;
		min-width: min(420px, 100%);
		gap: 8px;
		justify-items: end;
	}

	label,
	.actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	span {
		color: #b8b3a7;
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	select {
		max-width: 220px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 12px;
		padding: 9px 12px;
		background: rgba(255, 255, 255, 0.08);
		color: #f6f2ea;
		font: inherit;
	}

	p {
		max-width: 420px;
		margin: 0;
		overflow: hidden;
		color: #c8c0b2;
		font-size: 0.82rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	button {
		border: 0;
		border-radius: 12px;
		padding: 9px 12px;
		background: #ece5d8;
		color: #15151d;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	button.secondary {
		background: rgba(255, 255, 255, 0.1);
		color: #f6f2ea;
	}

	button:disabled,
	select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
