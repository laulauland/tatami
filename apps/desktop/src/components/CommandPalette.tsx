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
import type { Project } from "@/tauri-commands";

interface CommandPaletteProps {
	projects: Project[];
	onSelectProject: (project: Project) => void;
	onOpenRepo: () => void;
}

export function CommandPalette({ projects, onSelectProject, onOpenRepo }: CommandPaletteProps) {
	const [open, setOpen] = useState(false);

	useKeyboardShortcut({
		key: "o",
		modifiers: { meta: true, ctrl: true },
		onPress: () => setOpen((open) => !open),
	});

	const handleSelectProject = (project: Project) => {
		onSelectProject(project);
		setOpen(false);
	};

	const handleOpenRepo = () => {
		onOpenRepo();
		setOpen(false);
	};

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder="Search projects..." />
			<CommandList>
				<CommandEmpty>No projects found.</CommandEmpty>
				<CommandGroup heading="Projects">
					{projects.map((project) => (
						<CommandItem key={project.id} onSelect={() => handleSelectProject(project)}>
							<FolderOpen className="mr-2 h-4 w-4" />
							<span>{project.name}</span>
						</CommandItem>
					))}
				</CommandGroup>
				<CommandGroup heading="Actions">
					<CommandItem onSelect={handleOpenRepo}>
						<FolderOpen className="mr-2 h-4 w-4" />
						<span>Add a repository...</span>
					</CommandItem>
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
