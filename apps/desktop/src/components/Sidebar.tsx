import { LogView } from "@/components/LogView";
import type { Revision } from "@/tauri-commands";

interface SidebarProps {
	revisions: Revision[];
	selectedRevision: Revision | null;
	onSelectRevision: (revision: Revision) => void;
	isLoading: boolean;
}

export function Sidebar({
	revisions,
	selectedRevision,
	onSelectRevision,
	isLoading,
}: SidebarProps) {
	return (
		<div className="flex flex-col h-full bg-card">
			<div className="p-4 border-b border-border flex items-center justify-between">
				<h2 className="text-sm font-semibold">Revisions</h2>
				{isLoading && <span className="text-xs text-muted-foreground">Loading...</span>}
			</div>
			<div className="flex-1 min-h-0">
				<LogView
					revisions={revisions}
					selectedRevision={selectedRevision}
					onSelectRevision={onSelectRevision}
				/>
			</div>
		</div>
	);
}
