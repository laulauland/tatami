import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Revision } from "@/tauri-commands";

interface LogViewProps {
	revisions: Revision[];
	selectedRevision: Revision | null;
	onSelectRevision: (revision: Revision) => void;
}

function RevisionEntry({
	revision,
	isSelected,
	onSelect,
}: {
	revision: Revision;
	isSelected: boolean;
	onSelect: () => void;
}) {
	const description = revision.description.split("\n")[0] || "(no description)";

	return (
		<button
			type="button"
			onClick={onSelect}
			className={`w-full text-left p-3 rounded-md transition-colors ${
				isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"
			} ${revision.is_immutable ? "opacity-60" : ""}`}
		>
			<div className="flex items-center gap-2 mb-1">
				{revision.is_working_copy && <span className="text-primary font-bold">@</span>}
				<code className="text-xs font-mono text-muted-foreground">
					{revision.change_id.slice(0, 8)}
				</code>
				{revision.bookmarks.length > 0 && (
					<div className="flex gap-1">
						{revision.bookmarks.map((bookmark) => (
							<Badge key={bookmark} variant="secondary" className="text-xs px-1 py-0">
								{bookmark}
							</Badge>
						))}
					</div>
				)}
			</div>
			<div className="text-sm truncate">{description}</div>
			<div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
				<span>{revision.author}</span>
				<span>·</span>
				<span>{revision.timestamp}</span>
			</div>
		</button>
	);
}

export function LogView({ revisions, selectedRevision, onSelectRevision }: LogViewProps) {
	if (revisions.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				No revisions loaded
			</div>
		);
	}

	return (
		<ScrollArea className="h-full">
			<div className="p-2 space-y-1">
				{revisions.map((revision) => (
					<RevisionEntry
						key={revision.change_id}
						revision={revision}
						isSelected={selectedRevision?.change_id === revision.change_id}
						onSelect={() => onSelectRevision(revision)}
					/>
				))}
			</div>
		</ScrollArea>
	);
}
