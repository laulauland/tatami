import { Folder, Settings, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";

interface CommandPaletteProps {
	onOpenRepo: () => void;
	onOpenProjects: () => void;
	onOpenSettings: () => void;
}

export function CommandPalette({
	onOpenRepo,
	onOpenProjects,
	onOpenSettings,
}: CommandPaletteProps) {
	const [open, setOpen] = useState(false);

	useKeyboardShortcut({
		key: "k",
		modifiers: { meta: true, ctrl: true },
		onPress: () => setOpen((open) => !open),
	});

	const handleOpenRepo = () => {
		onOpenRepo();
		setOpen(false);
	};

	const handleOpenProjects = () => {
		onOpenProjects();
		setOpen(false);
	};

	const handleOpenSettings = () => {
		onOpenSettings();
		setOpen(false);
	};

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder="Search actions..." />
			<CommandList>
				<CommandEmpty>No actions found.</CommandEmpty>
				<CommandGroup heading="Actions">
					<CommandItem onSelect={handleOpenRepo}>
						<Folder className="mr-2 h-4 w-4" />
						<span>Add a repository...</span>
					</CommandItem>
					<CommandItem onSelect={handleOpenProjects}>
						<Settings className="mr-2 h-4 w-4" />
						<span>Manage repositories...</span>
					</CommandItem>
					<CommandItem onSelect={handleOpenSettings}>
						<SlidersHorizontal className="mr-2 h-4 w-4" />
						<span>Settings</span>
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
