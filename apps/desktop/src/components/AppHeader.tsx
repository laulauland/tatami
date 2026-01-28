import { FolderOpenIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
	projectName: string | null;
	onOpenProject: () => void;
	onSync: () => void;
	onOpenSearch: () => void;
	isSyncing?: boolean;
}

export function AppHeader({
	projectName,
	onOpenProject,
	onSync,
	onOpenSearch,
	isSyncing = false,
}: AppHeaderProps) {
	return (
		<header
			className="h-10 flex items-center justify-between px-3 border-b border-border bg-background shrink-0"
			data-tauri-drag-region
		>
			{/* Left: Project/Repository */}
			<Button
				variant="ghost"
				size="sm"
				className="h-7 px-2 gap-1.5 text-sm font-medium"
				onClick={onOpenProject}
			>
				<FolderOpenIcon className="size-4" />
				<span className="truncate max-w-[200px]">{projectName ?? "Open Repository"}</span>
			</Button>

			{/* Center: Revision search */}
			<Button
				variant="ghost"
				size="sm"
				className="h-7 px-2 gap-1.5 text-sm text-muted-foreground"
				onClick={onOpenSearch}
			>
				<SearchIcon className="size-4" />
				<span>Search revisions...</span>
				<kbd className="ml-2 text-xs bg-muted px-1.5 py-0.5 rounded">/</kbd>
			</Button>

			{/* Right: Sync */}
			<Button
				variant="ghost"
				size="sm"
				className="h-7 px-2 gap-1.5 text-sm"
				onClick={onSync}
				disabled={isSyncing || !projectName}
			>
				<RefreshCwIcon className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
				<span>Sync</span>
			</Button>
		</header>
	);
}
