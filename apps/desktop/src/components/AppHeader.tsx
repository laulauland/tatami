import { Columns2Icon, FolderOpenIcon, ListIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AppHeaderProps {
	projectName: string | null;
	onOpenProject: () => void;
	onSync: () => void;
	onOpenSearch: () => void;
	viewMode: 1 | 2;
	onChangeViewMode: (mode: 1 | 2) => void;
	isSyncing?: boolean;
}

export function AppHeader({
	projectName,
	onOpenProject,
	onSync,
	onOpenSearch,
	viewMode,
	onChangeViewMode,
	isSyncing = false,
}: AppHeaderProps) {
	return (
		<header
			className="h-10 flex items-center justify-between px-3 border-b border-border bg-background shrink-0"
			data-tauri-drag-region
		>
			{/* Left: Project/Repository + view mode */}
			<div className="flex items-center gap-1.5 min-w-0">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 px-2 gap-1.5 text-sm font-medium"
					onClick={onOpenProject}
				>
					<FolderOpenIcon className="size-4" />
					<span className="truncate max-w-[200px]">{projectName ?? "Open Repository"}</span>
				</Button>
				<div
					className="relative flex items-center rounded-md border border-border/70 bg-muted/60 p-0.5 shadow-inner"
					aria-label="View mode"
				>
					<div
						className={`absolute top-0.5 h-6 w-6 rounded-sm bg-background shadow-sm transition-transform duration-200 ${
							viewMode === 1 ? "translate-x-0" : "translate-x-6"
						}`}
					/>
					<button
						type="button"
						className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
						onClick={() => onChangeViewMode(1)}
						title="Overview mode (1)"
						aria-label="Overview mode"
						disabled={!projectName}
					>
						<ListIcon className={`size-3.5 ${viewMode === 1 ? "text-foreground" : ""}`} />
					</button>
					<button
						type="button"
						className="relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
						onClick={() => onChangeViewMode(2)}
						title="Split mode (2)"
						aria-label="Split mode"
						disabled={!projectName}
					>
						<Columns2Icon className={`size-3.5 ${viewMode === 2 ? "text-foreground" : ""}`} />
					</button>
				</div>
			</div>

			{/* Right: sync + revision search */}
			<div className="flex items-center gap-1 ml-auto">
				<Button
					variant="ghost"
					size="icon-sm"
					className="h-7 w-7"
					onClick={onSync}
					disabled={isSyncing || !projectName}
					title="Sync"
					aria-label="Sync"
				>
					<RefreshCwIcon className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					className="h-7 w-7 text-muted-foreground"
					onClick={onOpenSearch}
					title="Search revisions (/)"
					aria-label="Search revisions"
				>
					<SearchIcon className="size-4" />
				</Button>
			</div>
		</header>
	);
}
