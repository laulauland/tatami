import {
	Folder,
	History,
	Laptop,
	Moon,
	Settings,
	SlidersHorizontal,
	Sun,
	type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { useTheme } from "@/hooks/useTheme";

interface CommandPaletteProps {
	onOpenRepo: () => void;
	onOpenProjects: () => void;
	onOpenSettings: () => void;
	canOpenOperationsLog?: boolean;
	onOpenOperationsLog?: () => void;
}

interface PaletteAction {
	id: string;
	label: string;
	keywords: string[];
	icon: LucideIcon;
	onSelect: () => void;
	disabled?: boolean;
	shortcut?: string;
	group: "repository" | "tools" | "appearance" | "app";
}

export function CommandPalette({
	onOpenRepo,
	onOpenProjects,
	onOpenSettings,
	canOpenOperationsLog = false,
	onOpenOperationsLog,
}: CommandPaletteProps) {
	const [open, setOpen] = useState(false);
	const { theme, setTheme } = useTheme();

	useKeyboardShortcut({
		key: "k",
		modifiers: { meta: true, ctrl: true },
		onPress: () => setOpen((prevOpen) => !prevOpen),
	});

	function select(handler: () => void) {
		handler();
		setOpen(false);
	}

	const actions = useMemo<PaletteAction[]>(() => {
		const baseActions: PaletteAction[] = [
			{
				id: "open-repo",
				label: "Add a repository...",
				keywords: ["add", "repository", "open", "folder"],
				icon: Folder,
				onSelect: onOpenRepo,
				group: "repository",
			},
			{
				id: "open-projects",
				label: "Manage repositories...",
				keywords: ["manage", "repositories", "projects"],
				icon: Settings,
				onSelect: onOpenProjects,
				group: "repository",
			},
			{
				id: "open-settings",
				label: "Settings",
				keywords: ["settings", "preferences", "config"],
				icon: SlidersHorizontal,
				onSelect: onOpenSettings,
				shortcut: "⌘ ,",
				group: "app",
			},
		];

		if (onOpenOperationsLog) {
			baseActions.push({
				id: "open-operations-log",
				label: "Open operations log",
				keywords: ["operations", "log", "history", "undo"],
				icon: History,
				onSelect: onOpenOperationsLog,
				disabled: !canOpenOperationsLog,
				group: "tools",
			});
		}

		baseActions.push(
			{
				id: "theme-light",
				label: "Theme: Light",
				keywords: ["theme", "appearance", "light", "color"],
				icon: Sun,
				onSelect: () => setTheme("light"),
				disabled: theme === "light",
				group: "appearance",
			},
			{
				id: "theme-dark",
				label: "Theme: Dark",
				keywords: ["theme", "appearance", "dark", "color"],
				icon: Moon,
				onSelect: () => setTheme("dark"),
				disabled: theme === "dark",
				group: "appearance",
			},
			{
				id: "theme-system",
				label: "Theme: System",
				keywords: ["theme", "appearance", "system", "auto", "color"],
				icon: Laptop,
				onSelect: () => setTheme("system"),
				disabled: theme === "system",
				group: "appearance",
			},
		);

		return baseActions;
	}, [
		canOpenOperationsLog,
		onOpenOperationsLog,
		onOpenProjects,
		onOpenRepo,
		onOpenSettings,
		setTheme,
		theme,
	]);

	const repoActions = actions.filter((a) => a.group === "repository");
	const toolsActions = actions.filter((a) => a.group === "tools");
	const appearanceActions = actions.filter((a) => a.group === "appearance");
	const appActions = actions.filter((a) => a.group === "app");

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder="Search actions..." />
			<CommandList>
				<CommandEmpty>No actions found.</CommandEmpty>
				{repoActions.length > 0 && (
					<CommandGroup heading="Repository">
						{repoActions.map((action) => (
							<CommandItem
								key={action.id}
								onSelect={() => select(action.onSelect)}
								keywords={action.keywords}
								disabled={action.disabled}
							>
								<action.icon className="mr-2 h-4 w-4" />
								<span>{action.label}</span>
								{action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{toolsActions.length > 0 && (
					<CommandGroup heading="Tools">
						{toolsActions.map((action) => (
							<CommandItem
								key={action.id}
								onSelect={() => select(action.onSelect)}
								keywords={action.keywords}
								disabled={action.disabled}
							>
								<action.icon className="mr-2 h-4 w-4" />
								<span>{action.label}</span>
								{action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{appearanceActions.length > 0 && (
					<CommandGroup heading="Appearance">
						{appearanceActions.map((action) => (
							<CommandItem
								key={action.id}
								onSelect={() => select(action.onSelect)}
								keywords={action.keywords}
								disabled={action.disabled}
							>
								<action.icon className="mr-2 h-4 w-4" />
								<span>{action.label}</span>
								{action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}
				{appActions.length > 0 && (
					<CommandGroup heading="App">
						{appActions.map((action) => (
							<CommandItem
								key={action.id}
								onSelect={() => select(action.onSelect)}
								keywords={action.keywords}
								disabled={action.disabled}
							>
								<action.icon className="mr-2 h-4 w-4" />
								<span>{action.label}</span>
								{action.shortcut && <CommandShortcut>{action.shortcut}</CommandShortcut>}
							</CommandItem>
						))}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	);
}
