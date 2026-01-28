import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Route } from "@/routes/project.$projectId";
import { draggingBookmarkAtom, viewModeAtom } from "@/atoms";
import { ChangedFilesList } from "@/components/ChangedFilesList";
import { emptyChangesCollection, getRevisionChangesCollection } from "@/db";
import type { Revision } from "@/tauri-commands";
import { BookmarkTag } from "./BookmarkTag";
import { ROW_HEIGHT, LANE_PADDING, LANE_WIDTH, NODE_RADIUS, laneToX, laneColor } from "./constants";
import { GraphNode } from "./GraphNode";

interface RevisionRowProps {
	revision: Revision;
	lane: number;
	maxLaneOnRow: number;
	isSelected: boolean;
	isChecked: boolean;
	onSelect: (changeId: string, modifiers: { shift: boolean; meta: boolean }) => void;
	isFlashing: boolean;
	isDimmed: boolean;
	isExpanded: boolean;
	isFocused: boolean;
	repoPath: string | null;
	isPendingAbandon: boolean;
	jumpModeActive: boolean;
	jumpQuery: string;
	jumpHint: string | null;
	onMoveBookmark?: (bookmark: string, fromChangeId: string, toChangeId: string) => void;
}

/**
 * RevisionRow - Renders a single revision in the graph
 * Includes graph node, revision metadata, branches, and expandable file list
 */
