import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FolderOpenIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Profiler, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Route as ProjectRoute } from "@/routes/project.$projectId";
import {
	debouncedChangeIdAtom,
	expandedStacksAtom,
	searchOpenAtom,
	shortcutsHelpOpenAtom,
} from "@/atoms";

const NARROW_BREAKPOINT = 768;
const DEFAULT_SIDEBAR_WIDTH = 25;
const MIN_SIDEBAR_WIDTH = 15;
const MAX_SIDEBAR_WIDTH = 70;

function clampSidebarWidth(width: number | null | undefined): number {
	if (typeof width !== "number" || Number.isNaN(width)) {
		return DEFAULT_SIDEBAR_WIDTH;
	}
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function subscribeToMediaQuery(callback: () => void) {
	const mediaQuery = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`);
	mediaQuery.addEventListener("change", callback);
	return () => mediaQuery.removeEventListener("change", callback);
}

function getIsNarrowScreen() {
	return window.matchMedia(`(max-width: ${NARROW_BREAKPOINT}px)`).matches;
}

function useIsNarrowScreen() {
	return useSyncExternalStore(subscribeToMediaQuery, getIsNarrowScreen, () => false);
}

import { Search } from "@/components/Search";
import { CommandPalette } from "@/components/CommandPalette";
import { PrerenderedDiffPanel } from "@/components/DiffPanel";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { OperationsLog } from "@/components/OperationsLog";
import { ProjectPicker } from "@/components/ProjectPicker";
import { RevisionGraph, type RevisionGraphHandle } from "@/components/RevisionGraph";
import { detectStacks, reorderForGraph } from "@/components/revision-graph-utils";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/EmptyState";

import {
	abandonRevision,
	describeRevision,
	editRevision,
	emptyCommitRecencyCollection,
	emptyRevisionsCollection,
	getCommitRecencyCollection,
	getRevisionKey,
	getRevisionsCollection,
	newRevision,
	rebaseRevision,
	repositoriesCollection,
	setupRepoWatcher,
	squashRevision,
	syncRepository,
	teardownRepoWatcher,
} from "@/db";
import { useAddRepository } from "@/hooks/useAddRepository";
import { useAppTitle } from "@/hooks/useAppTitle";
import { useKeyboardNavigation, useKeyboardShortcut, useKeySequence } from "@/hooks/useKeyboard";
import { useSelectedRevision } from "@/hooks/useSelectedRevision";
import {
	getLayout,
	updateLayout,
	type AppLayout,
	type Repository,
	type Revision,
} from "@/tauri-commands";
import { switchProjectWithWatcherCleanup } from "@/lib/project-switch";
import { onRenderCallback } from "@/lib/trace";

// Wrapper component that handles the case when no project is selected
export function AppShell() {
	const { projectId } = useParams({ strict: false });

	if (!projectId) {
		return <AppShellEmpty />;
	}

	return <AppShellWithProject />;
}

// Empty state when no project is selected (rendered from root "/" route)
function AppShellEmpty() {
	const navigate = useNavigate();
	const { handleAddRepository } = useAddRepository();
	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);
	const [projectPickerOpen, setProjectPickerOpen] = useState(false);
	const [, setShortcutsOpen] = useAtom(shortcutsHelpOpenAtom);

	function handleSelectRepository(repository: Repository) {
		navigate({ to: "/project/$projectId", params: { projectId: repository.id } });
	}

	useAppTitle("Tatami");

	return (
		<>
			<Search revisions={[]} repoPath={null} onJump={() => {}} />
			<CommandPalette
				onOpenRepo={handleAddRepository}
				onOpenProjects={() => navigate({ to: "/repositories" })}
				onOpenSettings={() => navigate({ to: "/settings" })}
			/>
			<KeyboardShortcutsHelp />
			<ProjectPicker
				repositories={repositories}
				onSelectRepository={handleSelectRepository}
				open={projectPickerOpen}
				onOpenChange={setProjectPickerOpen}
			/>
			<div className="flex flex-col h-screen overflow-hidden">
				<div className="flex-1 min-h-0 flex flex-col">
					<div className="px-2 py-2 shrink-0">
						<Button
							variant="ghost"
							size="sm"
							className="h-7 px-2 gap-1.5 text-sm font-medium"
							onClick={() => setProjectPickerOpen(true)}
						>
							<FolderOpenIcon className="size-4" />
							<span className="truncate">Open Repository</span>
						</Button>
					</div>
					<div className="flex-1 flex items-center justify-center min-h-0">
						<EmptyState
							onOpenRepo={handleAddRepository}
							onOpenShortcutsHelp={() => setShortcutsOpen(true)}
						/>
					</div>
				</div>
			</div>
		</>
	);
}

// Full app shell when a project is selected (rendered from "/project/$projectId" route)
function AppShellWithProject() {
	const navigate = useNavigate({ from: ProjectRoute.fullPath });
	const { projectId } = useParams({ from: ProjectRoute.fullPath });
	const rev = useSearch({ from: ProjectRoute.fullPath, select: (s) => s.rev });
	const [flash, setFlash] = useState<{ changeId: string; key: number } | null>(null);
	const [, setSearchOpen] = useAtom(searchOpenAtom);
	const [pendingAbandon, setPendingAbandon] = useState<Revision | null>(null);
	const [editingChangeId, setEditingChangeId] = useState<string | null>(null);
	const [rebaseSourceKey, setRebaseSourceKey] = useState<string | null>(null);
	const [projectPickerOpen, setProjectPickerOpen] = useState(false);
	const [isSyncing, setIsSyncing] = useState(false);
	const [operationsLogOpen, setOperationsLogOpen] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
	const [splitLayoutSeed, setSplitLayoutSeed] = useState(0);
	const revisionGraphRef = useRef<RevisionGraphHandle>(null);
	const revisionsPanelRef = useRef<HTMLDivElement>(null);
	const diffPanelRef = useRef<HTMLDivElement>(null);
	const layoutHydratedRef = useRef(false);
	const selectionRestoredForProjectRef = useRef<string | null>(null);
	const persistLayoutTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const skipWatcherCleanupRef = useRef<string | null>(null);
	const isNarrowScreen = useIsNarrowScreen();
	const { handleAddRepository } = useAddRepository();

	useKeyboardShortcut({
		key: ",",
		modifiers: { meta: true, ctrl: true },
		onPress: () => navigate({ to: "/settings" }),
	});

	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);

	const activeProject = repositories.find((p) => p.id === projectId) ?? null;

	useEffect(() => {
		const repoPath = activeProject?.path;
		if (!repoPath) return;

		void setupRepoWatcher(repoPath).catch(() => {});

		return () => {
			if (skipWatcherCleanupRef.current === repoPath) {
				skipWatcherCleanupRef.current = null;
				return;
			}
			void teardownRepoWatcher(repoPath).catch(() => {});
		};
	}, [activeProject?.path]);

	const { data: persistedLayout } = useQuery({
		queryKey: ["app-layout"],
		queryFn: getLayout,
		staleTime: Number.POSITIVE_INFINITY,
	});

	useAppTitle(activeProject ? `Tatami - ${activeProject.path}` : "Tatami");

	const revisionsCollection = activeProject
		? getRevisionsCollection(activeProject.path, activeProject.revset_preset ?? "full_history")
		: emptyRevisionsCollection;

	const {
		data: revisions = [],
		isLoading = false,
		isError: revisionsLoadFailed,
		status: revisionsStatus,
		collection: revisionsLiveCollection,
	} = useLiveQuery(revisionsCollection);

	// Fetch commit recency data for branch ordering
	const commitRecencyCollection = activeProject?.path
		? getCommitRecencyCollection(activeProject.path)
		: emptyCommitRecencyCollection;
	const { data: commitRecencyEntries = [] } = useLiveQuery(commitRecencyCollection);
	const commitRecency = commitRecencyEntries[0]?.data ?? undefined;

	const orderedRevisions = reorderForGraph(revisions, commitRecency);

	// Compute visible change IDs (filters out collapsed stack intermediates)
	// This mirrors the logic in RevisionGraph but avoids parent-child state sync via useEffect
	const [expandedStacks] = useAtom(expandedStacksAtom);
	const visibleRevisions = useMemo(() => {
		const stacks = detectStacks(revisions);
		if (stacks.length === 0) return orderedRevisions;

		// Build set of intermediate change IDs that are hidden when collapsed
		const hiddenChangeIds = new Set<string>();
		for (const stack of stacks) {
			if (!expandedStacks.has(stack.id)) {
				for (const changeId of stack.intermediateChangeIds) {
					hiddenChangeIds.add(changeId);
				}
			}
		}

		if (hiddenChangeIds.size === 0) return orderedRevisions;
		return orderedRevisions.filter((r) => !hiddenChangeIds.has(r.change_id));
	}, [revisions, orderedRevisions, expandedStacks]);

	const selectedRevision = useSelectedRevision(revisions, rev);
	const selectedRevisionKey = selectedRevision ? getRevisionKey(selectedRevision) : null;
	const rebaseSourceRevision = rebaseSourceKey
		? (revisions.find((r) => getRevisionKey(r) === rebaseSourceKey) ?? null)
		: null;
	const isPickingRebaseDestination = !!rebaseSourceRevision;
	const revisionsErrorMessage =
		revisionsStatus === "error" || revisionsLoadFailed
			? "Could not fetch revisions from jj."
			: null;

	const handleRetryRevisions = () => {
		void revisionsLiveCollection.preload();
	};

	// ast-grep-ignore: no-useeffect-state-sync
	useEffect(() => {
		if (!persistedLayout) return;

		setSidebarWidth(clampSidebarWidth(persistedLayout.sidebar_width));
		setSplitLayoutSeed((seed) => seed + 1);
		layoutHydratedRef.current = true;
	}, [persistedLayout]);

	useEffect(() => {
		if (!layoutHydratedRef.current) return;
		if (selectionRestoredForProjectRef.current === projectId) return;
		if (isLoading) return;

		selectionRestoredForProjectRef.current = projectId;

		if (rev) return;
		if (!persistedLayout) return;
		if (persistedLayout.active_project_id !== projectId) return;

		const persistedSelection = persistedLayout.selected_change_id;
		if (!persistedSelection) return;

		const selectionExists = revisions.some((revision) => {
			const revisionKey = getRevisionKey(revision);
			return revisionKey === persistedSelection || revision.change_id === persistedSelection;
		});
		if (!selectionExists) return;

		navigate({
			to: "/project/$projectId",
			params: { projectId },
			search: { rev: persistedSelection },
			replace: true,
		});
	}, [isLoading, navigate, persistedLayout, projectId, rev, revisions]);

	// ast-grep-ignore: no-useeffect-state-sync
	useEffect(() => {
		if (!layoutHydratedRef.current) return;
		if (!projectId) return;

		if (persistLayoutTimerRef.current) {
			clearTimeout(persistLayoutTimerRef.current);
		}

		const layoutUpdate: AppLayout = {
			active_project_id: projectId,
			selected_change_id: selectedRevisionKey,
			sidebar_width: clampSidebarWidth(sidebarWidth),
		};

		persistLayoutTimerRef.current = setTimeout(() => {
			void updateLayout(layoutUpdate).catch(() => {});
		}, 250);

		return () => {
			if (persistLayoutTimerRef.current) {
				clearTimeout(persistLayoutTimerRef.current);
			}
		};
	}, [projectId, selectedRevisionKey, sidebarWidth]);

	// ast-grep-ignore: no-useeffect-state-sync
	useEffect(() => {
		if (!editingChangeId) return;
		if (!selectedRevision || getRevisionKey(selectedRevision) !== editingChangeId) {
			setEditingChangeId(null);
		}
	}, [editingChangeId, selectedRevision]);

	// ast-grep-ignore: no-useeffect-state-sync
	useEffect(() => {
		if (!rebaseSourceKey) return;
		const stillExists = revisions.some((revision) => getRevisionKey(revision) === rebaseSourceKey);
		if (!stillExists) {
			setRebaseSourceKey(null);
		}
	}, [rebaseSourceKey, revisions]);

	// Debounce the changeId passed to DiffPanel to avoid expensive re-renders during rapid navigation
	// DiffPanel only updates when navigation settles (200ms without movement)
	const selectedChangeId = selectedRevision?.change_id ?? null;
	const [debouncedChangeId, setDebouncedChangeId] = useAtom(debouncedChangeIdAtom);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// ast-grep-ignore: no-useeffect-state-sync
	useEffect(() => {
		// Clear any pending debounce
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		// Update after 50ms of no changes
		debounceTimerRef.current = setTimeout(() => {
			setDebouncedChangeId(selectedChangeId);
		}, 50);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [selectedChangeId, setDebouncedChangeId]);

	async function handleSelectRepository(repository: Repository) {
		const previousRepoPath = activeProject?.path ?? null;
		await switchProjectWithWatcherCleanup(previousRepoPath, repository, {
			onTeardownSuccess: (repoPath) => {
				skipWatcherCleanupRef.current = repoPath;
			},
			navigateToProject: (nextProjectId) => {
				navigate({ to: "/project/$projectId", params: { projectId: nextProjectId } });
			},
		}).catch(() => {
			// Ignore teardown errors and still allow project switch.
		});
	}

	function handleSelectRevision(revision: Revision) {
		if (!projectId) return;
		navigate({
			to: "/project/$projectId",
			params: { projectId },
			search: { rev: getRevisionKey(revision) },
		});
	}

	function handleNavigateToChangeId(changeId: string) {
		if (!projectId) return;
		navigate({
			to: "/project/$projectId",
			params: { projectId },
			search: { rev: changeId || undefined },
		});
	}

	useKeyboardNavigation({
		orderedRevisions: visibleRevisions,
		selectedChangeId: rev ?? null,
		onNavigate: handleNavigateToChangeId,
		scrollToChangeId: (changeId) => revisionGraphRef.current?.scrollToChangeId(changeId),
		disableBasicNavigation: true, // j/k/arrows handled in RevisionGraph for display row awareness
	});

	function triggerFlash(changeId: string) {
		setFlash({ changeId, key: Date.now() });
		setTimeout(() => setFlash(null), 400);
	}

	function handleYankId() {
		if (!selectedRevision) return;
		navigator.clipboard.writeText(selectedRevision.change_id);
		triggerFlash(selectedRevision.change_id);
	}

	function handleYankLink() {
		if (!selectedRevision || !projectId) return;
		const link = `tatami://project/${projectId}/revision/${selectedRevision.change_id}`;
		navigator.clipboard.writeText(link);
		triggerFlash(selectedRevision.change_id);
	}

	useKeySequence({ sequence: "yy", onTrigger: handleYankId, enabled: !!selectedRevision });
	useKeySequence({
		sequence: "yY",
		onTrigger: handleYankLink,
		enabled: !!selectedRevision && !!projectId,
	});

	function handleNew() {
		if (!activeProject || !selectedRevision) return;
		const currentWC = revisions.find((r) => r.is_working_copy);
		newRevision(
			revisionsCollection,
			activeProject.path,
			[selectedRevision.change_id],
			selectedRevision,
			currentWC ?? null,
		);
	}

	function handleEdit() {
		if (!activeProject || !selectedRevision) return;
		const currentWC = revisions.find((r) => r.is_working_copy);
		editRevision(revisionsCollection, activeProject.path, selectedRevision, currentWC ?? null);
	}

	function handleSquash() {
		if (!activeProject || !selectedRevision) return;
		squashRevision(revisionsCollection, activeProject.path, selectedRevision);
	}

	function handleStartRebase() {
		if (!selectedRevision || selectedRevision.is_immutable) return;
		setPendingAbandon(null);
		setEditingChangeId(null);
		setRebaseSourceKey(getRevisionKey(selectedRevision));
	}

	function handleCancelRebaseDestinationPick() {
		setRebaseSourceKey(null);
	}

	function handlePickRebaseDestination(destinationRevision: Revision) {
		if (!activeProject || !rebaseSourceRevision) return;
		rebaseRevision(
			revisionsCollection,
			activeProject.path,
			rebaseSourceRevision,
			destinationRevision,
		);
		setRebaseSourceKey(null);
	}

	useKeyboardShortcut({
		key: "n",
		onPress: handleNew,
		enabled:
			!!activeProject &&
			!!selectedRevision &&
			!pendingAbandon &&
			!isPickingRebaseDestination &&
			!editingChangeId,
	});

	useKeyboardShortcut({
		key: "e",
		onPress: handleEdit,
		enabled:
			!!activeProject &&
			!!selectedRevision &&
			!pendingAbandon &&
			!isPickingRebaseDestination &&
			!editingChangeId,
	});

	useKeyboardShortcut({
		key: "s",
		onPress: handleSquash,
		enabled:
			!!activeProject &&
			!!selectedRevision &&
			!selectedRevision.is_immutable &&
			!pendingAbandon &&
			!isPickingRebaseDestination &&
			!editingChangeId,
	});

	useKeyboardShortcut({
		key: "r",
		onPress: () => {
			if (isPickingRebaseDestination) {
				handleCancelRebaseDestinationPick();
				return;
			}
			handleStartRebase();
		},
		enabled:
			isPickingRebaseDestination ||
			(!!activeProject &&
				!!selectedRevision &&
				!selectedRevision.is_immutable &&
				!pendingAbandon &&
				!editingChangeId),
	});

	useKeyboardShortcut({
		key: "Enter",
		onPress: () => {
			if (!selectedRevision) return;
			handlePickRebaseDestination(selectedRevision);
		},
		enabled:
			isPickingRebaseDestination &&
			!!selectedRevision &&
			getRevisionKey(selectedRevision) !== rebaseSourceKey,
	});

	useKeyboardShortcut({
		key: "Escape",
		onPress: handleCancelRebaseDestinationPick,
		enabled: isPickingRebaseDestination,
	});

	useKeyboardShortcut({
		key: "d",
		onPress: handleStartDescribe,
		enabled:
			!!selectedRevision &&
			!selectedRevision.is_immutable &&
			!pendingAbandon &&
			!isPickingRebaseDestination,
	});

	function handleDescribe(changeId: string, description: string) {
		if (!activeProject) return;
		const revision = revisions.find((r) => getRevisionKey(r) === changeId);
		if (!revision || revision.is_immutable) return;
		describeRevision(revisionsCollection, activeProject.path, revision, description);
		setEditingChangeId(null);
	}

	function handleStartDescribe() {
		if (!selectedRevision || selectedRevision.is_immutable) return;
		setRebaseSourceKey(null);
		setEditingChangeId(getRevisionKey(selectedRevision));
	}

	function handleCancelDescribe() {
		setEditingChangeId(null);
	}

	function handleAbandon() {
		if (!activeProject || !selectedRevision) return;
		// Don't abandon immutable revisions (trunk ancestors)
		if (selectedRevision.is_immutable) return;
		setRebaseSourceKey(null);
		setEditingChangeId(null);
		// Show confirmation
		setPendingAbandon(selectedRevision);
	}

	function confirmAbandon() {
		if (!activeProject || !pendingAbandon) return;
		abandonRevision(revisionsCollection, activeProject.path, pendingAbandon);
		setPendingAbandon(null);
	}

	function cancelAbandon() {
		setPendingAbandon(null);
	}

	useKeyboardShortcut({
		key: "a",
		onPress: handleAbandon,
		enabled:
			!!activeProject &&
			!!selectedRevision &&
			!pendingAbandon &&
			!isPickingRebaseDestination &&
			!editingChangeId,
	});

	// Confirmation shortcuts
	useKeyboardShortcut({
		key: "y",
		onPress: confirmAbandon,
		enabled: !!pendingAbandon,
	});

	useKeyboardShortcut({
		key: "n",
		onPress: cancelAbandon,
		enabled: !!pendingAbandon,
	});

	useKeyboardShortcut({
		key: "Escape",
		onPress: cancelAbandon,
		enabled: !!pendingAbandon,
	});

	async function handleSync() {
		if (!activeProject || isSyncing) return;
		setIsSyncing(true);
		try {
			await syncRepository(activeProject.path, activeProject.revset_preset ?? "full_history");
		} finally {
			setIsSyncing(false);
		}
	}

	function handleOpenSearch() {
		setSearchOpen(true);
	}

	function handleOpenOperationsLog() {
		if (!activeProject) return;
		setOperationsLogOpen(true);
	}

	function handleMainSplitLayout(layout: Record<string, number>) {
		const nextSidebarRaw = layout["app-shell-revisions"];
		if (typeof nextSidebarRaw !== "number") return;
		const nextSidebarWidth = clampSidebarWidth(nextSidebarRaw);
		setSidebarWidth((current) => (current === nextSidebarWidth ? current : nextSidebarWidth));
	}

	return (
		<>
			<ProjectPicker
				repositories={repositories}
				onSelectRepository={handleSelectRepository}
				open={projectPickerOpen}
				onOpenChange={setProjectPickerOpen}
			/>
			<CommandPalette
				onOpenRepo={handleAddRepository}
				onOpenProjects={() => navigate({ to: "/repositories" })}
				onOpenSettings={() => navigate({ to: "/settings" })}
				canOpenOperationsLog={!!activeProject}
				onOpenOperationsLog={handleOpenOperationsLog}
			/>
			<OperationsLog
				repoPath={activeProject?.path ?? null}
				open={operationsLogOpen}
				onOpenChange={setOperationsLogOpen}
			/>
			<KeyboardShortcutsHelp />
			<Search
				revisions={orderedRevisions}
				repoPath={activeProject?.path ?? null}
				onJump={(changeId) => {
					handleNavigateToChangeId(changeId);
					// Defer scroll to next frame to ensure navigation state has settled
					requestAnimationFrame(() => {
						revisionGraphRef.current?.scrollToChangeId(changeId, { align: "center" });
					});
				}}
			/>
			<div className="flex flex-col h-screen overflow-hidden">
				<div className="flex-1 min-h-0">
					<ResizablePanelGroup
						key={`${isNarrowScreen ? "narrow" : "wide"}-${splitLayoutSeed}`}
						id="app-shell-layout"
						orientation={isNarrowScreen ? "vertical" : "horizontal"}
						onLayoutChange={isNarrowScreen ? undefined : handleMainSplitLayout}
					>
						<ResizablePanel
							id="app-shell-revisions"
							defaultSize={isNarrowScreen ? "40%" : `${sidebarWidth}%`}
							minSize={isNarrowScreen ? "20%" : `${MIN_SIDEBAR_WIDTH}%`}
							maxSize={isNarrowScreen ? "60%" : `${MAX_SIDEBAR_WIDTH}%`}
						>
							<section
								ref={revisionsPanelRef}
								tabIndex={-1}
								className="h-full flex flex-col outline-none"
								aria-label="Revision list"
							>
								<div className="px-2 py-2 shrink-0 flex items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										className="flex-1 min-w-0 justify-start h-7 px-2 gap-1.5 text-sm font-medium"
										onClick={() => setProjectPickerOpen(true)}
									>
										<FolderOpenIcon className="size-4" />
										<span className="truncate">
											{activeProject?.name ?? "Open Repository"}
										</span>
									</Button>
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon-sm"
													className="h-7 w-7 text-muted-foreground"
													onClick={handleOpenSearch}
													aria-label="Search revisions"
												>
													<SearchIcon className="size-4" />
												</Button>
											}
										/>
										<TooltipContent side="bottom">Search revisions (/)</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon-sm"
													className="h-7 w-7 text-muted-foreground"
													onClick={handleSync}
													disabled={isSyncing || !activeProject}
													aria-label="Sync repository"
												>
													<RefreshCwIcon
														className={`size-4 ${isSyncing ? "animate-spin" : ""}`}
													/>
												</Button>
											}
										/>
										<TooltipContent side="bottom">Sync repository</TooltipContent>
									</Tooltip>
								</div>
								<div className="flex-1 min-h-0 relative">
									<Profiler id="RevisionGraph" onRender={onRenderCallback}>
										<RevisionGraph
											ref={revisionGraphRef}
											revisions={revisions}
											selectedRevision={selectedRevision}
											onSelectRevision={handleSelectRevision}
											isLoading={isLoading}
											errorMessage={revisionsErrorMessage}
											onRetry={handleRetryRevisions}
											flash={flash}
											repoPath={activeProject?.path ?? null}
											pendingAbandon={pendingAbandon}
											editingChangeId={editingChangeId}
											onDescribe={handleDescribe}
											onCancelDescribe={handleCancelDescribe}
											rebaseSourceChangeId={rebaseSourceRevision?.change_id ?? null}
											onPickRebaseDestination={handlePickRebaseDestination}
											diffPanelRef={diffPanelRef}
										/>
									</Profiler>
								</div>
							</section>
						</ResizablePanel>
						<ResizableHandle
							withHandle
							orientation={isNarrowScreen ? "vertical" : "horizontal"}
						/>
						<ResizablePanel
							id="app-shell-diff"
							defaultSize={isNarrowScreen ? "60%" : `${100 - sidebarWidth}%`}
							minSize="30%"
						>
							<aside className="h-full" aria-label="Diff viewer">
								<Profiler id="DiffPanel" onRender={onRenderCallback}>
									<PrerenderedDiffPanel
										ref={diffPanelRef}
										repoPath={activeProject?.path ?? null}
										revisions={orderedRevisions}
										selectedChangeId={debouncedChangeId}
										revisionsPanelRef={revisionsPanelRef}
										onDescribe={handleDescribe}
									/>
								</Profiler>
							</aside>
						</ResizablePanel>
					</ResizablePanelGroup>
				</div>
			</div>
		</>
	);
}
