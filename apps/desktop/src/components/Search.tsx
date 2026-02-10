import { useAtom } from "@effect-atom/atom-react";
import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { useRef, useState, useMemo, useCallback, useDeferredValue } from "react";
import { searchOpenAtom } from "@/atoms";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { getRevisionKey } from "@/db";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { resolveRevset, type Revision } from "@/tauri-commands";

interface SearchProps {
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

export function Search({ revisions, repoPath, onJump }: SearchProps) {
	const [open, setOpenRaw] = useAtom(searchOpenAtom);
	const [search, setSearch] = useState("");
	// Defer filtering to allow input to remain responsive during rapid typing
	const deferredSearch = useDeferredValue(search);

	// Wrap setOpen to reset state when opening
	const setOpen = useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				// Reset state when opening
				setSearch("");
			}
			setOpenRaw(nextOpen);
		},
		[setOpenRaw],
	);

	useKeyboardShortcut({
		key: "/",
		onPress: () => setOpen(true),
		enabled: !open,
	});

	// Stable ref for callback
	const onJumpRef = useRef(onJump);
	onJumpRef.current = onJump;

	function jumpTo(changeId: string) {
		setOpen(false);
		requestAnimationFrame(() => {
			onJumpRef.current(changeId);
		});
	}

	// Determine if current search is a revset expression
	const isRevset = isRevsetExpression(deferredSearch);

	// Use TanStack Query for revset resolution (async data fetching)
	const {
		data: revsetData,
		isLoading: revsetLoading,
		error: revsetError,
	} = useQuery({
		queryKey: ["revset", repoPath, deferredSearch],
		queryFn: async () => {
			if (!repoPath) throw new Error("No repo path");
			const result = await resolveRevset(repoPath, deferredSearch.trim());
			return result;
		},
		enabled: !!repoPath && isRevset && deferredSearch.trim().length > 0,
		staleTime: 30 * 1000, // 30 seconds
		retry: false,
	});

	// Derive revset result from query state
	const revsetResult = useMemo(
		() => ({
			changeIds: revsetData?.change_ids ?? [],
			error: revsetData?.error ?? (revsetError ? String(revsetError) : null),
			loading: revsetLoading,
			label: isRevset ? deferredSearch : null,
		}),
		[revsetData, revsetError, revsetLoading, isRevset, deferredSearch],
	);

	// Determine if we're in revset mode
	const isRevsetMode =
		isRevsetExpression(deferredSearch) &&
		(revsetResult.loading || revsetResult.changeIds.length > 0 || revsetResult.error);
	const revsetChangeIdSet = useMemo(
		() => new Set(revsetResult.changeIds),
		[revsetResult.changeIds],
	);

	// Filter and sort revisions ourselves using deferred search (allows input to stay responsive)
	// We disable cmdk's built-in filtering entirely to avoid sync filtering on every keystroke
	const { filteredRevisions, getMatchType, getMatchingBookmark } = useMemo(() => {
		// Helper to determine match type for a revision
		function matchType(
			revision: Revision,
		): "revset" | "changeId" | "bookmark" | "description" | null {
			if (isRevsetMode && revsetChangeIdSet.has(revision.change_id)) {
				return "revset";
			}
			if (!deferredSearch || isRevsetMode) return null;
			const lowerSearch = deferredSearch.toLowerCase();

			if (revision.change_id.toLowerCase().startsWith(lowerSearch)) return "changeId";
			if (revision.bookmarks.some((b) => b.name.toLowerCase().includes(lowerSearch)))
				return "bookmark";
			if (revision.description.toLowerCase().includes(lowerSearch)) return "description";
			return null;
		}

		function matchingBookmark(revision: Revision): string | null {
			if (!deferredSearch || isRevsetMode) return null;
			const lowerSearch = deferredSearch.toLowerCase();
			return (
				revision.bookmarks.find((b) => b.name.toLowerCase().includes(lowerSearch))?.name ?? null
			);
		}

		// Filter
		let filtered: Revision[];
		if (isRevsetMode) {
			filtered = revisions.filter((r) => revsetChangeIdSet.has(r.change_id));
		} else if (!deferredSearch) {
			filtered = revisions;
		} else {
			filtered = revisions.filter((r) => matchType(r) !== null);
		}

		// Sort by match priority (changeId > bookmark > description)
		if (deferredSearch && !isRevsetMode) {
			const priority: Record<string, number> = { changeId: 0, bookmark: 1, description: 2 };
			filtered.sort((a, b) => {
				const aType = matchType(a);
				const bType = matchType(b);
				const aPriority = aType ? (priority[aType] ?? 3) : 3;
				const bPriority = bType ? (priority[bType] ?? 3) : 3;
				return aPriority - bPriority;
			});
		}

		return {
			filteredRevisions: filtered,
			getMatchType: matchType,
			getMatchingBookmark: matchingBookmark,
		};
	}, [revisions, deferredSearch, isRevsetMode, revsetChangeIdSet]);

	return (
		<CommandDialog
			open={open}
			onOpenChange={setOpen}
			title="Jump to revision"
			description="Search by change ID, bookmark, message, or use jj revset syntax"
			className="max-w-3xl rounded-xl"
			shouldFilter={false}
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
								key={getRevisionKey(revision)}
								value={revision.change_id}
								onSelect={() => jumpTo(revision.change_id)}
								keywords={[
									revision.change_id,
									revision.change_id_short,
									...revision.bookmarks.map((b) => b.name),
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
											<HighlightMatch text={matchingBookmark} query={deferredSearch} />
										) : (
											revision.bookmarks[0].name
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
										<HighlightMatch text={firstLine} query={deferredSearch} />
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
