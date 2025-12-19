import { FolderOpen, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { Project } from "@/tauri-commands";

interface AppSidebarProps {
	projects: Project[];
	activeProject: Project | null;
	onSelectProject: (project: Project) => void;
	onOpenRepo: () => void;
	onOpenSettings: () => void;
}

export function AppSidebar({
	projects,
	activeProject,
	onSelectProject,
	onOpenRepo,
	onOpenSettings,
}: AppSidebarProps) {
	return (
		<Sidebar collapsible="icon">
			<SidebarHeader className="flex-row items-center justify-between">
				<span className="text-sm font-semibold group-data-[collapsible=icon]:hidden">Projects</span>
				<Button variant="ghost" size="icon" className="size-7" onClick={onOpenRepo}>
					<Plus className="size-4" />
				</Button>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{projects.length === 0 ? (
								<div className="text-sm text-muted-foreground text-center py-4 group-data-[collapsible=icon]:hidden">
									No projects yet
								</div>
							) : (
								projects.map((project) => (
									<SidebarMenuItem key={project.id}>
										<SidebarMenuButton
											isActive={activeProject?.id === project.id}
											onClick={() => onSelectProject(project)}
											tooltip={project.name}
										>
											<FolderOpen className="size-4" />
											<span>{project.name}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))
							)}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton onClick={onOpenSettings} tooltip="Settings">
							<Settings className="size-4" />
							<span>Settings</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}
