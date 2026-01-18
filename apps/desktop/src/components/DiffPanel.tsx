import { useAtom } from "@effect-atom/atom-react";
import { PatchDiff } from "@pierre/diffs/react";
import { useLiveQuery } from "@tanstack/react-db";
import { useSearch } from "@tanstack/react-router";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	Columns2Icon,
	RowsIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import {
	type DiffStyle,
	diffStyleAtom,
	expandedDiffFilesAtom,
	fileDiffStyleOverridesAtom,
} from "@/atoms";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { emptyDiffCollection, getRevisionDiffCollection } from "@/db";
import type { Revision } from "@/tauri-commands";

interface DiffPanelProps {
	repoPath: string | null;
	changeId: string | null;
	revision: Revision | null;
}

function RevisionHeader({ revision }: { revision: Revision }) {
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

function extractFilePath(patch: string): string {
	const match = patch.match(/^\+\+\+ b\/(.+)$/m);
	return match ? match[1] : "unknown";
}

function FileDiffSection({
	patch,
	isSelected = false,
	fileRef,
}: {
	patch: string;
	isSelected?: boolean;
	fileRef?: React.RefObject<HTMLDivElement | null>;
}) {
	const [globalDiffStyle] = useAtom(diffStyleAtom);
	const [expandedFiles, setExpandedFiles] = useAtom(expandedDiffFilesAtom);
	const [styleOverrides, setStyleOverrides] = useAtom(fileDiffStyleOverridesAtom);

	const filePath = extractFilePath(patch);
	const isExpanded = expandedFiles?.has(filePath) ?? false;
	// Auto-expand when selected
	const isCollapsed = isSelected ? false : !isExpanded;
	// Use local override if set, otherwise use global
	const effectiveDiffStyle = styleOverrides.get(filePath) ?? globalDiffStyle;

	function handleToggleCollapse() {
		setExpandedFiles((prev) => {
			const next = new Set(prev ?? []);
			if (isCollapsed) {
				next.add(filePath);
			} else {
				next.delete(filePath);
			}
			return next;
		});
	}

	function handleSetLocalStyle(style: DiffStyle) {
		setStyleOverrides((prev) => {
			const next = new Map(prev);
			next.set(filePath, style);
			return next;
		});
	}

	return (
		<div
			ref={fileRef}
			className={`border rounded-lg overflow-hidden ${
				isSelected ? "border-accent-foreground border-2" : "border-border"
			}`}
			data-selected={isSelected || undefined}
			data-file-path={filePath}
		>
			<div
				className={`flex items-center gap-2 px-2 py-1.5 border-b ${
					isSelected ? "bg-accent border-accent-foreground" : "bg-muted border-border"
				}`}
			>
				{/* Collapse toggle button - covers left side */}
				<button
					type="button"
					onClick={handleToggleCollapse}
					className="flex items-center gap-2 flex-1 min-w-0 hover:bg-accent/50 -m-1.5 -ml-2 p-1.5 pl-2 rounded-l transition-colors"
				>
					<span className="text-muted-foreground shrink-0">
						{isCollapsed ? (
							<ChevronRightIcon className="size-4" />
						) : (
							<ChevronDownIcon className="size-4" />
						)}
					</span>
					<code className="font-mono text-xs text-foreground text-left flex-1 truncate">
						{filePath}
					</code>
				</button>

				{/* Per-file diff style toggle buttons */}
				<div className="flex items-center gap-0.5">
					<Button
						variant={effectiveDiffStyle === "unified" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => handleSetLocalStyle("unified")}
						title="Unified diff"
						className="h-6 w-6"
					>
						<RowsIcon className="size-3" />
					</Button>
					<Button
						variant={effectiveDiffStyle === "split" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => handleSetLocalStyle("split")}
						title="Split diff"
						className="h-6 w-6"
					>
						<Columns2Icon className="size-3" />
					</Button>
				</div>
			</div>
			{!isCollapsed && (
				<div>
					{!patch.trim() ? (
						<div className="px-4 py-8 text-center text-muted-foreground text-sm">
							No changes in this file
						</div>
					) : (
						<PatchDiff
							patch={patch}
							options={{ hunkSeparators: "line-info", diffStyle: effectiveDiffStyle }}
						/>
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

interface PrerenderedDiffPanelProps {
	repoPath: string | null;
	revisions: Revision[];
	selectedChangeId: string | null;
}

export function PrerenderedDiffPanel({
	repoPath,
	revisions,
	selectedChangeId,
}: PrerenderedDiffPanelProps) {
	const selectedRevision = selectedChangeId
		? (revisions.find((r) => r.change_id === selectedChangeId) ?? null)
		: null;

	return <DiffPanel repoPath={repoPath} changeId={selectedChangeId} revision={selectedRevision} />;
}

export function DiffPanel({ repoPath, changeId, revision }: DiffPanelProps) {
	const { file: selectedFilePath } = useSearch({ strict: false });
	const fileRefsMap = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());
	const [expandedFiles, setExpandedFiles] = useAtom(expandedDiffFilesAtom);
	const [, setStyleOverrides] = useAtom(fileDiffStyleOverridesAtom);
	const lastChangeIdRef = useRef<string | null>(null);

	// Always fetch all diffs
	const diffCollection =
		repoPath && changeId ? getRevisionDiffCollection(repoPath, changeId) : emptyDiffCollection;
	const { data: diffEntries = [], isLoading } = useLiveQuery(diffCollection);
	const revisionDiff = diffEntries[0]?.content ?? "";

	const fileDiffs = splitMultiFileDiff(revisionDiff);
	const filePaths = fileDiffs.map(extractFilePath);

	// Reset state when revision changes
	const firstFilePath = filePaths[0] ?? null;
	useEffect(() => {
		if (changeId !== lastChangeIdRef.current) {
			lastChangeIdRef.current = changeId;
			// Reset to first file expanded
			if (firstFilePath) {
				setExpandedFiles(new Set([firstFilePath]));
			} else {
				setExpandedFiles(new Set());
			}
			// Clear per-file style overrides
			setStyleOverrides(new Map());
		}
	}, [changeId, firstFilePath, setExpandedFiles, setStyleOverrides]);

	// Initialize expanded files on first load
	useEffect(() => {
		if (expandedFiles === null && firstFilePath) {
			setExpandedFiles(new Set([firstFilePath]));
		}
	}, [expandedFiles, firstFilePath, setExpandedFiles]);

	// Get or create ref for each file
	const getFileRef = (filePath: string): React.RefObject<HTMLDivElement | null> => {
		if (!fileRefsMap.current.has(filePath)) {
			fileRefsMap.current.set(filePath, { current: null });
		}
		// biome-ignore lint/style/noNonNullAssertion: Guaranteed to exist since we set it above
		return fileRefsMap.current.get(filePath)!;
	};

	// Toggle all folds
	const allExpanded = filePaths.length > 0 && filePaths.every((p) => expandedFiles?.has(p));

	function handleToggleAllFolds() {
		if (allExpanded) {
			setExpandedFiles(new Set());
		} else {
			setExpandedFiles(new Set(filePaths));
		}
	}

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
			{revision && (
				<div className="p-4 pb-0">
					<RevisionHeader revision={revision} />
				</div>
			)}
			<div className="p-4 space-y-4">
				<div className="flex items-center h-8 px-2 text-xs text-muted-foreground sticky top-0 z-10 bg-background -mt-2 pt-2">
					<span className="font-medium">
						{fileDiffs.length} {fileDiffs.length === 1 ? "file" : "files"}
					</span>
					<Separator orientation="vertical" className="h-4 mx-3" />
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={handleToggleAllFolds}
						title={allExpanded ? "Collapse all files" : "Expand all files"}
						className="h-6 w-6"
					>
						{allExpanded ? (
							<ChevronsDownUpIcon className="size-3.5" />
						) : (
							<ChevronsUpDownIcon className="size-3.5" />
						)}
					</Button>
					<div className="flex items-center gap-0.5 ml-auto">
						<DiffStyleToggle />
					</div>
				</div>
				{fileDiffs.map((patch) => {
					const filePath = extractFilePath(patch);
					const fileRef = getFileRef(filePath);
					const isSelected = selectedFilePath === filePath;

					return (
						<FileDiffSection
							key={filePath}
							patch={patch}
							isSelected={isSelected}
							fileRef={fileRef}
						/>
					);
				})}
			</div>
		</div>
	);
}

function DiffStyleToggle() {
	const [globalDiffStyle, setGlobalDiffStyle] = useAtom(diffStyleAtom);

	return (
		<>
			<Button
				variant={globalDiffStyle === "unified" ? "secondary" : "ghost"}
				size="icon-xs"
				onClick={() => setGlobalDiffStyle("unified")}
				title="Unified diff view"
				className="h-6 w-6"
			>
				<RowsIcon className="size-3" />
			</Button>
			<Button
				variant={globalDiffStyle === "split" ? "secondary" : "ghost"}
				size="icon-xs"
				onClick={() => setGlobalDiffStyle("split")}
				title="Split diff view"
				className="h-6 w-6"
			>
				<Columns2Icon className="size-3" />
			</Button>
		</>
	);
}
