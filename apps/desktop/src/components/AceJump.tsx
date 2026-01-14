import { useAtom } from "@effect-atom/atom-react";
import type React from "react";
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { aceJumpOpenAtom } from "@/atoms";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { resolveRevset, type Revision } from "@/tauri-commands";

interface AceJumpProps {
	revisions: Revision[];
	repoPath: string | null;
	onJump: (changeId: string) => void;
}

// Highlight matching text in a string
function HighlightMatch({ text, query }: { text: string; query: string }): React.ReactElement {
	if (!query) return <>{text}</>;

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const index = lowerText.indexOf(lowerQuery);

	if (index === -1) return <>{text}</>;

	const before = text.slice(0, index);
	const match = text.slice(index, index + query.length);
	const after = text.slice(index + query.length);

	return (
		<>
			{before}
			<span className="bg-primary/30 text-primary font-semibold">{match}</span>
			{after}
		</>
	);
}

// Check if a string looks like a revset expression
function isRevsetExpression(query: string): boolean {
	const trimmed = query.trim();
	if (!trimmed) return false;

	// Revset patterns: @, @-, @--, id-, id+, or any jj revset syntax
	// We'll be more liberal and consider anything with special chars as potential revset
	if (trimmed === "@") return true;
	if (/^@-+$/.test(trimmed)) return true; // @-, @--, etc.
	if (/^[a-z0-9]+-$/i.test(trimmed)) return true; // id-
	if (/^[a-z0-9]+\+$/i.test(trimmed)) return true; // id+
	if (trimmed.includes("(")) return true; // function calls like trunk(), mine()
	if (trimmed.includes("|")) return true; // union
	if (trimmed.includes("&")) return true; // intersection
	if (trimmed.includes("::")) return true; // ancestors
	if (trimmed.includes("..")) return true; // range

	return false;
}

