import { PatchDiff } from "@pierre/diffs/react";
import { useLiveQuery } from "@tanstack/react-db";
import { useSearch } from "@tanstack/react-router";
import {
	ChevronDownIcon,
	ChevronRightIcon,
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	ColumnsIcon,
	RowsIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
		<div className="border border-border rounded-lg mb-4 bg-muted/50">
			<div className="px-3 py-2 font-mono text-sm space-y-2">
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

type DiffStyle = "unified" | "split";

function FileDiffSection({
	patch,
	defaultCollapsed = false,
	isSelected = false,
	fileRef,
	globalDiffStyle,
	onCollapseChange,
}: {
	patch: string;
	defaultCollapsed?: boolean;
	isSelected?: boolean;
	fileRef?: React.RefObject<HTMLDivElement | null>;
	globalDiffStyle: DiffStyle;
	onCollapseChange?: (collapsed: boolean) => void;
}) {
	const [isCollapsedByUser, setIsCollapsedByUser] = useState(defaultCollapsed);
	const [localDiffStyle, setLocalDiffStyle] = useState<DiffStyle | null>(null);
	const filePath = extractFilePath(patch);

	// Derived state: auto-expand when selected
	const isCollapsed = isSelected ? false : isCollapsedByUser;

	// Use local override if set, otherwise use global
	const effectiveDiffStyle = localDiffStyle ?? globalDiffStyle;

	function handleToggleCollapse() {
		const newCollapsed = !isCollapsed;
		setIsCollapsedByUser(newCollapsed);
		onCollapseChange?.(newCollapsed);
	}

	return (
		<div
			ref={fileRef}
			className={`border rounded-lg overflow-hidden ${
				isSelected ? "border-accent-foreground border-2" : "border-border"
			}`}
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
					<code className="font-mono text-sm text-foreground text-left flex-1 truncate">
						{filePath}
					</code>
				</button>

				{/* Per-file diff style toggle buttons */}
				<div className="flex items-center gap-0.5">
					<Button
						variant={effectiveDiffStyle === "unified" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => setLocalDiffStyle("unified")}
						title="Unified diff"
					>
						<RowsIcon className="size-3" />
					</Button>
					<Button
						variant={effectiveDiffStyle === "split" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => setLocalDiffStyle("split")}
						title="Split diff"
					>
						<ColumnsIcon className="size-3" />
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

function DiffToolbar({
	allCollapsed,
	onToggleAllFolds,
	diffStyle,
	onDiffStyleChange,
}: {
	allCollapsed: boolean;
	onToggleAllFolds: () => void;
	diffStyle: DiffStyle;
	onDiffStyleChange: (style: DiffStyle) => void;
}) {
	return (
		<div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30 sticky top-0 z-10">
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="xs"
					onClick={onToggleAllFolds}
					title={allCollapsed ? "Expand all files" : "Collapse all files"}
				>
					{allCollapsed ? (
						<ChevronsUpDownIcon className="size-3.5" />
					) : (
						<ChevronsDownUpIcon className="size-3.5" />
					)}
					<span>{allCollapsed ? "Expand all" : "Collapse all"}</span>
				</Button>
			</div>
			<div className="flex items-center gap-1">
				<span className="text-xs text-muted-foreground mr-1">View:</span>
				<Button
					variant={diffStyle === "unified" ? "secondary" : "ghost"}
					size="icon-xs"
					onClick={() => onDiffStyleChange("unified")}
					title="Unified diff view"
				>
					<RowsIcon className="size-3" />
				</Button>
				<Button
					variant={diffStyle === "split" ? "secondary" : "ghost"}
					size="icon-xs"
					onClick={() => onDiffStyleChange("split")}
					title="Split diff view"
				>
					<ColumnsIcon className="size-3" />
				</Button>
			</div>
		</div>
	);
}

export function DiffPanel({ repoPath, changeId, revision }: DiffPanelProps) {
	const { file: selectedFilePath } = useSearch({ strict: false });
	const fileRefsMap = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());
	const [globalDiffStyle, setGlobalDiffStyle] = useState<DiffStyle>("unified");
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
	const [lastChangeId, setLastChangeId] = useState<string | null>(null);

	// Reset collapsed state when revision changes
	if (changeId !== lastChangeId) {
		setLastChangeId(changeId);
		if (collapsedFiles.size > 0) {
			setCollapsedFiles(new Set());
		}
	}

	// Always fetch all diffs
	const diffCollection =
		repoPath && changeId ? getRevisionDiffCollection(repoPath, changeId) : emptyDiffCollection;
	const { data: diffEntries = [], isLoading } = useLiveQuery(diffCollection);
	const revisionDiff = diffEntries[0]?.content ?? "";

	const fileDiffs = splitMultiFileDiff(revisionDiff);
	const filePaths = fileDiffs.map(extractFilePath);

	// Get or create ref for each file
	const getFileRef = (filePath: string): React.RefObject<HTMLDivElement | null> => {
		if (!fileRefsMap.current.has(filePath)) {
			fileRefsMap.current.set(filePath, { current: null });
		}
		// biome-ignore lint/style/noNonNullAssertion: Guaranteed to exist since we set it above
		return fileRefsMap.current.get(filePath)!;
	};

	// Track collapse state for toggle all
	const allCollapsed = filePaths.length > 0 && filePaths.every((p) => collapsedFiles.has(p));

	function handleToggleAllFolds() {
		if (allCollapsed) {
			// Expand all
			setCollapsedFiles(new Set());
		} else {
			// Collapse all
			setCollapsedFiles(new Set(filePaths));
		}
	}

	function handleFileCollapseChange(filePath: string, collapsed: boolean) {
		setCollapsedFiles((prev) => {
			const next = new Set(prev);
			if (collapsed) {
				next.add(filePath);
			} else {
				next.delete(filePath);
			}
			return next;
		});
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
				<div className="pt-6 px-4 pb-0">
					<RevisionHeader revision={revision} />
				</div>
			)}
			<DiffToolbar
				allCollapsed={allCollapsed}
				onToggleAllFolds={handleToggleAllFolds}
				diffStyle={globalDiffStyle}
				onDiffStyleChange={setGlobalDiffStyle}
			/>
			<div className="p-4 space-y-4">
				{fileDiffs.map((patch, idx) => {
					const filePath = extractFilePath(patch);
					const fileRef = getFileRef(filePath);
					const isSelected = selectedFilePath === filePath;
					const isCollapsed = collapsedFiles.has(filePath);

					return (
						<FileDiffSection
							key={filePath}
							patch={patch}
							defaultCollapsed={isCollapsed || (idx > 0 && !isSelected)}
							isSelected={isSelected}
							fileRef={fileRef}
							globalDiffStyle={globalDiffStyle}
							onCollapseChange={(collapsed) => handleFileCollapseChange(filePath, collapsed)}
						/>
					);
				})}
			</div>
		</div>
	);
}
