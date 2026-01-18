import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Route as ProjectRoute } from "@/routes/project.$projectId";
import { expandedStacksAtom, viewModeAtom } from "@/atoms";

const NARROW_BREAKPOINT = 768;

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

import { AceJump } from "@/components/AceJump";
import { CommandPalette } from "@/components/CommandPalette";
import { PrerenderedDiffPanel } from "@/components/DiffPanel";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";
import { ProjectPicker } from "@/components/ProjectPicker";
import { RevisionGraph, type RevisionGraphHandle } from "@/components/RevisionGraph";
import { detectStacks, reorderForGraph } from "@/components/revision-graph-utils";
import { StatusBar } from "@/components/StatusBar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import {
	abandonRevision,
	editRevision,
	emptyChangesCollection,
	emptyCommitRecencyCollection,
	emptyRevisionsCollection,
	getCommitRecencyCollection,
	getRevisionChangesCollection,
	getRevisionsCollection,
	newRevision,
	repositoriesCollection,
} from "@/db";
import { useAddRepository } from "@/hooks/useAddRepository";
import { useAppTitle } from "@/hooks/useAppTitle";
import { useKeyboardNavigation, useKeyboardShortcut, useKeySequence } from "@/hooks/useKeyboard";
import type { Repository, Revision } from "@/tauri-commands";

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

	function handleSelectRepository(repository: Repository) {
		navigate({ to: "/project/$projectId", params: { projectId: repository.id } });
	}

	useAppTitle("Tatami");

	return (
		<>
			<AceJump revisions={[]} repoPath={null} onJump={() => {}} />
			<CommandPalette
				onOpenRepo={handleAddRepository}
				onOpenProjects={() => navigate({ to: "/repositories" })}
				onOpenSettings={() => navigate({ to: "/settings" })}
			/>
			<KeyboardShortcutsHelp />
			<ProjectPicker repositories={repositories} onSelectRepository={handleSelectRepository} />
			<div className="flex flex-col h-screen overflow-hidden">
				<div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground">
					<p>Select or add a repository to get started</p>
				</div>
				<StatusBar branch={null} isConnected={false} />
			</div>
		</>
	);
}

