import { Atom } from "@effect-atom/atom";

export const activeProjectIdAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
export const selectedChangeIdAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
