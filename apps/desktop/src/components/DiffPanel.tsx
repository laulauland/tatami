import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useSearch } from "@tanstack/react-router";
import { Route } from "@/routes/project.$projectId";
import { useEffect, useRef } from "react";
import { type DiffViewState, diffViewStateAtom } from "@/atoms";
// Note: useEffect is kept for scroll-to-file behavior, which is acceptable
// (DOM side effect, not state synchronization)
import { DiffToolbar, FileDiffSection, RevisionHeader } from "@/components/diff";
import { emptyDiffCollection, getRevisionDiffCollection } from "@/db";
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
function getDiffViewState(
	currentState: DiffViewState,
	changeId: string | null,
	firstFilePath: string | null,
): DiffViewState {
	// If changeId matches, return current state as-is
	if (currentState.forChangeId === changeId) {
		return currentState;
	}
	// ChangeId changed - return reset state
	return {
		forChangeId: changeId,
		expandedFiles: firstFilePath ? new Set([firstFilePath]) : new Set(),
		styleOverrides: new Map(),
	};
}

export function DiffPanel({ repoPath, changeId, revision }: DiffPanelProps) {
	const search = useSearch({ from: Route.fullPath });
	const { file: selectedFilePath } = search;
	const fileRefsMap = useRef<Map<string, React.RefObject<HTMLDivElement | null>>>(new Map());
	const [diffViewState, setDiffViewState] = useAtom(diffViewStateAtom);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// Keyboard navigation
	useDiffPanelKeyboard({ scrollContainerRef });

	// Always fetch all diffs
	const diffCollection =
		repoPath && changeId ? getRevisionDiffCollection(repoPath, changeId) : emptyDiffCollection;
	const { data: diffEntries = [], isLoading } = useLiveQuery(diffCollection);
	const revisionDiff = diffEntries[0]?.content ?? "";

	const fileDiffs = splitMultiFileDiff(revisionDiff);
	const filePaths = fileDiffs.map(extractFilePath);

	const firstFilePath = filePaths[0] ?? null;

	// Derive the effective state - resets automatically when changeId changes
	const effectiveState = getDiffViewState(diffViewState, changeId, firstFilePath);

	// Sync atom if state was reset (only writes when needed)
	if (effectiveState !== diffViewState) {
		setDiffViewState(effectiveState);
	}

	const { expandedFiles } = effectiveState;

	// Get or create ref for each file
	const getFileRef = (filePath: string): React.RefObject<HTMLDivElement | null> => {
		if (!fileRefsMap.current.has(filePath)) {
			fileRefsMap.current.set(filePath, { current: null });
		}
		// biome-ignore lint/style/noNonNullAssertion: Guaranteed to exist since we set it above
		return fileRefsMap.current.get(filePath)!;
	};

	// Toggle all folds
	const allExpanded = filePaths.length > 0 && filePaths.every((p) => expandedFiles.has(p));

	function handleToggleAllFolds() {
		setDiffViewState((prev) => ({
			...prev,
			expandedFiles: allExpanded ? new Set() : new Set(filePaths),
		}));
	}

	// Scroll to selected file when it changes
	useEffect(() => {
		if (!selectedFilePath || fileDiffs.length === 0) return;

		// Use requestAnimationFrame to ensure DOM is updated before scrolling
		requestAnimationFrame(() => {
			const ref = fileRefsMap.current.get(selectedFilePath);
			if (ref?.current) {
				ref.current.scrollIntoView({
					behavior: "instant",
					block: "start",
				});
			}
		});
	}, [selectedFilePath, fileDiffs.length]);

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
		<div ref={scrollContainerRef} className="h-full overflow-auto bg-background outline-none">
			{revision && (
				<div className="px-4 pt-6 pb-2">
					<RevisionHeader revision={revision} />
				</div>
			)}
			<DiffToolbar
				fileCount={fileDiffs.length}
				allExpanded={allExpanded}
				onToggleAllFolds={handleToggleAllFolds}
			/>
			{/* File diffs */}
			<div className="p-4 space-y-4">
				{fileDiffs.map((patch) => {
					const filePath = extractFilePath(patch);
					const fileRef = getFileRef(filePath);
					const isSelected = selectedFilePath === filePath;

					return (
						<FileDiffSection
							key={filePath}
							patch={patch}
							filePath={filePath}
							isSelected={isSelected}
							fileRef={fileRef}
						/>
					);
				})}
			</div>
		</div>
	);
}
