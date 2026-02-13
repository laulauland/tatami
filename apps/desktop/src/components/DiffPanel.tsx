import { useAtom } from "@effect-atom/atom-react";
import { PatchDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { Columns2Icon, Loader2, RowsIcon } from "lucide-react";
import type { FocusEvent, RefObject } from "react";
import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DiffStyle, type DiffViewState, diffStyleAtom, diffViewStateAtom } from "@/atoms";
import { FileList, RevisionHeader } from "@/components/diff";
import { ImageDiff } from "@/components/diff/ImageDiff";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useDiffPanelKeyboard } from "@/hooks/useDiffPanelKeyboard";
import { useChanges, useDiff, usePrefetch } from "@/hooks/useRevisionData";
import { extractFilePath, parsePatchStats, splitMultiFileDiff } from "@/lib/diff-utils";
import { traceLog } from "@/lib/trace";
import { cn } from "@/lib/utils";
import type { ChangedFileStatus } from "@/schemas";
import { getConflictPaths, getRevisionDiff, type Revision } from "@/tauri-commands";
import { isImageFile } from "@/utils/file-types";

interface DiffPanelProps {
	repoPath: string | null;
	changeId: string | null;
	revision: Revision | null;
	revisionsPanelRef: RefObject<HTMLElement | null>;
	onDescribe?: (changeId: string, description: string) => void;
}

interface PrerenderedDiffPanelProps {
	repoPath: string | null;
	revisions: Revision[];
	selectedChangeId: string | null;
	revisionsPanelRef: RefObject<HTMLElement | null>;
	onDescribe?: (changeId: string, description: string) => void;
}

export const PrerenderedDiffPanel = forwardRef<HTMLDivElement, PrerenderedDiffPanelProps>(
	function PrerenderedDiffPanel({
		repoPath,
		revisions,
		selectedChangeId,
		revisionsPanelRef,
		onDescribe,
	}, ref) {
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
				onDescribe={onDescribe}
			/>
		);
	},
);

/**
 * Loading skeleton for DiffPanel - shown during Suspense fallback.
 * Mimics the structure of the real DiffPanel for smooth transitions.
 */
