import { PatchDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Revision } from "@/tauri-commands";
import { getRevisionDiff } from "@/tauri-commands";

interface DiffPanelProps {
	repoPath: string | null;
	changeId: string | null;
	revision: Revision | null;
}

function RevisionHeader({ revision }: { revision: Revision }) {
	const commitIdShort = revision.commit_id.substring(0, 12);

	return (
		<div className="border border-border rounded-lg p-4 mb-4 bg-muted/50">
			<div className="font-mono text-sm space-y-2">
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
					<div className="mt-3 pt-3 border-t border-border">
						<pre className="text-sm text-foreground whitespace-pre-wrap font-sans">
							{revision.description}
						</pre>
					</div>
				)}
			</div>
		</div>
	);
}

function extractFilePath(patch: string): string {
	const match = patch.match(/^\+\+\+ b\/(.+)$/m);
	return match ? match[1] : "unknown";
}

function FileDiffSection({
	patch,
	defaultCollapsed = false,
	isSelected = false,
	fileRef,
}: {
	patch: string;
	defaultCollapsed?: boolean;
	isSelected?: boolean;
	fileRef?: React.RefObject<HTMLDivElement | null>;
}) {
	const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
	const filePath = extractFilePath(patch);

	// Auto-expand when selected
	useEffect(() => {
		if (isSelected && isCollapsed) {
			setIsCollapsed(false);
		}
	}, [isSelected, isCollapsed]);

	return (
		<div
			ref={fileRef}
			className={`border rounded-lg overflow-hidden ${
				isSelected ? "border-accent-foreground border-2" : "border-border"
			}`}
		>
			<button
				type="button"
				onClick={() => setIsCollapsed(!isCollapsed)}
				className={`w-full px-4 py-2 border-b hover:bg-accent/50 transition-colors flex items-center justify-between ${
					isSelected ? "bg-accent border-accent-foreground" : "bg-muted border-border"
				}`}
			>
				<code className="font-mono text-sm text-foreground text-left">{filePath}</code>
				<span className="text-xs text-muted-foreground">{isCollapsed ? "▶" : "▼"}</span>
			</button>
			{!isCollapsed && (
				<div>
					{!patch.trim() ? (
						<div className="px-4 py-8 text-center text-muted-foreground text-sm">
							No changes in this file
						</div>
					) : (
						<PatchDiff patch={patch} options={{ hunkSeparators: "line-info" }} />
					)}
				</div>
			)}
		</div>
	);
}

function splitMultiFileDiff(unifiedDiff: string): string[] {
	if (!unifiedDiff.trim()) {
		return [];
	}

	const fileDiffs: string[] = [];
	const lines = unifiedDiff.split("\n");
	let currentDiff: string[] = [];

	for (const line of lines) {
		if (line.startsWith("--- a/") && currentDiff.length > 0) {
			fileDiffs.push(currentDiff.join("\n"));
			currentDiff = [line];
		} else {
			currentDiff.push(line);
		}
	}

	if (currentDiff.length > 0) {
		fileDiffs.push(currentDiff.join("\n"));
	}

	return fileDiffs;
}

export function DiffPanel({ repoPath, changeId, revision }: DiffPanelProps) {
	const { file: selectedFilePath } = useSearch({ strict: false });
	const fileRefsMap = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());

	// Always fetch all diffs
	const { data: revisionDiff = "", isLoading } = useQuery({
		queryKey: ["revision-diff", repoPath, changeId],
		queryFn: () => {
			if (!repoPath || !changeId) {
				throw new Error("Missing required parameters");
			}
			return getRevisionDiff(repoPath, changeId);
		},
		enabled: Boolean(repoPath && changeId),
	});

	const fileDiffs = splitMultiFileDiff(revisionDiff);

	// Get or create ref for each file
	const getFileRef = (filePath: string): React.RefObject<HTMLDivElement | null> => {
		if (!fileRefsMap.current.has(filePath)) {
			fileRefsMap.current.set(filePath, { current: null });
		}
		// biome-ignore lint/style/noNonNullAssertion: Guaranteed to exist since we set it above
		return fileRefsMap.current.get(filePath)!;
	};

	// Scroll to selected file when it changes
	useEffect(() => {
		if (selectedFilePath && fileRefsMap.current.has(selectedFilePath)) {
			const ref = fileRefsMap.current.get(selectedFilePath);
			if (ref?.current) {
				ref.current.scrollIntoView({
					behavior: "smooth",
					block: "start",
				});
			}
		}
	}, [selectedFilePath]);

	if (!repoPath || !changeId) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				Select a revision to view diffs
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				Loading diffs...
			</div>
		);
	}

	if (fileDiffs.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				No changes in this revision
			</div>
		);
	}

	return (
		<div className="h-full overflow-auto bg-background">
			<div className="p-4 space-y-4">
				{revision && <RevisionHeader revision={revision} />}
				{fileDiffs.map((patch, idx) => {
					const filePath = extractFilePath(patch);
					const fileRef = getFileRef(filePath);
					const isSelected = selectedFilePath === filePath;

					return (
						<FileDiffSection
							key={filePath}
							patch={patch}
							defaultCollapsed={idx > 0 && !isSelected}
							isSelected={isSelected}
							fileRef={fileRef}
						/>
					);
				})}
			</div>
		</div>
	);
}