export function RevisionRow({
	revision,
	lane,
	maxLaneOnRow,
	isSelected,
	isChecked,
	onSelect,
	isFlashing,
	isDimmed,
	isExpanded,
	isFocused,
	repoPath,
	isPendingAbandon,
	jumpModeActive,
	jumpQuery,
	jumpHint,
	onMoveBookmark,
}: RevisionRowProps) {
	const firstLine = revision.description.split("\n")[0] || "(no description)";
	const fullDescription = revision.description || "(no description)";
	const [isDragOver, setIsDragOver] = useState(false);
	const [showDropPlaceholder, setShowDropPlaceholder] = useState(false);
	const dragOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dragEnterCountRef = useRef(0);
	const [draggingBookmark] = useAtom(draggingBookmarkAtom);

	// Calculate the node position area - leaves space for graph edges on the left
	const nodeAreaWidth = LANE_PADDING + (maxLaneOnRow + 1) * LANE_WIDTH;
	const nodeOffset = laneToX(lane);
	const color = laneColor(lane);

	const selectedFile = useSearch({ from: Route.fullPath, select: (s) => s.file ?? null });
	const search = useSearch({ from: Route.fullPath });
	const navigate = useNavigate({ from: Route.fullPath });
	const [viewMode, setViewMode] = useAtom(viewModeAtom);

	const changedFilesCollection =
		isExpanded && repoPath
			? getRevisionChangesCollection(repoPath, revision.change_id)
			: emptyChangesCollection;
	const changedFilesQuery = useLiveQuery(changedFilesCollection);

	function handleSelectFile(filePath: string) {
		// If in overview mode, switch to split mode
		if (viewMode === 1) {
			setViewMode(2);
		}
		// Clear expanded state and navigate to file
		navigate({
			search: { ...search, file: filePath, expanded: undefined },
		});
	}

	const nodeSize = revision.is_working_copy ? NODE_RADIUS * 2 + 14 : NODE_RADIUS * 2 + 8;

	return (
		// biome-ignore lint/a11y/useSemanticElements: Complex styling requires div
		<div
			ref={(el) => {
				// Focus management: when this row is focused and rendered, focus the DOM element
				if (isFocused && el && document.activeElement !== el) {
					el.focus({ preventScroll: true });
				}
			}}
			role="button"
			tabIndex={0}
			style={{ height: isExpanded ? "auto" : ROW_HEIGHT }}
			className={`flex relative select-none outline-none ${
				revision.is_immutable ? "opacity-60" : ""
			} ${isDimmed ? "opacity-40" : ""}`}
			data-selected={isSelected || undefined}
			data-checked={isChecked || undefined}
			data-expanded={isExpanded || undefined}
			data-change-id={revision.change_id}
			onClick={(e) => {
				// Prevent text selection on shift+click
				if (e.shiftKey) {
					e.preventDefault();
					window.getSelection()?.removeAllRanges();
				}
				onSelect(revision.change_id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					onSelect(revision.change_id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
				}
			}}
			onDragEnter={(e) => {
				if (e.dataTransfer.types.includes("application/x-bookmark")) {
					e.preventDefault();
					dragEnterCountRef.current++;
					if (!isDragOver) {
						setIsDragOver(true);
						// Start timer to show placeholder after delay
						if (!dragOverTimerRef.current) {
							dragOverTimerRef.current = setTimeout(() => {
								setShowDropPlaceholder(true);
							}, 150);
						}
					}
				}
			}}
			onDragOver={(e) => {
				// Check if this is a bookmark drag
				if (e.dataTransfer.types.includes("application/x-bookmark")) {
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
				}
			}}
			onDragLeave={(e) => {
				if (e.dataTransfer.types.includes("application/x-bookmark")) {
					dragEnterCountRef.current--;
					if (dragEnterCountRef.current === 0) {
						setIsDragOver(false);
						setShowDropPlaceholder(false);
						if (dragOverTimerRef.current) {
							clearTimeout(dragOverTimerRef.current);
							dragOverTimerRef.current = null;
						}
					}
				}
			}}
			onDrop={(e) => {
				e.preventDefault();
				dragEnterCountRef.current = 0;
				setIsDragOver(false);
				setShowDropPlaceholder(false);
				if (dragOverTimerRef.current) {
					clearTimeout(dragOverTimerRef.current);
					dragOverTimerRef.current = null;
				}
				const data = e.dataTransfer.getData("application/x-bookmark");
				if (data && onMoveBookmark) {
					try {
						const { bookmark, changeId: fromChangeId } = JSON.parse(data);
						if (fromChangeId !== revision.change_id) {
							onMoveBookmark(bookmark, fromChangeId, revision.change_id);
						}
					} catch {
						// Invalid drag data, ignore
					}
				}
			}}
		>
			{/* Graph node - absolutely positioned to align with edge layer */}
			<div
				className="absolute z-20 flex items-center justify-center"
				style={{
					left: nodeOffset - nodeSize / 2,
					top: ROW_HEIGHT / 2 - nodeSize / 2,
				}}
			>
				<GraphNode revision={revision} lane={lane} isSelected={isSelected} color={color} />
			</div>
			{/* Spacer for graph area */}
			<div className="shrink-0" style={{ width: nodeAreaWidth + 8 }} />
			{/* Content area with visual styling - full row height */}
			<div
				className={`relative flex-1 mr-2 min-w-0 overflow-hidden text-card-foreground flex flex-col justify-center py-1 border-b transition-colors ${
					isDragOver
						? "bg-primary/20 border-primary/50 rounded-md"
						: isChecked || isFocused
							? "bg-accent/40 rounded-md border-transparent"
							: "border-border/30"
				}`}
			>
				<div className={`px-3 py-1.5 min-w-0 ${isPendingAbandon ? "blur-sm" : ""}`}>
					{/* Grid: [change_id] [bookmarks] [author/date] - fixed height row */}
					<div className="grid grid-cols-[auto_auto_1fr] items-center gap-2 min-w-0 h-5">
						<code
							className={`text-xs font-mono rounded px-0.5 ${
								isFlashing ? "bg-primary/40 animate-pulse" : ""
							} text-muted-foreground`}
						>
							{jumpModeActive && jumpHint ? (
								<>
									{/* Already matched portion */}
									{jumpQuery && (
										<span className="bg-primary/30 text-primary font-semibold">
											{revision.change_id_short.slice(0, jumpQuery.length)}
										</span>
									)}
									{/* Next character to type (the hint) */}
									<span className="bg-primary text-primary-foreground font-semibold rounded-sm">
										{revision.change_id_short[jumpQuery.length]}
									</span>
									{/* Rest of the ID */}
									<span>{revision.change_id_short.slice(jumpQuery.length + 1)}</span>
								</>
							) : (
								revision.change_id_short
							)}
						</code>
						{/* Bookmarks - middle column */}
						<div className="flex items-center gap-1 min-w-0 overflow-hidden">
							{revision.bookmarks.map((bookmark) => (
								<BookmarkTag key={bookmark} bookmark={bookmark} changeId={revision.change_id} />
							))}
							{showDropPlaceholder && draggingBookmark && draggingBookmark.fromChangeId !== revision.change_id && (
								<span className="text-xs text-primary/60 font-medium whitespace-nowrap px-1 rounded-sm border border-dashed border-primary/40 bg-primary/5 pointer-events-none">
									{draggingBookmark.bookmark}
								</span>
							)}
						</div>
						<span className="text-xs text-muted-foreground truncate whitespace-nowrap">
							{revision.author.split("@")[0]} · {revision.timestamp}
						</span>
					</div>
					<div className={`text-sm mt-1 ${isExpanded ? "" : "truncate"}`}>{firstLine}</div>
				</div>
				{isExpanded && (
					<div className={`px-3 pb-3 pt-0 space-y-3 ${isPendingAbandon ? "blur-sm" : ""}`}>
						<pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/40 border border-border/60 rounded p-2">
							{fullDescription}
						</pre>
						<div className="border border-border rounded-lg overflow-hidden bg-background">
							<ChangedFilesList
								files={changedFilesQuery.data ?? []}
								selectedFile={selectedFile}
								onSelectFile={handleSelectFile}
								isLoading={changedFilesQuery.isLoading}
							/>
						</div>
					</div>
				)}
				{isPendingAbandon && (
					<div className="absolute inset-0 flex items-center justify-center bg-destructive/10 rounded">
						<div className="text-sm font-medium text-destructive-foreground bg-destructive/90 px-3 py-1.5 rounded">
							Abandon this revision? <kbd className="ml-1 px-1 bg-background/20 rounded">Y</kbd> /{" "}
							<kbd className="px-1 bg-background/20 rounded">N</kbd>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
