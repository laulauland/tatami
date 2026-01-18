import { useAtom } from "@effect-atom/atom-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef } from "react";
import { Route } from "@/routes/project.$projectId";
import { focusPanelAtom, viewModeAtom } from "@/atoms";
import type { RevisionStack } from "@/components/revision-graph-utils";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import type { Revision } from "@/tauri-commands";

// Display row can be either a revision row or a collapsed stack row
// These match the types used in RevisionGraph component
interface GraphRow {
	revision: Revision;
	lane: number;
	maxLaneOnRow: number;
}

interface RevisionDisplayRow {
	type: "revision";
	row: GraphRow;
}

interface CollapsedStackDisplayRow {
	type: "collapsed-stack";
	stack: RevisionStack;
	lane: number;
}

type DisplayRow = RevisionDisplayRow | CollapsedStackDisplayRow;

interface UseRevisionGraphNavigationParams {
	/** All revisions in display order */
	revisions: Revision[];
	/** Display rows (revisions + collapsed stacks) */
	displayRows: DisplayRow[];
	/** Map of change_id -> display row index */
	changeIdToIndex: Map<string, number>;
	/** Currently selected revision */
	selectedRevision: Revision | null;
	/** Whether navigation is enabled (disable during jump mode) */
	enabled: boolean;
	/** Called to scroll a display index into view */
	scrollToIndex: (index: number) => void;
	/** Handler for expanding/collapsing stacks */
	onToggleStack: (stackId: string) => void;
	/** Check if inline expanded for h/l behavior */
	isSelectedExpanded?: boolean;
}

/**
 * Hook that handles all keyboard navigation for the revision graph.
 *
 * Handles:
 * - j/k navigation (move up/down through display rows)
 * - J/K navigation (jump between related revisions on working copy chain)
 * - Arrow key navigation
 * - g/G (go to top/bottom)
 * - Home/End
 * - Shift+navigation for range selection
 * - h/l for expand/collapse
 * - Space/Enter for stack toggle / revision check
 * - Escape to clear selection
 */
