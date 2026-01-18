import { Atom } from "@effect-atom/atom";

export const shortcutsHelpOpenAtom = Atom.make(false);
export const aceJumpOpenAtom = Atom.make(false);
// Inline jump mode: when active, shows jump hints on visible revision change IDs
// Stores the typed query prefix (empty string = initial state showing first letters)
export const inlineJumpQueryAtom = Atom.make<string | null>(null);
// View mode: 1 = overview (only revisions), 2 = split (revisions + diff panel)
export type ViewMode = 1 | 2;
export const viewModeAtom = Atom.make<ViewMode>(1);
// Tracks which revision stacks are expanded (by stack ID)
export const expandedStacksAtom = Atom.make(new Set<string>());

// Diff panel state
export type DiffStyle = "unified" | "split";
export const diffStyleAtom = Atom.make<DiffStyle>("unified");
// Tracks expanded files in diff panel (null = not initialized, will default to first file)
export const expandedDiffFilesAtom = Atom.make<Set<string> | null>(null);
// Per-file diff style overrides (file path -> style)
export const fileDiffStyleOverridesAtom = Atom.make<Map<string, DiffStyle>>(new Map());
