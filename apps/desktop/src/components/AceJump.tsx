import { useAtom } from "@effect-atom/atom-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aceJumpOpenAtom } from "@/atoms";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import type { Revision } from "@/tauri-commands";

interface AceJumpProps {
	revisions: Revision[];
	onJump: (changeId: string) => void;
}

export function AceJump({ revisions, onJump }: AceJumpProps) {
	const [open, setOpen] = useAtom(aceJumpOpenAtom);
	const [query, setQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useKeyboardShortcut({
		key: "f",
		onPress: () => setOpen(true),
		enabled: !open,
	});

	useEffect(() => {
		if (open) {
			setQuery("");
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	const matches = useMemo(() => {
		if (!query) return [];
		const lowerQuery = query.toLowerCase();
		return revisions.filter((r) => r.change_id.toLowerCase().startsWith(lowerQuery));
	}, [revisions, query]);

	const handleSubmit = useCallback(() => {
		if (matches.length === 1) {
			onJump(matches[0].change_id);
			setOpen(false);
		} else if (matches.length > 1) {
			onJump(matches[0].change_id);
			setOpen(false);
		}
	}, [matches, onJump, setOpen]);

	useEffect(() => {
		if (matches.length === 1 && query.length >= 2) {
			onJump(matches[0].change_id);
			setOpen(false);
		}
	}, [matches, query, onJump, setOpen]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				setOpen(false);
			} else if (e.key === "Enter") {
				e.preventDefault();
				handleSubmit();
			}
		},
		[handleSubmit, setOpen],
	);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
			<div className="bg-background border border-border rounded-md shadow-lg p-3 min-w-[200px]">
				<div className="flex items-center gap-2 mb-2">
					<span className="text-xs text-muted-foreground">Jump to revision:</span>
				</div>
				<input
					ref={inputRef}
					type="text"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Type change ID prefix..."
					className="w-full px-2 py-1 text-sm bg-muted border border-border rounded font-mono focus:outline-none focus:ring-1 focus:ring-ring"
					autoComplete="off"
					spellCheck={false}
				/>
				{query && (
					<div className="mt-2 text-xs text-muted-foreground">
						{matches.length === 0 && <span>No matches</span>}
						{matches.length === 1 && (
							<span className="text-green-500">Match: {matches[0].change_id.slice(0, 12)}</span>
						)}
						{matches.length > 1 && <span>{matches.length} matches - keep typing...</span>}
					</div>
				)}
			</div>
		</div>
	);
}
