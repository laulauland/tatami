import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { Columns2Icon, RowsIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DiffStyle, type DiffViewState, diffStyleAtom, diffViewStateAtom } from "@/atoms";
import { FileList, RevisionHeader, SingleFileDiff } from "@/components/diff";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
	emptyChangesCollection,
	emptyDiffCollection,
	getRevisionChangesCollection,
	getRevisionDiffCollection,
} from "@/db";
import { useDiffPanelKeyboard } from "@/hooks/useDiffPanelKeyboard";
import type { Revision } from "@/tauri-commands";

interface DiffPanelProps {
	repoPath: string | null;
	changeId: string | null;
	revision: Revision | null;
}

interface PrerenderedDiffPanelProps {
	repoPath: string | null;
	revisions: Revision[];
	selectedChangeId: string | null;
}

/**
 * Extract file path from a unified diff patch.
 */
function extractFilePath(patch: string): string {
	const match = patch.match(/^\+\+\+ b\/(.+)$/m);
	return match ? match[1] : "unknown";
}

/**
 * Split a multi-file unified diff into individual file diffs.
 */
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

/**
 * Parse additions and deletions from a single patch.
 */
function parsePatchStats(patch: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	const lines = patch.split("\n");

	for (const line of lines) {
		// Skip header lines
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("++")) {
			additions++;
		} else if (line.startsWith("-") && !line.startsWith("--")) {
			deletions++;
		}
	}

	return { additions, deletions };
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

/**
 * Get the current diff view state, resetting if the changeId has changed.
 * This is a pure derivation - no useEffect needed for state sync.
 */
function getDiffViewState(currentState: DiffViewState, changeId: string | null): DiffViewState {
	// If changeId matches, return current state as-is
	if (currentState.forChangeId === changeId) {
		return currentState;
	}
	// ChangeId changed - return reset state
	return {
		forChangeId: changeId,
		expandedFiles: new Set(),
		styleOverrides: new Map(),
	};
}

export function DiffPanel({ repoPath, changeId, revision }: DiffPanelProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const [globalDiffStyle] = useAtom(diffStyleAtom);
	const [diffViewState, setDiffViewState] = useAtom(diffViewStateAtom);
	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const prevChangeIdRef = useRef<string | null>(null);

	// Get effective diff style for selected file
	const effectiveDiffStyle = selectedFile
		? (diffViewState.styleOverrides.get(selectedFile) ?? globalDiffStyle)
		: globalDiffStyle;

	function handleSetLocalStyle(style: DiffStyle) {
		if (!selectedFile) return;
		setDiffViewState((prev) => {
			const next = new Map(prev.styleOverrides);
			next.set(selectedFile, style);
			return { ...prev, styleOverrides: next };
		});
	}

	// Reset selected file when changeId changes
	if (prevChangeIdRef.current !== changeId) {
		prevChangeIdRef.current = changeId;
		if (selectedFile !== null) {
			setSelectedFile(null);
		}
	}

	// Keyboard navigation
	useDiffPanelKeyboard({ scrollContainerRef });

	// Fetch file changes (for the file list with status)
	const changesCollection =
		repoPath && changeId
			? getRevisionChangesCollection(repoPath, changeId)
			: emptyChangesCollection;
	const { data: changedFiles = [] } = useLiveQuery(changesCollection);

	// Fetch full diff (for the diff content)
	const diffCollection =
		repoPath && changeId ? getRevisionDiffCollection(repoPath, changeId) : emptyDiffCollection;
	const { data: diffEntries = [], isLoading } = useLiveQuery(diffCollection);
	const revisionDiff = diffEntries[0]?.content ?? "";

	// Parse diff into individual file patches
	const fileDiffs = useMemo(() => splitMultiFileDiff(revisionDiff), [revisionDiff]);

	// Create a map from file path to patch content
	const patchMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const patch of fileDiffs) {
			const path = extractFilePath(patch);
			map.set(path, patch);
		}
		return map;
	}, [fileDiffs]);

	// Calculate total stats
	const { totalAdditions, totalDeletions } = useMemo(() => {
		let additions = 0;
		let deletions = 0;
		for (const patch of fileDiffs) {
			const stats = parsePatchStats(patch);
			additions += stats.additions;
			deletions += stats.deletions;
		}
		return { totalAdditions: additions, totalDeletions: deletions };
	}, [fileDiffs]);

	// Derive the effective state - resets automatically when changeId changes
	const effectiveState = getDiffViewState(diffViewState, changeId);

	// Sync atom if state was reset (only writes when needed)
	if (effectiveState !== diffViewState) {
		setDiffViewState(effectiveState);
	}

	// Auto-select first file when files load and none selected
	useEffect(() => {
		if (changedFiles.length > 0 && !selectedFile) {
			setSelectedFile(changedFiles[0].path);
		}
	}, [changedFiles, selectedFile]);

	// Get patch for selected file
	const selectedPatch = selectedFile ? (patchMap.get(selectedFile) ?? null) : null;

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

	if (changedFiles.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				No changes in this revision
			</div>
		);
	}

	return (
		<div
			ref={scrollContainerRef}
			className="h-full w-full flex flex-col bg-background outline-none overflow-hidden"
		>
			{/* Revision header */}
			{revision && (
				<div className="px-4 pt-4 pb-2 shrink-0">
					<RevisionHeader revision={revision} />
				</div>
			)}

			{/* Toolbar spanning both columns */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-border bg-background shrink-0 min-w-0">
				<code className="font-mono text-xs text-foreground truncate min-w-0">
					{selectedFile ?? "No file selected"}
				</code>
				<div className="flex items-center gap-0.5 shrink-0 ml-2">
					<Button
						variant={effectiveDiffStyle === "unified" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => handleSetLocalStyle("unified")}
						title="Unified diff view"
						className="h-6 w-6"
						disabled={!selectedFile}
					>
						<RowsIcon className="size-3" />
					</Button>
					<Button
						variant={effectiveDiffStyle === "split" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => handleSetLocalStyle("split")}
						title="Split diff view"
						className="h-6 w-6"
						disabled={!selectedFile}
					>
						<Columns2Icon className="size-3" />
					</Button>
				</div>
			</div>

			{/* Two-column layout wrapper */}
			<div className="relative flex-1 min-h-0 min-w-0">
				<ResizablePanelGroup
					id="diff-panel-layout"
					orientation="horizontal"
					className="absolute inset-0"
				>
					{/* File list panel */}
					<ResizablePanel id="diff-file-list" defaultSize="30%" minSize="15%" maxSize="50%">
						<div className="h-full w-full min-w-0">
							<FileList
								files={changedFiles}
								selectedFile={selectedFile}
								onSelectFile={setSelectedFile}
								totalAdditions={totalAdditions}
								totalDeletions={totalDeletions}
							/>
						</div>
					</ResizablePanel>

					<ResizableHandle withHandle />

					{/* Diff content panel */}
					<ResizablePanel id="diff-content" defaultSize="70%">
						<div className="h-full w-full min-w-0">
							<SingleFileDiff patch={selectedPatch} filePath={selectedFile} />
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