// Full app shell when a project is selected (rendered from "/project/$projectId" route)
function AppShellWithProject() {
	const navigate = useNavigate({ from: ProjectRoute.fullPath });
	const { projectId } = useParams({ from: ProjectRoute.fullPath });
	const rev = useSearch({ from: ProjectRoute.fullPath, select: (s) => s.rev });
	const expanded = useSearch({ from: ProjectRoute.fullPath, select: (s) => s.expanded });
	const file = useSearch({ from: ProjectRoute.fullPath, select: (s) => s.file });
	// Get full search object for navigation (only re-renders when expanded/file/rev change, which we need anyway)
	const search = useSearch({ from: ProjectRoute.fullPath });
	const [flash, setFlash] = useState<{ changeId: string; key: number } | null>(null);
	const [viewMode, setViewMode] = useAtom(viewModeAtom);
	const [pendingAbandon, setPendingAbandon] = useState<Revision | null>(null);
	const revisionGraphRef = useRef<RevisionGraphHandle>(null);
	const isNarrowScreen = useIsNarrowScreen();
	const { handleAddRepository } = useAddRepository();

	useKeyboardShortcut({
		key: ",",
		modifiers: { meta: true, ctrl: true },
		onPress: () => navigate({ to: "/settings" }),
	});

	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);

	const activeProject = repositories.find((p) => p.id === projectId) ?? null;

	useAppTitle(activeProject ? `Tatami - ${activeProject.path}` : "Tatami");

	const revisionsCollection = activeProject
		? getRevisionsCollection(activeProject.path, activeProject.revset_preset ?? "full_history")
		: emptyRevisionsCollection;

	const { data: revisions = [], isLoading = false } = useLiveQuery(revisionsCollection);

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

	const selectedRevision = (() => {
		if (revisions.length === 0) return null;
		if (rev) {
			const found = revisions.find((r) => r.change_id === rev);
			if (found) return found;
		}
		return revisions.find((r) => r.is_working_copy) || revisions[0];
	})();

	function handleSelectRepository(repository: Repository) {
		navigate({ to: "/project/$projectId", params: { projectId: repository.id } });
	}

	function handleSelectRevision(revision: Revision) {
		if (!projectId) return;
		navigate({
			to: "/project/$projectId",
			params: { projectId },
			search: { rev: revision.change_id },
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

	useKeyboardShortcut({
		key: "n",
		onPress: handleNew,
		enabled: !!activeProject && !!selectedRevision,
	});

	useKeyboardShortcut({
		key: "e",
		onPress: handleEdit,
		enabled: !!activeProject && !!selectedRevision,
	});

	function handleAbandon() {
		if (!activeProject || !selectedRevision) return;
		// Don't abandon immutable revisions (trunk ancestors)
		if (selectedRevision.is_immutable) return;
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
		enabled: !!activeProject && !!selectedRevision && !pendingAbandon,
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

	// View mode shortcuts: 1 = overview, 2 = split
	useKeyboardShortcut({
		key: "1",
		onPress: () => setViewMode(1),
	});

	useKeyboardShortcut({
		key: "2",
		onPress: () => setViewMode(2),
	});

	// Get changed files collection for selected revision (TanStack Query handles fetching)
	const changesCollection =
		expanded && activeProject?.path && selectedRevision?.change_id
			? getRevisionChangesCollection(activeProject.path, selectedRevision.change_id)
			: emptyChangesCollection;
	const { data: changedFiles = [] } = useLiveQuery(changesCollection);

	// File navigation when revision is expanded - uses capture phase to run before revision navigation
	useEffect(() => {
		if (!expanded || changedFiles.length === 0) return;

		function handleFileNavigation(event: KeyboardEvent) {
			const activeElement = document.activeElement;
			if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
				return;
			}

			// Only handle j/k keys for file navigation when revision is expanded
			if (event.key !== "j" && event.key !== "k") {
				return;
			}

			const currentFile = file;
			const filePaths = changedFiles.map((f) => f.path);

			if (event.key === "j") {
				event.preventDefault();
				event.stopImmediatePropagation();
				const currentIndex = currentFile ? filePaths.indexOf(currentFile) : -1;
				const nextIndex = currentIndex + 1;

				if (nextIndex < filePaths.length) {
					navigate({
						search: { ...search, file: filePaths[nextIndex], expanded: true },
					});
				} else if (currentIndex === -1 && filePaths.length > 0) {
					navigate({
						search: { ...search, file: filePaths[0], expanded: true },
					});
				}
			} else if (event.key === "k") {
				event.preventDefault();
				event.stopImmediatePropagation();
				const currentIndex = currentFile ? filePaths.indexOf(currentFile) : -1;

				if (currentIndex > 0) {
					const prevIndex = currentIndex - 1;
					navigate({
						search: { ...search, file: filePaths[prevIndex], expanded: true },
					});
				} else if (currentIndex === -1 && filePaths.length > 0) {
					navigate({
						search: {
							...search,
							file: filePaths[filePaths.length - 1],
							expanded: true,
						},
					});
				}
			}
		}

		// Use capture phase to intercept before revision navigation handler
		window.addEventListener("keydown", handleFileNavigation, true);
		return () => window.removeEventListener("keydown", handleFileNavigation, true);
	}, [expanded, file, search, changedFiles, navigate]);

	const closestBookmark = (() => {
		const workingCopy = revisions.find((r) => r.is_working_copy);
		if (!workingCopy) return null;

		if (workingCopy.bookmarks.length > 0) {
			return workingCopy.bookmarks[0];
		}

		// BFS to find closest ancestor with bookmarks
		const byCommitId = new Map<string, Revision>();
		for (const rev of revisions) {
			byCommitId.set(rev.commit_id, rev);
		}

		const visited = new Set<string>();
		const queue = [...workingCopy.parent_ids];

		while (queue.length > 0) {
			const commitId = queue.shift();
			if (!commitId || visited.has(commitId)) continue;
			visited.add(commitId);

			const rev = byCommitId.get(commitId);
			if (!rev) continue;

			if (rev.bookmarks.length > 0) {
				return rev.bookmarks[0];
			}

			queue.push(...rev.parent_ids);
		}

		return null;
	})();

	return (
		<>
			<ProjectPicker repositories={repositories} onSelectRepository={handleSelectRepository} />
			<CommandPalette
				onOpenRepo={handleAddRepository}
				onOpenProjects={() => navigate({ to: "/repositories" })}
				onOpenSettings={() => navigate({ to: "/settings" })}
			/>
			<KeyboardShortcutsHelp />
			<AceJump
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
					{viewMode === 1 ? (
						// Overview mode: only revision list
						<section className="h-full relative" aria-label="Revision list">
							<RevisionGraph
								ref={revisionGraphRef}
								revisions={revisions}
								selectedRevision={selectedRevision}
								onSelectRevision={handleSelectRevision}
								isLoading={isLoading}
								flash={flash}
								repoPath={activeProject?.path ?? null}
								pendingAbandon={pendingAbandon}
							/>
						</section>
					) : (
						// Split mode: revision list + diff panel (vertical on narrow screens)
						<ResizablePanelGroup orientation={isNarrowScreen ? "vertical" : "horizontal"}>
							<ResizablePanel defaultSize={isNarrowScreen ? 40 : 33} minSize={20}>
								<section className="h-full relative" aria-label="Revision list">
									<RevisionGraph
										ref={revisionGraphRef}
										revisions={revisions}
										selectedRevision={selectedRevision}
										onSelectRevision={handleSelectRevision}
										isLoading={isLoading}
										flash={flash}
										repoPath={activeProject?.path ?? null}
										pendingAbandon={pendingAbandon}
									/>
								</section>
							</ResizablePanel>
							<ResizableHandle withHandle />
							<ResizablePanel defaultSize={isNarrowScreen ? 60 : 67} minSize={30}>
								<aside className="h-full" aria-label="Diff viewer">
									<PrerenderedDiffPanel
										repoPath={activeProject?.path ?? null}
										revisions={orderedRevisions}
										selectedChangeId={selectedRevision?.change_id ?? null}
									/>
								</aside>
							</ResizablePanel>
						</ResizablePanelGroup>
					)}
				</div>
				<StatusBar branch={closestBookmark} isConnected={!!activeProject} />
			</div>
		</>
	);
}
