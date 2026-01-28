import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type { Revision } from "@/tauri-commands";

interface RevisionHeaderProps {
	revision: Revision;
}

export function RevisionHeader({ revision }: RevisionHeaderProps) {
	const commitIdShort = revision.commit_id.substring(0, 12);
	const [isExpanded, setIsExpanded] = useState(false);

	// Split description into title (first line) and body (rest)
	const descriptionLines = revision.description?.split("\n") ?? [];
	const title = descriptionLines[0] ?? "";
	const body = descriptionLines.slice(1).join("\n").trim();
	const hasBody = body.length > 0;

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
				{title && (
					<div className="mt-2 pt-2">
						<div className="flex items-start gap-1">
							{hasBody && (
								<button
									type="button"
									onClick={() => setIsExpanded(!isExpanded)}
									className="text-muted-foreground hover:text-foreground shrink-0 transition-colors mt-0.5"
								>
									{isExpanded ? (
										<ChevronDownIcon className="size-4" />
									) : (
										<ChevronRightIcon className="size-4" />
									)}
								</button>
							)}
							<span className="text-sm font-semibold text-foreground font-sans">{title}</span>
						</div>
						{hasBody && isExpanded && (
							<pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans mt-2 ml-5">
								{body}
							</pre>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
