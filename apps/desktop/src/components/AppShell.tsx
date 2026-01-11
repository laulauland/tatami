import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { expandedStacksAtom, stackViewChangeIdAtom, viewModeAtom } from "@/atoms";

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
import { StackIndicator } from "@/components/StackIndicator";
import { StatusBar } from "@/components/StatusBar";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

import {
	abandonRevision,
	editRevision,
	emptyChangesCollection,
	emptyRevisionsCollection,
	getRevisionChangesCollection,
	getRevisionsCollection,
	newRevision,
	repositoriesCollection,
} from "@/db";
import { useKeyboardNavigation, useKeyboardShortcut, useKeySequence } from "@/hooks/useKeyboard";
import {
	findRepository,
	findRepositoryByPath,
	getCommitRecency,
	type Repository,
	type Revision,
	upsertRepository,
} from "@/tauri-commands";

const openDirectoryDialogEffect = Effect.gen(function* () {
	const home = yield* Effect.tryPromise({
		try: () => homeDir(),
		catch: (error) => new Error(`Failed to get home directory: ${error}`),
	});

	return yield* Effect.tryPromise({
		try: () =>
			open({
				directory: true,
				multiple: false,
				defaultPath: home,
				title: "Select Repository",
			}),
		catch: (error) => new Error(`Failed to open directory dialog: ${error}`),
	});
});

const findRepositoryEffect = (startPath: string) =>
	Effect.tryPromise({
		try: () => findRepository(startPath),
		catch: (error) => new Error(`Failed to find repository: ${error}`),
	});

