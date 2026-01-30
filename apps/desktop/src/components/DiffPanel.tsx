import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { PatchDiff } from "@pierre/diffs/react";
import { Columns2Icon, Loader2, RowsIcon } from "lucide-react";
import type { FocusEvent, RefObject } from "react";
import {
	forwardRef,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type DiffStyle, type DiffViewState, diffStyleAtom, diffViewStateAtom } from "@/atoms";
import { FileList, RevisionHeader } from "@/components/diff";
import { ImageDiff } from "@/components/diff/ImageDiff";
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
import { extractFilePath, parsePatchStats, splitMultiFileDiff } from "@/lib/diff-utils";
import type { ChangedFileStatus } from "@/schemas";
import type { Revision } from "@/tauri-commands";
import { isImageFile } from "@/utils/file-types";
import { cn } from "@/lib/utils";

interface DiffPanelProps {
	repoPath: string | null;
	changeId: string | null;
	revision: Revision | null;
	revisionsPanelRef: RefObject<HTMLElement | null>;
}

interface PrerenderedDiffPanelProps {
	repoPath: string | null;
	revisions: Revision[];
	selectedChangeId: string | null;
	revisionsPanelRef: RefObject<HTMLElement | null>;
}

export const PrerenderedDiffPanel = forwardRef<HTMLDivElement, PrerenderedDiffPanelProps>(
	function PrerenderedDiffPanel({ repoPath, revisions, selectedChangeId, revisionsPanelRef }, ref) {
		const selectedRevision = selectedChangeId
			? (revisions.find((r) => r.change_id === selectedChangeId) ?? null)
			: null;

		return (
			<DiffPanel
				ref={ref}
				repoPath={repoPath}
				changeId={selectedChangeId}
				revision={selectedRevision}
				revisionsPanelRef={revisionsPanelRef}
			/>
		);
	},
);

/**
 * Multi-file diff viewer - shows multiple diffs in a scrollable container
 */
