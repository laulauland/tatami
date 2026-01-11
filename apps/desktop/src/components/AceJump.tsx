import { useAtom } from "@effect-atom/atom-react";
import { useEffect, useRef, useState } from "react";
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
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useKeyboardShortcut({
		key: "f",
		onPress: () => setOpen(true),
		enabled: !open,
	});

	useEffect(() => {
		if (open) {
			setQuery("");
			setSelectedIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	const matches = (() => {
		if (!query) return []; // Don't show list until user starts typing
		const lowerQuery = query.toLowerCase();
		return revisions.filter((r) => r.change_id.toLowerCase().startsWith(lowerQuery)).slice(0, 10);
	})();

	function close() {
		inputRef.current?.blur();
		setOpen(false);
		// Ensure focus is removed from the dialog area
		requestAnimationFrame(() => {
			(document.activeElement as HTMLElement)?.blur?.();
		});
	}

	function jumpTo(changeId: string) {
		onJump(changeId);
		close();
	}

	// Auto-jump when single match and query is at least 2 characters
	useEffect(() => {
		if (matches.length === 1 && query.length >= 2) {
			jumpTo(matches[0].change_id);
		}
	}, [matches.length, query]);

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			close();
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (matches.length > 0) {
				jumpTo(matches[selectedIndex]?.change_id ?? matches[0].change_id);
			}
		} else if (e.key === "ArrowDown" || (e.key === "j" && e.ctrlKey)) {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, matches.length - 1));
		} else if (e.key === "ArrowUp" || (e.key === "k" && e.ctrlKey)) {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		}
	}

	// Reset selected index when matches change
	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
			onClick={(e) => {
				if (e.target === e.currentTarget) close();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") close();
			}}
		>
			<div className="bg-background border border-border rounded-lg shadow-xl w-[400px] overflow-hidden">
				<div className={`p-3 ${query ? "border-b border-border" : ""}`}>
					<div className="flex items-center gap-2 mb-2">
						<span className="text-xs text-muted-foreground font-medium">Jump to revision</span>
						<span className="text-xs text-muted-foreground/60">(type change ID prefix)</span>
					</div>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="e.g. kzm, abc..."
						className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-md font-mono focus:outline-none focus:ring-2 focus:ring-ring"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>

				{query && (
					<div className="max-h-[300px] overflow-y-auto">
						{matches.length === 0 ? (
							<div className="px-3 py-6 text-center text-muted-foreground text-sm">
								No revisions match "{query}"
							</div>
						) : (
							<div className="py-1">
								{matches.map((revision, index) => {
									const isSelected = index === selectedIndex;
									// Use short ID but ensure we show at least as much as the user typed
									const displayLength = Math.max(revision.change_id_short.length, query.length);
									const displayId = revision.change_id.slice(0, displayLength);
									const matchedPart = displayId.slice(0, query.length);
									const restPart = displayId.slice(query.length);

									return (
										<button
											type="button"
											key={revision.change_id}
											onClick={() => jumpTo(revision.change_id)}
											onMouseEnter={() => setSelectedIndex(index)}
											className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
												isSelected ? "bg-accent" : "hover:bg-muted/50"
											}`}
										>
											<code className="font-mono text-sm shrink-0">
												<span className="text-foreground font-semibold">{matchedPart}</span>
												<span className="text-muted-foreground">{restPart}</span>
											</code>
											<span className="text-sm text-muted-foreground truncate flex-1">
												{revision.description?.split("\n")[0] || (
													<span className="italic">no description</span>
												)}
											</span>
											{revision.is_working_copy && (
												<span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 shrink-0">
													@
												</span>
											)}
										</button>
									);
								})}
							</div>
						)}
					</div>
				)}

				{query && matches.length > 0 && (
					<div className="px-3 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground flex gap-4">
						<span>
							<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> navigate
						</span>
						<span>
							<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> jump
						</span>
						<span>
							<kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> close
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
