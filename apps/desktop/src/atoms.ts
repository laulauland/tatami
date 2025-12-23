import { Atom } from "@effect-atom/atom";

export const shortcutsHelpOpenAtom = Atom.make(false);
export const aceJumpOpenAtom = Atom.make(false);
export const expandedElidedSectionsAtom = Atom.make<string[]>([]);
