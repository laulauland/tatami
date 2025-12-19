import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Settings, FolderOpen } from "lucide-react";

interface ToolbarProps {
	repoPath: string | null;
	isLoading: boolean;
	onRefresh: () => void;
	onOpenRepo: () => void;
	onOpenSettings: () => void;
}

export function Toolbar({
	repoPath,
	isLoading,
	onRefresh,
	onOpenRepo,
	onOpenSettings,
}: ToolbarProps) {
	return (
		<div className="flex items-center h-12 px-4 border-b border-border bg-card">
			<div className="flex items-center gap-2 flex-1">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="sm" onClick={onOpenRepo} className="gap-2">
							<FolderOpen className="h-4 w-4" />
							{repoPath || "Open Repository"}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Open Repository</TooltipContent>
				</Tooltip>
			</div>

			<div className="flex items-center gap-1">
				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="sm" onClick={onRefresh} disabled={isLoading}>
							<RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Refresh</TooltipContent>
				</Tooltip>

				<Separator orientation="vertical" className="h-6 mx-1" />

				<Tooltip>
					<TooltipTrigger>
						<Button variant="ghost" size="sm" onClick={onOpenSettings}>
							<Settings className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Settings</TooltipContent>
				</Tooltip>
			</div>
		</div>
	);
}