export function DiffPanelSkeleton() {
	return (
		<div className="h-full w-full flex flex-col bg-background">
			{/* Revision header skeleton */}
			<div className="px-4 pt-2 pb-2 shrink-0">
				<div className="flex items-center gap-2">
					<Skeleton className="h-5 w-16" />
					<Skeleton className="h-4 w-48" />
				</div>
			</div>

			{/* Toolbar skeleton */}
			<div className="flex items-center justify-end px-3 py-2 border-b border-border bg-background shrink-0">
				<div className="flex items-center gap-0.5">
					<Skeleton className="h-6 w-6 rounded" />
					<Skeleton className="h-6 w-6 rounded" />
				</div>
			</div>

			{/* Content skeleton - two column layout */}
			<div className="flex-1 min-h-0 flex">
				{/* File list skeleton */}
				<div className="w-[30%] border-r border-border p-2 space-y-2">
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-5/6" />
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-4/5" />
				</div>

				{/* Diff content skeleton */}
				<div className="flex-1 p-4 space-y-3">
					<div className="flex items-center justify-center h-full">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
					</div>
				</div>
			</div>
		</div>
	);
}

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
	// Track render timing
	const renderStart = performance.now();
	const totalPatchBytes = patches.reduce((sum, p) => sum + p.patch.length, 0);

	if (patches.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				Select a file to view its diff
			</div>
		);
	}

	const result = (
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

	const renderMs = performance.now() - renderStart;
	if (renderMs > 5) {
		traceLog("MultiFileDiff-render", {
			changeId: changeId.slice(0, 8),
			files: patches.length,
			patchKB: Math.round(totalPatchBytes / 1024),
			renderMs: Math.round(renderMs),
		});
	}

	return result;
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

/**
 * Custom comparison function for DiffPanel memoization.
 * Only re-renders when essential props change, ignoring ref changes.
 */
function diffPanelPropsAreEqual(prevProps: DiffPanelProps, nextProps: DiffPanelProps): boolean {
	return (
		prevProps.repoPath === nextProps.repoPath &&
		prevProps.changeId === nextProps.changeId &&
		prevProps.revision?.change_id === nextProps.revision?.change_id
		// Note: revisionsPanelRef is intentionally excluded - refs are stable
	);
}

export const DiffPanel = React.memo(
	forwardRef<HTMLDivElement, DiffPanelProps>(function DiffPanel(
		{ repoPath, changeId, revision, revisionsPanelRef, onDescribe },
		ref,
	) {
		// Use changeId directly - data is prefetched and cached, so no need to defer
		// (useDeferredValue was adding unnecessary latency when data is already available)
		const deferredChangeId = changeId;

		const containerRef = useRef<HTMLDivElement>(null);
		const scrollContainerRef = useRef<HTMLDivElement>(null);
		const [globalDiffStyle] = useAtom(diffStyleAtom);
		const [diffViewState, setDiffViewState] = useAtom(diffViewStateAtom);
		const [hasFocus, setHasFocus] = useState(false);

		// Track selected files with the changeId they belong to
		// When changeId changes, we reset selection during render (no useEffect needed)
		const [selectedFilesState, setSelectedFilesState] = useState<{
			forChangeId: string | null;
			files: Set<string>;
		}>({ forChangeId: null, files: new Set() });

		// Derive effective selected files - reset if changeId changed
		const selectedFiles =
			selectedFilesState.forChangeId === deferredChangeId
				? selectedFilesState.files
				: new Set<string>();

		// Wrapper to update selected files with changeId tracking
		const setSelectedFiles = useCallback(
			(files: Set<string> | ((prev: Set<string>) => Set<string>)) => {
				setSelectedFilesState((prev) => {
					const newFiles = typeof files === "function" ? files(prev.files) : files;
					return { forChangeId: deferredChangeId, files: newFiles };
				});
			},
			[deferredChangeId],
		);

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

		// Keyboard navigation
		useDiffPanelKeyboard({ scrollContainerRef, revisionsPanelRef, hasFocus });

		// Prefetch hook for triggering data load
		const { prefetchDiffs, prefetchChanges } = usePrefetch(repoPath ?? "");

		// Read file changes from unified collection
		// isLoaded distinguishes "still loading" from "genuinely empty"
		const { data: changesRecords, isLoaded: _changesLoaded } = useChanges(
			repoPath ?? "",
			deferredChangeId,
		);
		const changedFiles = useMemo(
			() => changesRecords.map((c) => ({ path: c.path, status: c.status })),
			[changesRecords],
		);

		// Read diff from unified collection
		const diffRecord = useDiff(repoPath ?? "", deferredChangeId);
		const {
			data: fallbackDiff,
			error: diffError,
			refetch: retryDiff,
			isFetching: isRetryingDiff,
		} = useQuery({
			queryKey: ["diff-fallback", repoPath, deferredChangeId],
			queryFn: () => getRevisionDiff(repoPath ?? "", deferredChangeId ?? ""),
			enabled: !!repoPath && !!deferredChangeId && !diffRecord,
			retry: false,
		});
		const revisionDiff = diffRecord?.content ?? fallbackDiff ?? "";

		const { data: conflictPaths = [] } = useQuery({
			queryKey: ["conflict-paths", repoPath, deferredChangeId],
			queryFn: () => getConflictPaths(repoPath ?? "", deferredChangeId ?? ""),
			enabled: !!repoPath && !!deferredChangeId && !!revision?.has_conflict,
			retry: false,
		});
		const conflictPathSet = useMemo(() => new Set(conflictPaths), [conflictPaths]);

		// Trigger prefetch when selection changes
		useEffect(() => {
			if (repoPath && deferredChangeId) {
				// Check if diff is already cached before requesting
				const diffAlreadyCached = !!diffRecord && diffRecord.changeId === deferredChangeId;
				traceLog("selection-change", {
					changeId: deferredChangeId,
					diffCached: diffAlreadyCached,
					source: "DiffPanel",
				});
				prefetchDiffs([deferredChangeId]);
				prefetchChanges([deferredChangeId]);
			}
		}, [repoPath, deferredChangeId, prefetchDiffs, prefetchChanges, diffRecord]);

		// Log when data appears (only on actual changes)
		useEffect(() => {
			if (changedFiles.length > 0 && deferredChangeId) {
				traceLog("changes-loaded", { changeId: deferredChangeId, fileCount: changedFiles.length });
			}
		}, [changedFiles.length, deferredChangeId]);

		useEffect(() => {
			if (diffRecord && deferredChangeId) {
				traceLog("diff-loaded", { changeId: deferredChangeId, size: revisionDiff.length });
			}
		}, [diffRecord, deferredChangeId, revisionDiff.length]);

		// Derive effective diffViewState - reset when changeId changes (no useEffect needed)
		const effectiveDiffViewState = getDiffViewState(diffViewState, deferredChangeId);

		// Sync atom if it needs reset (one-time sync, not a loop)
		if (effectiveDiffViewState !== diffViewState) {
			// Schedule update for next microtask to avoid setState during render
			queueMicrotask(() => setDiffViewState(effectiveDiffViewState));
		}

		// Derive effective selected files with auto-select first file
		const effectiveSelectedFiles = useMemo(() => {
			// If we have selected files for this changeId, use them
			if (selectedFiles.size > 0) return selectedFiles;
			// Auto-select first file when files load and none selected
			if (changedFiles.length > 0) {
				return new Set([changedFiles[0].path]);
			}
			return selectedFiles;
		}, [selectedFiles, changedFiles]);

		// Get first selected file for style override display
		const firstSelectedFile =
			effectiveSelectedFiles.size > 0 ? [...effectiveSelectedFiles][0] : null;

		// Get effective diff style for first selected file
		const effectiveDiffStyle = firstSelectedFile
			? (effectiveDiffViewState.styleOverrides.get(firstSelectedFile) ?? globalDiffStyle)
			: globalDiffStyle;

		const handleSetLocalStyle = useCallback(
			(style: DiffStyle) => {
				if (effectiveSelectedFiles.size === 0) return;
				setDiffViewState((prev) => {
					const next = new Map(prev.styleOverrides);
					// Apply style to all selected files
					for (const file of effectiveSelectedFiles) {
						next.set(file, style);
					}
					return { ...prev, styleOverrides: next };
				});
			},
			[effectiveSelectedFiles, setDiffViewState],
		);

		// Track last valid displayed state using a ref (avoids useEffect for caching)
		const lastValidStateRef = useRef<{
			changeId: string;
			patches: Array<{ path: string; patch: string; status: ChangedFileStatus }>;
		} | null>(null);

		// Compute current patches when data is available
		// Note: diffRecord existing means data was fetched (even if content is empty for empty commits)
		const currentPatches = useMemo(() => {
			if (!diffRecord || !deferredChangeId) return null;
			// Empty diff is valid (empty commit) - return empty array, not null
			return splitMultiFileDiff(revisionDiff).map((patch) => ({
				path: extractFilePath(patch) ?? "unknown",
				patch,
				status: (changedFiles.find((f) => f.path === extractFilePath(patch))?.status ??
					"modified") as ChangedFileStatus,
			}));
		}, [diffRecord, revisionDiff, deferredChangeId, changedFiles]);

		// Update ref when we have valid data (side effect during render is fine for refs)
		if (currentPatches && deferredChangeId) {
			lastValidStateRef.current = { changeId: deferredChangeId, patches: currentPatches };
		}

		// Use current data if available, otherwise fall back to last valid state
		const displayedState =
			currentPatches && deferredChangeId
				? { changeId: deferredChangeId, patches: currentPatches }
				: lastValidStateRef.current;

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

		// Get patches for selected files (in order)
		const selectedPatches = useMemo(() => {
			const patches: Array<{ path: string; patch: string; status: ChangedFileStatus }> = [];
			// Maintain file order from changedFiles
			for (const file of changedFiles) {
				if (effectiveSelectedFiles.has(file.path)) {
					const patch = patchMap.get(file.path) ?? "";
					patches.push({ path: file.path, patch, status: file.status as ChangedFileStatus });
				}
			}
			return patches;
		}, [changedFiles, effectiveSelectedFiles, patchMap]);

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

		if (diffError && !diffRecord) {
			return (
				// biome-ignore lint/a11y/noStaticElementInteractions: Focus tracking for keyboard navigation
				<div
					ref={setRefs}
					tabIndex={-1}
					onFocus={() => setHasFocus(true)}
					onBlur={handleBlur}
					className="flex h-full items-center justify-center outline-none"
				>
					<div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-center">
						<p className="text-sm text-destructive">Failed to load diff</p>
						<button
							type="button"
							onClick={() => void retryDiff()}
							className="mt-3 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
							disabled={isRetryingDiff}
						>
							{isRetryingDiff ? "Retrying..." : "Retry"}
						</button>
					</div>
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
						<RevisionHeader
							revision={revision}
							conflictPaths={conflictPaths}
							onDescribe={onDescribe}
						/>
					</div>
				)}

				{/* Toolbar */}
				<div className="flex items-center justify-end px-3 py-2 border-b border-border bg-background shrink-0 min-w-0">
					<fieldset
						className="relative flex items-center rounded-md border border-border/70 bg-muted/60 p-0.5 shadow-inner shrink-0"
						aria-label="Diff style"
					>
						<div
							className={`absolute top-0.5 h-5 w-5 rounded-sm bg-background shadow-sm transition-transform duration-200 ${
								effectiveDiffStyle === "unified" ? "translate-x-0" : "translate-x-5"
							}`}
						/>
						<button
							type="button"
							className="relative z-10 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
							onClick={() => handleSetLocalStyle("unified")}
							title="Unified diff view"
							aria-label="Unified diff view"
							disabled={effectiveSelectedFiles.size === 0}
						>
							<RowsIcon
								className={`size-3 ${effectiveDiffStyle === "unified" ? "text-foreground" : ""}`}
							/>
						</button>
						<button
							type="button"
							className="relative z-10 inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
							onClick={() => handleSetLocalStyle("split")}
							title="Split diff view"
							aria-label="Split diff view"
							disabled={effectiveSelectedFiles.size === 0}
						>
							<Columns2Icon
								className={`size-3 ${effectiveDiffStyle === "split" ? "text-foreground" : ""}`}
							/>
						</button>
					</fieldset>
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
									repoPath={repoPath}
									files={changedFiles}
									selectedFiles={effectiveSelectedFiles}
									onSelectFiles={setSelectedFiles}
									totalAdditions={totalAdditions}
									totalDeletions={totalDeletions}
									hasFocus={hasFocus}
									conflictPaths={conflictPathSet}
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
	}),
	diffPanelPropsAreEqual,
);
