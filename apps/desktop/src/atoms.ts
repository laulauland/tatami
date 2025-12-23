import { Atom } from "@effect-atom/atom";

export const shortcutsHelpOpenAtom = Atom.make(false);
export const aceJumpOpenAtom = Atom.make(false);
// When set, shows only the stack (ancestors) from this change_id down to trunk
export const stackViewChangeIdAtom = Atom.make<string | null>(null);
