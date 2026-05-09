<script lang="ts">
	type ActionGroup = "repository" | "tools" | "appearance" | "app";
	type PaletteAction = {
		id: string;
		label: string;
		keywords: string[];
		group: ActionGroup;
		onSelect: () => void;
		disabled?: boolean;
		shortcut?: string;
	};

	type Props = {
		open: boolean;
		canOpenOperationsLog?: boolean;
		onClose: () => void;
		onOpenRepo: () => void;
		onOpenRepositories: () => void;
		onOpenSettings: () => void;
		onOpenOperationsLog: () => void;
		onOpenShortcuts: () => void;
	};

	let { open = $bindable(false), canOpenOperationsLog = false, onClose, onOpenRepo, onOpenRepositories, onOpenSettings, onOpenOperationsLog, onOpenShortcuts }: Props = $props();
	let searchText = $state("");
	let selectedIndex = $state(0);
	let theme = $state(localStorage.getItem("tatami-theme") ?? "system");

	const actions = $derived<PaletteAction[]>([
		{ id: "open-repo", label: "Add a repository…", keywords: ["add", "repository", "open", "folder"], group: "repository", onSelect: onOpenRepo },
		{ id: "open-repositories", label: "Manage repositories…", keywords: ["manage", "repositories", "projects"], group: "repository", onSelect: onOpenRepositories },
		{ id: "open-operations", label: "Open operations log", keywords: ["operations", "log", "history", "undo"], group: "tools", onSelect: onOpenOperationsLog, disabled: !canOpenOperationsLog },
		{ id: "theme-light", label: "Theme: Light", keywords: ["theme", "appearance", "light"], group: "appearance", onSelect: () => setTheme("light"), disabled: theme === "light" },
		{ id: "theme-dark", label: "Theme: Dark", keywords: ["theme", "appearance", "dark"], group: "appearance", onSelect: () => setTheme("dark"), disabled: theme === "dark" },
		{ id: "theme-system", label: "Theme: System", keywords: ["theme", "appearance", "system"], group: "appearance", onSelect: () => setTheme("system"), disabled: theme === "system" },
		{ id: "open-settings", label: "Settings", keywords: ["settings", "preferences", "config"], group: "app", onSelect: onOpenSettings, shortcut: "⌘ ," },
		{ id: "open-shortcuts", label: "Keyboard shortcuts", keywords: ["keyboard", "shortcuts", "help"], group: "app", onSelect: onOpenShortcuts, shortcut: "?" },
	]);
	const filteredActions = $derived.by(() => {
		const query = searchText.trim().toLowerCase();
		if (!query) return actions;
		return actions.filter((action) => `${action.label} ${action.keywords.join(" ")}`.toLowerCase().includes(query));
	});
	const groups: [ActionGroup, string][] = [["repository", "Repository"], ["tools", "Tools"], ["appearance", "Appearance"], ["app", "App"]];

	$effect(() => {
		if (open) {
			searchText = "";
			selectedIndex = 0;
		}
	});

	function setTheme(nextTheme: string): void {
		theme = nextTheme;
		localStorage.setItem("tatami-theme", nextTheme);
		document.documentElement.dataset.theme = nextTheme;
	}

	function select(action: PaletteAction): void {
		if (action.disabled) return;
		action.onSelect();
		onClose();
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, Math.max(0, filteredActions.length - 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex = Math.max(0, selectedIndex - 1);
		} else if (event.key === "Enter") {
			event.preventDefault();
			const action = filteredActions[selectedIndex];
			if (action) select(action);
		}
	}
</script>

{#if open}
	<div class="modal-backdrop" role="presentation" onclick={onClose}>
		<section class="dialog" role="dialog" aria-modal="true" aria-label="Command palette" onclick={(event) => event.stopPropagation()}>
			<input autofocus class="dialog-input" placeholder="Search actions..." bind:value={searchText} onkeydown={handleKeydown} />
			<div class="action-list">
				{#each groups as [group, heading]}
					{@const groupActions = filteredActions.filter((action) => action.group === group)}
					{#if groupActions.length > 0}
						<p class="group-heading">{heading}</p>
						{#each groupActions as action (action.id)}
							{@const flatIndex = filteredActions.findIndex((candidate) => candidate.id === action.id)}
							<button type="button" class="action" class:selected={flatIndex === selectedIndex} disabled={action.disabled} onmouseenter={() => selectedIndex = flatIndex} onclick={() => select(action)}>
								<span>{action.label}</span>
								{#if action.shortcut}<kbd>{action.shortcut}</kbd>{/if}
							</button>
						{/each}
					{/if}
				{/each}
				{#if filteredActions.length === 0}<p class="empty">No actions found.</p>{/if}
			</div>
		</section>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: start center;
		padding-top: 12vh;
		background: color-mix(in oklab, var(--background) 60%, rgb(0 0 0 / 50%));
	}
	.dialog {
		width: min(640px, calc(100vw - 32px));
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}
	.dialog-input {
		width: 100%;
		box-sizing: border-box;
		border: 0;
		border-bottom: 1px solid var(--border);
		padding: 12px 14px;
		background: transparent;
		color: inherit;
		font: inherit;
		outline: none;
	}
	.action-list { max-height: 420px; overflow: auto; padding: 6px; }
	.group-heading, .empty {
		margin: 8px 8px 6px;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.action {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 10px;
		border: 0;
		border-radius: calc(var(--radius) - 4px);
		background: transparent;
		color: inherit;
		text-align: left;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
	}
	.action.selected, .action:hover:not(:disabled) {
		background: color-mix(in oklab, var(--accent) 18%, transparent);
	}
	.action:disabled { opacity: 0.45; cursor: not-allowed; }
	kbd {
		border: 1px solid var(--border);
		border-radius: calc(var(--radius) - 4px);
		padding: 2px 6px;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 0.72rem;
	}
</style>
