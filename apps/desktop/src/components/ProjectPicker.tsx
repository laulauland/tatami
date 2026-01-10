import { FolderOpen } from "lucide-react";
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
import type { Repository } from "@/tauri-commands";

interface ProjectPickerProps {
	repositories: Repository[];
	onSelectRepository: (repository: Repository) => void;
}

export function ProjectPicker({
	repositories,
	onSelectRepository,
}: ProjectPickerProps) {
	const [open, setOpen] = useState(false);

	useKeyboardShortcut({
		key: "o",
		modifiers: { meta: true, ctrl: true },
		onPress: () => setOpen((open) => !open),
	});

	const handleSelectRepository = (repository: Repository) => {
		onSelectRepository(repository);
		setOpen(false);
	};

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder="Search projects..." />
			<CommandList>
				<CommandEmpty>No repositories found.</CommandEmpty>
				<CommandGroup heading="Repositories">
					{repositories.map((repository) => (
						<CommandItem key={repository.id} onSelect={() => handleSelectRepository(repository)}>
							<FolderOpen className="mr-2 h-4 w-4" />
							<span>{repository.name}</span>
						</CommandItem>
					))}
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}