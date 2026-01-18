import { Atom } from "@effect-atom/atom";

export const shortcutsHelpOpenAtom = Atom.make(false);
export const aceJumpOpenAtom = Atom.make(false);
// Inline jump mode: when active, shows jump hints on visible revision change IDs
// Stores the typed query prefix (empty string = initial state showing first letters)
export const inlineJumpQueryAtom = Atom.make<string | null>(null);
// View mode: 1 = overview (only revisions), 2 = split (revisions + diff panel)
export type ViewMode = 1 | 2;
export const viewModeAtom = Atom.make<ViewMode>(1);
// Panel focus tracking for split view (viewMode=2)
// "revisions" = left panel (revision graph), "diff" = right panel (diff viewer)
export type FocusPanel = "revisions" | "diff";
export const focusPanelAtom = Atom.make<FocusPanel>("revisions");
// Tracks which revision stacks are expanded (by stack ID)
export const expandedStacksAtom = Atom.make(new Set<string>());
// Tracks which stack is currently hovered (for coordinated edge highlighting)
export const hoveredStackIdAtom = Atom.make<string | null>(null);

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