export function useRevisionGraphNavigation({
	revisions,
	displayRows,
	changeIdToIndex,
	selectedRevision,
	enabled,
	scrollToIndex,
	onToggleStack,
	isSelectedExpanded = false,
}: UseRevisionGraphNavigationParams) {
	const navigate = useNavigate({ from: Route.fullPath });
	const search = useSearch({ from: Route.fullPath });
	const [viewMode] = useAtom(viewModeAtom);
	const [focusPanel, setFocusPanel] = useAtom(focusPanelAtom);

	// Read focused stack and selection from URL params
	const focusedStackId = useSearch({ from: Route.fullPath, select: (s) => s.stack ?? null });
	const selectedParam = useSearch({ from: Route.fullPath, select: (s) => s.selected ?? "" });
	const selectionAnchor = useSearch({
		from: Route.fullPath,
		select: (s) => s.selectionAnchor ?? null,
	});

	// Parse selected revisions from URL param
	const selectedRevisions = selectedParam
		? new Set(selectedParam.split(",").filter(Boolean))
		: new Set<string>();
	const hasSelection = selectedRevisions.size > 0;

	// Diff panel has keyboard focus
	const diffPanelHasFocus = focusPanel === "diff";

	// Build commit map for parent/child navigation
	const commitMapRef = useRef<Map<string, Revision>>(new Map());
	commitMapRef.current = new Map(revisions.map((r) => [r.commit_id, r]));

	// Get working copy chain for J/K navigation
	const workingCopyChainRef = useRef<Set<string>>(new Set());
	workingCopyChainRef.current = getWorkingCopyChain(revisions);

	// ----------------------------------------------------------
	// Helper functions
	// ----------------------------------------------------------

	// Get current focused index in displayRows
	const getCurrentDisplayIndex = (): number => {
		if (focusedStackId) {
			return displayRows.findIndex(
				(row) => row.type === "collapsed-stack" && row.stack.id === focusedStackId,
			);
		}
		if (selectedRevision) {
			return displayRows.findIndex(
				(row) =>
					row.type === "revision" && row.row.revision.change_id === selectedRevision.change_id,
			);
		}
		return -1;
	};

	// Navigate to a display row (revision or collapsed stack)
	// Clears selection and anchor (regular navigation without shift)
	const navigateToDisplayRow = (index: number) => {
		const displayRow = displayRows[index];
		if (!displayRow) return;

		if (displayRow.type === "revision") {
			navigate({
				search: {
					...search,
					stack: undefined,
					rev: displayRow.row.revision.change_id,
					selected: undefined,
					selectionAnchor: undefined,
				},
				replace: true,
			});
		} else if (displayRow.type === "collapsed-stack") {
			navigate({
				search: {
					...search,
					stack: displayRow.stack.id,
					rev: undefined,
					selected: undefined,
					selectionAnchor: undefined,
				},
				replace: true,
			});
		}

		scrollToIndex(index);
	};

	// Extend selection in a direction (macOS-style anchor-based selection)
	const extendSelection = (direction: "down" | "up") => {
		if (!selectedRevision) return;
		const currentIndex = changeIdToIndex.get(selectedRevision.change_id);
		if (currentIndex === undefined) return;

		const step = direction === "down" ? 1 : -1;
		const limit = direction === "down" ? displayRows.length : -1;

		// Find the next revision in the given direction
		let targetChangeId: string | null = null;
		let targetIndex: number | null = null;
		for (let i = currentIndex + step; direction === "down" ? i < limit : i > limit; i += step) {
			const displayRow = displayRows[i];
			if (displayRow.type === "revision") {
				targetChangeId = displayRow.row.revision.change_id;
				targetIndex = i;
				break;
			}
		}

		if (!targetChangeId || targetIndex === null) return;

		// Determine anchor: use existing anchor or set it to current position
		const anchorChangeId = selectionAnchor ?? selectedRevision.change_id;
		const anchorIndex = changeIdToIndex.get(anchorChangeId);
		if (anchorIndex === undefined) return;

		// Select all revisions between anchor and target (inclusive)
		const startIndex = Math.min(anchorIndex, targetIndex);
		const endIndex = Math.max(anchorIndex, targetIndex);
		const newSelection = new Set<string>();
		for (let i = startIndex; i <= endIndex; i++) {
			const displayRow = displayRows[i];
			if (displayRow.type === "revision") {
				newSelection.add(displayRow.row.revision.change_id);
			}
		}

		const selected = [...newSelection].join(",");
		navigate({
			search: {
				...search,
				selected,
				selectionAnchor: anchorChangeId,
				rev: targetChangeId,
				stack: undefined,
			},
			replace: true,
		});

		scrollToIndex(targetIndex);
	};

	// Navigate in related revisions (working copy chain) - for J/K
	const navigateRelated = (direction: "down" | "up") => {
		if (!selectedRevision) return;

		const chain = workingCopyChainRef.current;

		// Find revisions on the working copy chain
		const chainRevisions = displayRows
			.filter((row): row is RevisionDisplayRow => row.type === "revision")
			.filter((row) => chain.has(row.row.revision.commit_id));

		if (chainRevisions.length === 0) return;

		// Find current position in chain
		const currentChainIndex = chainRevisions.findIndex(
			(row) => row.row.revision.change_id === selectedRevision.change_id,
		);

		let targetRevision: Revision | null = null;

		if (currentChainIndex === -1) {
			// Not on chain - jump to nearest chain revision
			const currentDisplayIndex = getCurrentDisplayIndex();
			if (direction === "down") {
				// Find first chain revision below
				for (let i = currentDisplayIndex + 1; i < displayRows.length; i++) {
					const displayRow = displayRows[i];
					if (displayRow.type === "revision" && chain.has(displayRow.row.revision.commit_id)) {
						targetRevision = displayRow.row.revision;
						break;
					}
				}
			} else {
				// Find first chain revision above
				for (let i = currentDisplayIndex - 1; i >= 0; i--) {
					const displayRow = displayRows[i];
					if (displayRow.type === "revision" && chain.has(displayRow.row.revision.commit_id)) {
						targetRevision = displayRow.row.revision;
						break;
					}
				}
			}
		} else {
			// On chain - move to next/prev in chain
			if (direction === "down" && currentChainIndex < chainRevisions.length - 1) {
				targetRevision = chainRevisions[currentChainIndex + 1].row.revision;
			} else if (direction === "up" && currentChainIndex > 0) {
				targetRevision = chainRevisions[currentChainIndex - 1].row.revision;
			}
		}

		if (targetRevision) {
			const targetIndex = changeIdToIndex.get(targetRevision.change_id);
			if (targetIndex !== undefined) {
				navigateToDisplayRow(targetIndex);
			}
		}
	};

	// Toggle revision check state
	const toggleRevisionCheck = (changeId: string) => {
		const next = new Set(selectedRevisions);
		if (next.has(changeId)) {
			next.delete(changeId);
		} else {
			next.add(changeId);
		}
		const selected = next.size > 0 ? [...next].join(",") : undefined;
		navigate({
			search: { ...search, selected },
			replace: true,
		});
	};

	// ----------------------------------------------------------
	// Keyboard shortcuts
	// ----------------------------------------------------------

	// Clear selection with Escape
	useKeyboardShortcut({
		key: "Escape",
		modifiers: {},
		onPress: () => {
			navigate({
				search: {
					...search,
					selected: undefined,
					selectionAnchor: undefined,
					stack: undefined,
				},
				replace: true,
			});
		},
		enabled: (hasSelection || !!focusedStackId) && enabled,
	});

	// j / ArrowDown: navigate to next display row
	useKeyboardShortcut({
		key: "j",
		modifiers: {},
		onPress: () => {
			const currentIndex = getCurrentDisplayIndex();
			if (currentIndex < 0) {
				if (displayRows.length > 0) navigateToDisplayRow(0);
			} else if (currentIndex < displayRows.length - 1) {
				navigateToDisplayRow(currentIndex + 1);
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	useKeyboardShortcut({
		key: "ArrowDown",
		modifiers: {},
		onPress: () => {
			const currentIndex = getCurrentDisplayIndex();
			if (currentIndex < 0) {
				if (displayRows.length > 0) navigateToDisplayRow(0);
			} else if (currentIndex < displayRows.length - 1) {
				navigateToDisplayRow(currentIndex + 1);
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	// k / ArrowUp: navigate to previous display row
	useKeyboardShortcut({
		key: "k",
		modifiers: {},
		onPress: () => {
			const currentIndex = getCurrentDisplayIndex();
			if (currentIndex > 0) {
				navigateToDisplayRow(currentIndex - 1);
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	useKeyboardShortcut({
		key: "ArrowUp",
		modifiers: {},
		onPress: () => {
			const currentIndex = getCurrentDisplayIndex();
			if (currentIndex > 0) {
				navigateToDisplayRow(currentIndex - 1);
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	// J: navigate down in working copy chain
	useKeyboardShortcut({
		key: "J",
		modifiers: { shift: true },
		onPress: () => navigateRelated("down"),
		enabled: enabled && !diffPanelHasFocus && !!selectedRevision,
	});

	// K: navigate up in working copy chain
	useKeyboardShortcut({
		key: "K",
		modifiers: { shift: true },
		onPress: () => navigateRelated("up"),
		enabled: enabled && !diffPanelHasFocus && !!selectedRevision,
	});

	// Shift+j: extend selection downward
	useKeyboardShortcut({
		key: "j",
		modifiers: { shift: true },
		onPress: () => extendSelection("down"),
		enabled: enabled && !diffPanelHasFocus && !!selectedRevision,
	});

	// Shift+k: extend selection upward
	useKeyboardShortcut({
		key: "k",
		modifiers: { shift: true },
		onPress: () => extendSelection("up"),
		enabled: enabled && !diffPanelHasFocus && !!selectedRevision,
	});

	// Shift+ArrowDown: extend selection downward
	useKeyboardShortcut({
		key: "ArrowDown",
		modifiers: { shift: true },
		onPress: () => extendSelection("down"),
		enabled: enabled && !diffPanelHasFocus && !!selectedRevision,
	});

	// Shift+ArrowUp: extend selection upward
	useKeyboardShortcut({
		key: "ArrowUp",
		modifiers: { shift: true },
		onPress: () => extendSelection("up"),
		enabled: enabled && !diffPanelHasFocus && !!selectedRevision,
	});

	// G: go to bottom
	useKeyboardShortcut({
		key: "G",
		modifiers: { shift: true },
		onPress: () => {
			if (displayRows.length > 0) {
				// Find the last revision row
				for (let i = displayRows.length - 1; i >= 0; i--) {
					if (displayRows[i].type === "revision") {
						navigateToDisplayRow(i);
						break;
					}
				}
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	// Home: go to top
	useKeyboardShortcut({
		key: "Home",
		modifiers: {},
		onPress: () => {
			if (displayRows.length > 0) {
				navigateToDisplayRow(0);
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	// End: go to bottom
	useKeyboardShortcut({
		key: "End",
		modifiers: {},
		onPress: () => {
			if (displayRows.length > 0) {
				for (let i = displayRows.length - 1; i >= 0; i--) {
					if (displayRows[i].type === "revision") {
						navigateToDisplayRow(i);
						break;
					}
				}
			}
		},
		enabled: enabled && !diffPanelHasFocus,
	});

	// l / ArrowRight: expand revision (overview) or focus diff panel (split)
	useKeyboardShortcut({
		key: "l",
		modifiers: {},
		onPress: () => {
			if (viewMode === 2) {
				setFocusPanel("diff");
				return;
			}
			if (!selectedRevision) return;
			if (isSelectedExpanded) return;
			navigate({
				search: { ...search, expanded: true },
			});
		},
		enabled: enabled,
	});

	useKeyboardShortcut({
		key: "ArrowRight",
		modifiers: {},
		onPress: () => {
			if (viewMode === 2) {
				setFocusPanel("diff");
				return;
			}
			if (!selectedRevision) return;
			if (isSelectedExpanded) return;
			navigate({
				search: { ...search, expanded: true },
			});
		},
		enabled: enabled,
	});

	// h / ArrowLeft: collapse revision (overview)
	useKeyboardShortcut({
		key: "h",
		modifiers: {},
		onPress: () => {
			if (viewMode === 2) {
				// In split mode, h in revision panel does nothing
				return;
			}
			if (!selectedRevision) return;
			if (!isSelectedExpanded) return;
			navigate({
				search: { ...search, expanded: undefined },
			});
		},
		enabled: enabled,
	});

	useKeyboardShortcut({
		key: "ArrowLeft",
		modifiers: {},
		onPress: () => {
			if (viewMode === 2) {
				return;
			}
			if (!selectedRevision) return;
			if (!isSelectedExpanded) return;
			navigate({
				search: { ...search, expanded: undefined },
			});
		},
		enabled: enabled,
	});

	// Space: toggle check or expand stack
	useKeyboardShortcut({
		key: " ",
		modifiers: {},
		onPress: () => {
			if (focusedStackId) {
				onToggleStack(focusedStackId);
			} else if (selectedRevision) {
				toggleRevisionCheck(selectedRevision.change_id);
			}
		},
		enabled: enabled,
	});

	// Enter: expand focused stack
	useKeyboardShortcut({
		key: "Enter",
		modifiers: {},
		onPress: () => {
			if (focusedStackId) {
				onToggleStack(focusedStackId);
			}
		},
		enabled: enabled && !!focusedStackId,
	});
}

/**
 * Get the set of commit IDs in the working copy's ancestor chain.
 * Used for J/K navigation to jump between related revisions.
 */
function getWorkingCopyChain(revisions: Revision[]): Set<string> {
	const commitMap = new Map(revisions.map((r) => [r.commit_id, r]));
	const workingCopy = revisions.find((r) => r.is_working_copy);
	const chain = new Set<string>();

	if (workingCopy) {
		const queue = [workingCopy.commit_id];
		while (queue.length > 0) {
			const id = queue.shift();
			if (!id || chain.has(id)) continue;
			chain.add(id);
			const rev = commitMap.get(id);
			if (rev) {
				// Follow first non-missing parent edge for the main chain
				const firstEdge = rev.parent_edges.find((e) => e.edge_type !== "missing");
				if (firstEdge && commitMap.has(firstEdge.parent_id)) {
					queue.push(firstEdge.parent_id);
				}
			}
		}
	}

	return chain;
}
