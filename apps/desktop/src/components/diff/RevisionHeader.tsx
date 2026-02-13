import { InlineEditor } from "@/components/InlineEditor";
import type { Revision } from "@/tauri-commands";

interface RevisionHeaderProps {
	revision: Revision;
	conflictPaths?: string[];
	onDescribe?: (changeId: string, description: string) => void;
}

export function RevisionHeader({ revision, conflictPaths = [], onDescribe }: RevisionHeaderProps) {
	const commitIdShort = revision.commit_id.substring(0, 12);

	return (
		<div>
			<div className="px-3 py-2 font-mono text-xs space-y-1.5">
				<div className="flex gap-4">
					<div>
						<span className="text-muted-foreground">Change ID:</span>{" "}
						<span className="text-foreground font-semibold">{revision.change_id_short}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Commit ID:</span>{" "}
						<span className="text-foreground">{commitIdShort}</span>
					</div>
				</div>
				<div>
					<span className="text-muted-foreground">Author:</span>{" "}
					<span className="text-foreground">{revision.author}</span>
					<span className="text-muted-foreground ml-4">at</span>{" "}
					<span className="text-foreground">{revision.timestamp}</span>
				</div>
				{conflictPaths.length > 0 && (
					<div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
						<div className="font-semibold">⚠ {conflictPaths.length} conflicted file(s)</div>
						<div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
							{conflictPaths.map((path) => (
								<code key={path} className="rounded bg-destructive/10 px-1 py-0.5 text-[11px]">
									{path}
								</code>
							))}
						</div>
					</div>
				)}
				<div className="mt-2 pt-2">
					<InlineEditor
						value={revision.description || ""}
						onSave={(desc) => onDescribe?.(revision.change_id, desc)}
						placeholder="Enter commit description…"
						readOnly={revision.is_immutable}
					/>
				</div>
			</div>
		</div>
	);
}