function MultiFileDiff({
	patches,
	diffViewState,
	globalDiffStyle,
	repoPath,
	changeId,
}: {
	patches: Array<{ path: string; patch: string; status: ChangedFileStatus }>;
	diffViewState: DiffViewState;
	globalDiffStyle: DiffStyle;
	repoPath: string;
	changeId: string;
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
				{patches.map(({ path, patch, status }) => {
					// Check if this is an image file
					if (isImageFile(path)) {
						return (
							<div key={path} className="min-h-0">
								<ImageDiff
									repoPath={repoPath}
									changeId={changeId}
									filePath={path}
									status={status}
								/>
							</div>
						);
					}

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

export const DiffPanel = forwardRef<HTMLDivElement, DiffPanelProps>(function DiffPanel(
	{ repoPath, changeId, revision, revisionsPanelRef },
	ref,
) {
	// Defer changeId updates so revision selection highlight updates immediately
	// while diff panel data fetching/rendering happens on the next frame
	const deferredChangeId = useDeferredValue(changeId);

	const containerRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const [globalDiffStyle] = useAtom(diffStyleAtom);
	const [diffViewState, setDiffViewState] = useAtom(diffViewStateAtom);
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
	const [hasFocus, setHasFocus] = useState(false);

	// Handler for blur events - only unfocus if focus moves outside container
	const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node)) {
			setHasFocus(false);
		}
	};

	// Merge refs if external ref is provided
	const setRefs = (el: HTMLDivElement | null) => {
		(containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
		if (typeof ref === "function") {
			ref(el);
		} else if (ref) {
			ref.current = el;
		}
	};

	// Get first selected file for style override display
	const firstSelectedFile = selectedFiles.size > 0 ? [...selectedFiles][0] : null;

	// Get effective diff style for first selected file
	const effectiveDiffStyle = firstSelectedFile
		? (diffViewState.styleOverrides.get(firstSelectedFile) ?? globalDiffStyle)
		: globalDiffStyle;

	const handleSetLocalStyle = useCallback(
		(style: DiffStyle) => {
			if (selectedFiles.size === 0) return;
			setDiffViewState((prev) => {
				const next = new Map(prev.styleOverrides);
				// Apply style to all selected files
				for (const file of selectedFiles) {
					next.set(file, style);
				}
				return { ...prev, styleOverrides: next };
			});
		},
		[selectedFiles, setDiffViewState],
	);

	// Reset selected files when changeId changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally trigger on changeId change
	useEffect(() => {
		setSelectedFiles(new Set());
	}, [deferredChangeId]);

	// Keyboard navigation
	useDiffPanelKeyboard({ scrollContainerRef, revisionsPanelRef, hasFocus });

	// Fetch file changes (for the file list with status)
	const changesCollection =
		repoPath && deferredChangeId
			? getRevisionChangesCollection(repoPath, deferredChangeId)
			: emptyChangesCollection;
	const { data: changedFiles = [] } = useLiveQuery(changesCollection);

	// Fetch full diff (for the diff content)
	const diffCollection =
		repoPath && deferredChangeId
			? getRevisionDiffCollection(repoPath, deferredChangeId)
			: emptyDiffCollection;
	const { data: diffEntries = [] } = useLiveQuery(diffCollection);
	const revisionDiff = diffEntries[0]?.content ?? "";

	// Timing instrumentation for cache analysis
	console.log('[DiffPanel] selection:', changeId?.slice(0,8), 
		'deferred:', deferredChangeId?.slice(0,8),
		'changedFiles:', changedFiles.length, 
		'hasDiff:', !!revisionDiff,
		'at:', performance.now().toFixed(0));

	// Track what's currently displayed - shows previous while loading
	const [displayedState, setDisplayedState] = useState<{
		changeId: string;
		patches: Array<{ path: string; patch: string; status: ChangedFileStatus }>;
	} | null>(null);

	// Update displayed state only when new data arrives
	useEffect(() => {
		if (revisionDiff && deferredChangeId) {
			const patches = splitMultiFileDiff(revisionDiff).map((patch) => ({
				path: extractFilePath(patch) ?? "unknown",
				patch,
				status: (changedFiles.find((f) => f.path === extractFilePath(patch))?.status ??
					"modified") as ChangedFileStatus,
			}));
			setDisplayedState({ changeId: deferredChangeId, patches });
		}
	}, [revisionDiff, deferredChangeId, changedFiles]);

	// Determine if we're showing stale data
	const isStale = displayedState !== null && displayedState.changeId !== changeId;

	// Parse diff into individual file patches
	const fileDiffs = useMemo(() => splitMultiFileDiff(revisionDiff), [revisionDiff]);

	// Create a map from file path to patch content
	const patchMap = useMemo(() => {
		const map = new Map<string, string>();
		for (const patch of fileDiffs) {
			const path = extractFilePath(patch);
			if (path) {
				map.set(path, patch);
			}
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

	// Sync diffViewState atom when changeId changes (reset to initial state)
	useEffect(() => {
		const effectiveState = getDiffViewState(diffViewState, deferredChangeId);
		if (effectiveState !== diffViewState) {
			setDiffViewState(effectiveState);
		}
	}, [deferredChangeId, diffViewState, setDiffViewState]);

	// Auto-select first file when files load and none selected
	useEffect(() => {
		if (changedFiles.length > 0 && selectedFiles.size === 0) {
			setSelectedFiles(new Set([changedFiles[0].path]));
		}
	}, [changedFiles, selectedFiles.size]);

	// Get patches for selected files (in order)
	const selectedPatches = useMemo(() => {
		const patches: Array<{ path: string; patch: string; status: ChangedFileStatus }> = [];
		// Maintain file order from changedFiles
		for (const file of changedFiles) {
			if (selectedFiles.has(file.path)) {
				const patch = patchMap.get(file.path) ?? "";
				patches.push({ path: file.path, patch, status: file.status as ChangedFileStatus });
			}
		}
		return patches;
	}, [changedFiles, selectedFiles, patchMap]);

	if (!repoPath || !changeId) {
		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: Focus tracking for keyboard navigation
			<div
				ref={setRefs}
				tabIndex={-1}
				onFocus={() => setHasFocus(true)}
				onBlur={handleBlur}
				className="flex items-center justify-center h-full text-muted-foreground text-sm outline-none"
			>
				Select a revision to view diffs
			</div>
		);
	}

	// Only show "No changes" if we have no displayed state to show
	if (changedFiles.length === 0 && !displayedState) {
		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: Focus tracking for keyboard navigation
			<div
				ref={setRefs}
				tabIndex={-1}
				onFocus={() => setHasFocus(true)}
				onBlur={handleBlur}
				className="flex items-center justify-center h-full text-muted-foreground text-sm outline-none"
			>
				No changes in this revision
			</div>
		);
	}

	// Determine which patches to show - use previous while loading
	const patchesToRender = isStale && displayedState ? displayedState.patches : selectedPatches;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Focus tracking for keyboard navigation
		<div
			ref={setRefs}
			tabIndex={-1}
			onFocus={() => setHasFocus(true)}
			onBlur={handleBlur}
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
			<div ref={scrollContainerRef} className="relative flex-1 min-h-0 min-w-0 overflow-auto">
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
								hasFocus={hasFocus}
							/>
						</div>
					</ResizablePanel>

					<ResizableHandle withHandle />

					{/* Diff content panel */}
					<ResizablePanel id="diff-content" defaultSize="70%">
						<div
							className={cn(
								"h-full w-full min-w-0 relative",
								isStale && "opacity-60 pointer-events-none",
							)}
						>
							{isStale && (
								<div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
									<Loader2 className="h-6 w-6 animate-spin" />
								</div>
							)}
							<MultiFileDiff
								patches={patchesToRender}
								diffViewState={diffViewState}
								globalDiffStyle={globalDiffStyle}
								repoPath={repoPath}
								changeId={displayedState?.changeId ?? changeId}
							/>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</div>
		</div>
	);
});
