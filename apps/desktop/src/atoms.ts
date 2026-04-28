import { Atom } from "@effect-atom/atom";

export const shortcutsHelpOpenAtom = Atom.make(false);
// Search dialog open state (/ key)
export const searchOpenAtom = Atom.make(false);
// AceJump mode: when active, shows jump hints on visible revision change IDs
// Stores the typed query prefix (empty string = initial state showing first letters)
export const aceJumpQueryAtom = Atom.make<string | null>(null);
// Tracks which revision stacks are expanded (by stack ID)
export const expandedStacksAtom = Atom.make(new Set<string>());
// Tracks which stack is currently hovered (for coordinated edge highlighting)
export const hoveredStackIdAtom = Atom.make<string | null>(null);
// Persists revision graph scroll position across view mode changes
export const revisionGraphScrollTopAtom = Atom.make<number>(0);
// Debounced changeId for DiffPanel - updates 200ms after navigation settles
// This prevents expensive DiffPanel re-renders during rapid j/k navigation
export const debouncedChangeIdAtom = Atom.make<string | null>(null);

// Bookmark drag state - tracks which bookmark is being dragged and from which revision
export type DraggingBookmark = {
	bookmark: string;
	fromChangeId: string;
} | null;
export const draggingBookmarkAtom = Atom.make<DraggingBookmark>(null);

// DEBUG STATE
/** Debug overlay visibility (Ctrl+Shift+D) */
export const debugOverlayEnabledAtom = Atom.make(false);

// Diff panel state
export type DiffStyle = "unified" | "split";
export const diffStyleAtom = Atom.make<DiffStyle>("unified");

// Unified diff view state that auto-resets when changeId changes
export type DiffViewState = {
	forChangeId: string | null;
	expandedFiles: Set<string>;
	styleOverrides: Map<string, DiffStyle>;
};

const initialDiffViewState: DiffViewState = {
	forChangeId: null,
	expandedFiles: new Set<string>(),
	styleOverrides: new Map<string, DiffStyle>(),
};

export const diffViewStateAtom = Atom.make(initialDiffViewState);
