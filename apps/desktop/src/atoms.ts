import { Atom } from "@effect-atom/atom";

export const activeProjectIdAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
export const selectedChangeIdAtom = Atom.make<string | null>(null).pipe(Atom.keepAlive);
export const sidebarOpenAtom = Atom.make(true).pipe(Atom.keepAlive);
export const sidebarOpenMobileAtom = Atom.make(false).pipe(Atom.keepAlive);