export function AppShell() {
	const navigate = useNavigate();
	const { projectId } = useParams({ strict: false });
	const rev = useSearch({ strict: false, select: (s) => s.rev });
	const expanded = useSearch({ strict: false, select: (s) => s.expanded });
	const file = useSearch({ strict: false, select: (s) => s.file });
	// Get full search object for navigation (only re-renders when expanded/file/rev change, which we need anyway)
	const search = useSearch({ strict: false });
	const [flash, setFlash] = useState<{ changeId: string; key: number } | null>(null);
	const [stackViewChangeId, setStackViewChangeId] = useAtom(stackViewChangeIdAtom);
	const [viewMode, setViewMode] = useAtom(viewModeAtom);
	const [pendingAbandon, setPendingAbandon] = useState<Revision | null>(null);
	const revisionGraphRef = useRef<RevisionGraphHandle>(null);
	const isNarrowScreen = useIsNarrowScreen();

	useKeyboardShortcut({
		key: ",",
		modifiers: { meta: true, ctrl: true },
		onPress: () => navigate({ to: "/settings" }),
	});

	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);

	const activeProject = repositories.find((p) => p.id === projectId) ?? null;
	const titleLabel = activeProject ? `Tatami - ${activeProject.path}` : "Tatami";

	// Build the stack revset: the full branch containing the selected commit
	// (::X ~ ::trunk()) gives ancestors of X that are NOT ancestors of trunk (the branch below X)
	// X:: gives descendants of X (the branch above X)
	// roots(...)- gives the parent of the first branch commit (the merge base)
	// (X & ::trunk()) handles the case where X is already an ancestor of trunk (just show X)
	const stackRevset = stackViewChangeId
		? `(::${stackViewChangeId} ~ ::trunk()) | (${stackViewChangeId}:: ~ ::trunk()) | roots(::${stackViewChangeId} ~ ::trunk())- | (${stackViewChangeId} & ::trunk())`
		: undefined;

	const revisionsCollection = activeProject
		? getRevisionsCollection(
				activeProject.path,
				activeProject.revset_preset ?? "full_history",
				stackRevset,
			)
		: emptyRevisionsCollection;

	const { data: revisions = [], isLoading = false } = useLiveQuery(revisionsCollection);

	// Fetch commit recency data for branch ordering
	const { data: commitRecency } = useQuery({
		queryKey: ["commit-recency", activeProject?.path],
		queryFn: () => {
			if (!activeProject?.path) throw new Error("No repo path");
			return getCommitRecency(activeProject.path, 500); // Walk last 500 ops
		},
		enabled: !!activeProject?.path,
		staleTime: 30000, // Cache for 30s
	});

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
		return orderedRevisions.filter(r => !hiddenChangeIds.has(r.change_id));
	}, [revisions, orderedRevisions, expandedStacks]);

	// Debug: log when revisions change to track reordering
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const prevOrderRef = useRef<string[]>([]);
	useEffect(() => {
		const currentOrder = orderedRevisions.map((r) => r.change_id);
		const prevOrder = prevOrderRef.current;

		// Find which revisions changed position
		const changes: string[] = [];
		for (let i = 0; i < Math.min(currentOrder.length, prevOrder.length); i++) {
			if (currentOrder[i] !== prevOrder[i]) {
				changes.push(`[${i}] ${prevOrder[i]?.slice(0, 4) ?? "?"} → ${currentOrder[i]?.slice(0, 4) ?? "?"}`);
				if (changes.length >= 10) break;
			}
		}

		if (changes.length > 0 || prevOrder.length !== currentOrder.length) {
			console.log("[reorder] changes detected:", {
				prevLength: prevOrder.length,
				newLength: currentOrder.length,
				wcBefore: prevOrder.findIndex((id) => revisions.find((r) => r.change_id === id)?.is_working_copy),
				wcAfter: currentOrder.findIndex((id) => id === workingCopy?.change_id),
				firstChanges: changes,
				first10: currentOrder.slice(0, 10).map((id) => id.slice(0, 4)),
			});
		}

		prevOrderRef.current = currentOrder;
	}, [orderedRevisions, workingCopy?.change_id, revisions]);

	useEffect(() => {
		document.title = titleLabel;
		const windowHandle = getCurrentWindow();
		windowHandle.setTitle(titleLabel).catch(() => undefined);
	}, [titleLabel]);

	const selectedRevision = (() => {
		if (revisions.length === 0) return null;
		if (rev) {
			const found = revisions.find((r) => r.change_id === rev);
			if (found) return found;
		}
		return revisions.find((r) => r.is_working_copy) || revisions[0];
	})();

	function handleOpenRepo() {
		const program = Effect.gen(function* () {
			const selected = yield* openDirectoryDialogEffect;
			if (!selected) return;

			const repoPath = yield* findRepositoryEffect(selected);
			if (!repoPath) return;

			const existingRepository = yield* Effect.tryPromise({
				try: () => findRepositoryByPath(repoPath),
				catch: () => null,
			});

			const repositoryId = existingRepository?.id ?? crypto.randomUUID();
			const name = repoPath.split("/").pop() ?? repoPath;

			const repository: Repository = {
				id: repositoryId,
				path: repoPath,
				name,
				last_opened_at: Date.now(),
				revset_preset: null,
			};

			yield* Effect.tryPromise({
				try: () => upsertRepository(repository),
				catch: (error) => new Error(`Failed to save repository: ${error}`),
			});

			yield* Effect.sync(() => {
				repositoriesCollection.utils.writeUpsert([repository]);
				navigate({ to: "/project/$projectId", params: { projectId: repositoryId } });
			});
		}).pipe(
			Effect.tapError((error) => Effect.logError("handleOpenRepo failed", error)),
			Effect.catchAll(() => Effect.void),
		);
		Effect.runPromise(program);
	}

	function handleSelectRepository(repository: Repository) {
		setStackViewChangeId(null); // Clear stack view when switching repositories
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
		newRevision(activeProject.path, [selectedRevision.change_id]);
	}

	function handleEdit() {
		if (!activeProject || !selectedRevision) return;
		const currentWC = revisions.find((r) => r.is_working_copy);

		// Debug: log indices before edit
		const currentWCIndex = orderedRevisions.findIndex((r) => r.change_id === currentWC?.change_id);
		const targetIndex = orderedRevisions.findIndex((r) => r.change_id === selectedRevision.change_id);
		console.log("[edit] before:", {
			currentWC: currentWC?.change_id_short,
			currentWCIndex,
			target: selectedRevision.change_id_short,
			targetIndex,
			totalRevisions: orderedRevisions.length,
		});

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
		const preset = activeProject.revset_preset ?? "full_history";
		const limit = preset === "full_history" ? 10000 : 100;
		abandonRevision(revisionsCollection, activeProject.path, pendingAbandon, limit, stackRevset, preset);
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

	// Toggle stack view: show only ancestors from selected revision to trunk
	function handleToggleStackView() {
		if (!selectedRevision) return;
		if (stackViewChangeId) {
			// Turn off stack view
			setStackViewChangeId(null);
		} else {
			// Turn on stack view anchored to selected revision
			setStackViewChangeId(selectedRevision.change_id);
		}
	}

	useKeyboardShortcut({
		key: "s",
		onPress: handleToggleStackView,
		enabled: !!activeProject && !!selectedRevision,
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
						// biome-ignore lint/suspicious/noExplicitAny: TanStack Router search params require loose typing
						search: { ...search, file: filePaths[nextIndex], expanded: true } as any,
					});
				} else if (currentIndex === -1 && filePaths.length > 0) {
					navigate({
						// biome-ignore lint/suspicious/noExplicitAny: TanStack Router search params require loose typing
						search: { ...search, file: filePaths[0], expanded: true } as any,
					});
				}
			} else if (event.key === "k") {
				event.preventDefault();
				event.stopImmediatePropagation();
				const currentIndex = currentFile ? filePaths.indexOf(currentFile) : -1;

				if (currentIndex > 0) {
					const prevIndex = currentIndex - 1;
					navigate({
						// biome-ignore lint/suspicious/noExplicitAny: TanStack Router search params require loose typing
						search: { ...search, file: filePaths[prevIndex], expanded: true } as any,
					});
				} else if (currentIndex === -1 && filePaths.length > 0) {
					navigate({
						// biome-ignore lint/suspicious/noExplicitAny: TanStack Router search params require loose typing
						search: { ...search, file: filePaths[filePaths.length - 1], expanded: true } as any,
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
				onOpenRepo={handleOpenRepo}
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
							<StackIndicator
								onDismiss={() => {
									handleNavigateToChangeId("");
								}}
							/>
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
									<StackIndicator
										onDismiss={() => {
											handleNavigateToChangeId("");
										}}
									/>
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
								<aside
									className="h-full"
									aria-label="Diff viewer"
								>
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
