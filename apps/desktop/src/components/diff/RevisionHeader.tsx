import { useEffect, useRef, useState } from "react";
import { InlineEditor } from "@/components/InlineEditor";
import type { Revision } from "@/tauri-commands";

interface RevisionHeaderProps {
	revision: Revision;
	conflictPaths?: string[];
	onDescribe?: (changeId: string, description: string) => void;
}

const COLLAPSED_MAX_PX = 96;

export function RevisionHeader({ revision, conflictPaths = [], onDescribe }: RevisionHeaderProps) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	const commitIdShort = revision.commit_id.substring(0, 12);

	useEffect(() => {
		const el = bodyRef.current;
		if (!el) return;
		const check = () => setOverflows(el.scrollHeight > COLLAPSED_MAX_PX + 1);
		check();
		const ro = new ResizeObserver(check);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const showFade = overflows && !expanded;

	return (
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
			<div className="relative mt-2 pt-2">
				<div
					ref={bodyRef}
					style={showFade ? { maxHeight: COLLAPSED_MAX_PX } : undefined}
					className={showFade ? "overflow-hidden" : ""}
				>
					<InlineEditor
						value={revision.description || ""}
						onSave={(desc) => onDescribe?.(revision.change_id, desc)}
						placeholder="Enter commit description…"
						readOnly={revision.is_immutable}
					/>
				</div>

				{showFade && (
					<>
						<div
							aria-hidden
							className="pointer-events-none absolute inset-x-0 bottom-0 h-14 backdrop-blur-[2px]"
							style={{
								maskImage: "linear-gradient(to bottom, transparent 0%, black 75%)",
								WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 75%)",
							}}
						/>
						<div
							aria-hidden
							className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-background"
						/>
						<div className="absolute inset-x-0 bottom-0 flex justify-center">
							<button
								type="button"
								onClick={() => setExpanded(true)}
								className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
							>
								Read more
							</button>
						</div>
					</>
				)}

				{overflows && expanded && (
					<div className="mt-1 flex justify-center">
						<button
							type="button"
							onClick={() => setExpanded(false)}
							className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
						>
							Show less
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
