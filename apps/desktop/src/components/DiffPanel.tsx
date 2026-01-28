import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { PatchDiff } from "@pierre/diffs/react";
import { Columns2Icon, RowsIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DiffStyle, type DiffViewState, diffStyleAtom, diffViewStateAtom } from "@/atoms";
import { FileList, RevisionHeader } from "@/components/diff";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
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
 * Multi-file diff viewer - shows multiple diffs in a scrollable container
 */
function MultiFileDiff({
	patches,
	diffViewState,
	globalDiffStyle,
}: {
	patches: Array<{ path: string; patch: string }>;
	diffViewState: DiffViewState;
	globalDiffStyle: DiffStyle;
}) {
	if (patches.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				Select a file to view its diff
			</div>
		);
	}

	return (
		<ScrollArea className="h-full w-full">
			<div className="divide-y divide-border">
				{patches.map(({ path, patch }) => {
					const effectiveStyle = diffViewState.styleOverrides.get(path) ?? globalDiffStyle;
					return (
						<div key={path} className="min-h-0">
							{!patch.trim() ? (
								<div className="px-4 py-8 text-center text-muted-foreground text-sm">
									No changes in {path}
								</div>
							) : (
								<PatchDiff
									patch={patch}
									options={{ hunkSeparators: "line-info", diffStyle: effectiveStyle }}
								/>
							)}
						</div>
					);
				})}
			</div>
		</ScrollArea>
	);
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
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
	const prevChangeIdRef = useRef<string | null>(null);

	// Get first selected file for style override display
	const firstSelectedFile = selectedFiles.size > 0 ? [...selectedFiles][0] : null;

	// Get effective diff style for first selected file
	const effectiveDiffStyle = firstSelectedFile
		? (diffViewState.styleOverrides.get(firstSelectedFile) ?? globalDiffStyle)
		: globalDiffStyle;

	function handleSetLocalStyle(style: DiffStyle) {
		if (selectedFiles.size === 0) return;
		setDiffViewState((prev) => {
			const next = new Map(prev.styleOverrides);
			// Apply style to all selected files
			for (const file of selectedFiles) {
				next.set(file, style);
			}
			return { ...prev, styleOverrides: next };
		});
	}

	// Reset selected files when changeId changes
	if (prevChangeIdRef.current !== changeId) {
		prevChangeIdRef.current = changeId;
		if (selectedFiles.size > 0) {
			setSelectedFiles(new Set());
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
		if (changedFiles.length > 0 && selectedFiles.size === 0) {
			setSelectedFiles(new Set([changedFiles[0].path]));
		}
	}, [changedFiles, selectedFiles.size]);

	// Get patches for selected files (in order)
	const selectedPatches = useMemo(() => {
		const patches: Array<{ path: string; patch: string }> = [];
		// Maintain file order from changedFiles
		for (const file of changedFiles) {
			if (selectedFiles.has(file.path)) {
				const patch = patchMap.get(file.path);
				if (patch) {
					patches.push({ path: file.path, patch });
				}
			}
		}
		return patches;
	}, [changedFiles, selectedFiles, patchMap]);

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
				<div className="px-4 pt-2 pb-2 shrink-0">
					<RevisionHeader revision={revision} />
				</div>
			)}

			{/* Toolbar */}
			<div className="flex items-center justify-end px-3 py-2 border-b border-border bg-background shrink-0 min-w-0">
				<div className="flex items-center gap-0.5 shrink-0">
					<Button
						variant={effectiveDiffStyle === "unified" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => handleSetLocalStyle("unified")}
						title="Unified diff view"
						className="h-6 w-6"
						disabled={selectedFiles.size === 0}
					>
						<RowsIcon className="size-3" />
					</Button>
					<Button
						variant={effectiveDiffStyle === "split" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={() => handleSetLocalStyle("split")}
						title="Split diff view"
						className="h-6 w-6"
						disabled={selectedFiles.size === 0}
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
								selectedFiles={selectedFiles}
								onSelectFiles={setSelectedFiles}
								totalAdditions={totalAdditions}
								totalDeletions={totalDeletions}
							/>
						</div>
					</ResizablePanel>

					<ResizableHandle withHandle />

					{/* Diff content panel */}
					<ResizablePanel id="diff-content" defaultSize="70%">
						<div className="h-full w-full min-w-0">
							<MultiFileDiff
								patches={selectedPatches}
								diffViewState={diffViewState}
								globalDiffStyle={globalDiffStyle}
							/>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
}
