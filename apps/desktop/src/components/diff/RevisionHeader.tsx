import type { Revision } from "@/tauri-commands";

interface RevisionHeaderProps {
	revision: Revision;
}

export function RevisionHeader({ revision }: RevisionHeaderProps) {
	const commitIdShort = revision.commit_id.substring(0, 12);

	return (
		<div className="border border-border rounded-lg bg-card">
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
				{revision.description && (
					<div className="mt-2 pt-2 border-t border-border">
						<pre className="text-xs text-foreground whitespace-pre-wrap font-sans">
							{revision.description}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}