export function AceJump({ revisions, repoPath, onJump }: AceJumpProps) {
	const [open, setOpen] = useAtom(aceJumpOpenAtom);
	const [search, setSearch] = useState("");
	const [revsetResult, setRevsetResult] = useState<{
		changeIds: string[];
		error: string | null;
		loading: boolean;
		label: string | null;
	}>({ changeIds: [], error: null, loading: false, label: null });

	useKeyboardShortcut({
		key: "/",
		onPress: () => setOpen(true),
		enabled: !open,
	});

	// Reset search when dialog opens
	useEffect(() => {
		if (open) {
			setSearch("");
			setRevsetResult({ changeIds: [], error: null, loading: false, label: null });
		}
	}, [open]);

	// Stable ref for callback
	const onJumpRef = useRef(onJump);
	onJumpRef.current = onJump;

	function jumpTo(changeId: string) {
		setOpen(false);
		requestAnimationFrame(() => {
			onJumpRef.current(changeId);
		});
	}

	// Debounced revset resolution
	const resolveRevsetDebounced = useCallback(
		async (query: string) => {
			if (!repoPath || !query.trim()) {
				setRevsetResult({ changeIds: [], error: null, loading: false, label: null });
				return;
			}

			if (!isRevsetExpression(query)) {
				setRevsetResult({ changeIds: [], error: null, loading: false, label: null });
				return;
			}

			setRevsetResult((prev) => ({ ...prev, loading: true, label: query }));

			try {
				const result = await resolveRevset(repoPath, query.trim());
				setRevsetResult({
					changeIds: result.change_ids,
					error: result.error,
					loading: false,
					label: query,
				});
			} catch (err) {
				setRevsetResult({
					changeIds: [],
					error: String(err),
					loading: false,
					label: query,
				});
			}
		},
		[repoPath],
	);

	// Debounce the revset resolution
	useEffect(() => {
		const timeout = setTimeout(() => {
			resolveRevsetDebounced(search);
		}, 150); // 150ms debounce

		return () => clearTimeout(timeout);
	}, [search, resolveRevsetDebounced]);

	// Build lookup maps
	const revisionByChangeId = useMemo(
		() => new Map(revisions.map((r) => [r.change_id, r])),
		[revisions],
	);

	// Determine if we're in revset mode
	const isRevsetMode =
		isRevsetExpression(search) &&
		(revsetResult.loading || revsetResult.changeIds.length > 0 || revsetResult.error);
	const revsetChangeIdSet = useMemo(
		() => new Set(revsetResult.changeIds),
		[revsetResult.changeIds],
	);

	// Determine what matched for each revision
	function getMatchType(
		revision: Revision,
	): "revset" | "changeId" | "bookmark" | "description" | null {
		if (isRevsetMode && revsetChangeIdSet.has(revision.change_id)) {
			return "revset";
		}
		if (!search || isRevsetMode) return null;
		const lowerSearch = search.toLowerCase();

		if (revision.change_id.toLowerCase().startsWith(lowerSearch)) return "changeId";
		if (revision.bookmarks.some((b) => b.toLowerCase().includes(lowerSearch))) return "bookmark";
		if (revision.description.toLowerCase().includes(lowerSearch)) return "description";
		return null;
	}

	function getMatchingBookmark(revision: Revision): string | null {
		if (!search || isRevsetMode) return null;
		const lowerSearch = search.toLowerCase();
		return revision.bookmarks.find((b) => b.toLowerCase().includes(lowerSearch)) ?? null;
	}

	// Custom filter function that ranks by match type
	function customFilter(value: string, searchQuery: string): number {
		if (!searchQuery) return 1; // Show all when no search

		const revision = revisionByChangeId.get(value);
		if (!revision) return 0;

		// Revset match - highest priority
		if (isRevsetMode) {
			return revsetChangeIdSet.has(value) ? 1.0 : 0;
		}

		const lowerSearch = searchQuery.toLowerCase();

		// Change ID match - highest priority
		if (revision.change_id.toLowerCase().startsWith(lowerSearch)) {
			return 1.0;
		}

		// Bookmark match - medium priority
		if (revision.bookmarks.some((b) => b.toLowerCase().includes(lowerSearch))) {
			return 0.7;
		}

		// Description match - lower priority
		if (revision.description.toLowerCase().includes(lowerSearch)) {
			return 0.4;
		}

		return 0;
	}

	// When in revset mode, we need to disable cmdk's text-based filter
	// because revset expressions like "@" don't match any text
	const shouldFilter = !isRevsetMode;

	// Filter revisions when in revset mode (manually, since cmdk filter is disabled)
	const filteredRevisions = isRevsetMode
		? revisions.filter((r) => revsetChangeIdSet.has(r.change_id))
		: revisions;

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="Jump to revision"
			description="Search by change ID, bookmark, message, or use jj revset syntax"
			className="max-w-3xl rounded-xl"
			filter={shouldFilter ? customFilter : undefined}
			shouldFilter={shouldFilter}
		>
			<CommandInput
				placeholder="Search or use revset (@, @-, trunk(), mine())..."
				value={search}
				onValueChange={setSearch}
			/>
			<CommandList className="max-h-[450px]">
				<CommandEmpty>
					{revsetResult.loading ? (
						<span className="text-muted-foreground">Resolving revset...</span>
					) : revsetResult.error ? (
						<span className="text-destructive">{revsetResult.error}</span>
					) : isRevsetMode && revsetResult.changeIds.length === 0 ? (
						<span>No revisions match revset: {revsetResult.label}</span>
					) : (
						"No revisions found."
					)}
				</CommandEmpty>
				{isRevsetMode &&
					!revsetResult.loading &&
					!revsetResult.error &&
					revsetResult.changeIds.length > 0 && (
						<div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
							revset: {revsetResult.label} ({revsetResult.changeIds.length} match
							{revsetResult.changeIds.length !== 1 ? "es" : ""})
						</div>
					)}
				<CommandGroup>
					{filteredRevisions.map((revision) => {
						const firstLine = revision.description?.split("\n")[0] || "(no description)";
						const matchType = getMatchType(revision);
						const matchingBookmark = getMatchingBookmark(revision);

						return (
							<CommandItem
								key={revision.change_id}
								value={revision.change_id}
								onSelect={() => jumpTo(revision.change_id)}
								keywords={[
									revision.change_id,
									revision.change_id_short,
									...revision.bookmarks,
									revision.description,
								]}
								className="flex items-center gap-3 py-2.5"
							>
								<code className="font-mono text-xs shrink-0 min-w-[3ch]">
									{matchType === "changeId" || matchType === "revset" ? (
										<span className="text-primary font-semibold">{revision.change_id_short}</span>
									) : (
										<span className="text-muted-foreground">{revision.change_id_short}</span>
									)}
								</code>
								{revision.is_working_copy && (
									<span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 shrink-0">
										@
									</span>
								)}
								{revision.bookmarks.length > 0 && (
									<span className="text-xs text-primary font-medium shrink-0">
										{matchType === "bookmark" && matchingBookmark ? (
											<HighlightMatch text={matchingBookmark} query={search} />
										) : (
											revision.bookmarks[0]
										)}
										{revision.bookmarks.length > 1 && (
											<span className="text-muted-foreground ml-1">
												+{revision.bookmarks.length - 1}
											</span>
										)}
									</span>
								)}
								<span className="text-xs text-muted-foreground truncate flex-1">
									{matchType === "description" ? (
										<HighlightMatch text={firstLine} query={search} />
									) : (
										firstLine
									)}
								</span>
							</CommandItem>
						);
					})}
				</CommandGroup>
			</CommandList>
		</CommandDialog>
	);
}
