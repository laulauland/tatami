import { useAtom } from "@effect-atom/atom-react";
import { useRef, useState } from "react";
import { draggingBookmarkAtom } from "@/atoms";
import { getRevisionKey } from "@/db";
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
	isFocused: boolean;
	isPendingAbandon: boolean;
	jumpModeActive: boolean;
	jumpQuery: string;
	jumpHint: string | null;
	onMoveBookmark?: (bookmark: string, fromChangeId: string, toChangeId: string) => void;
	hasFocus: boolean;
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
	isFocused,
	isPendingAbandon,
	jumpModeActive,
	jumpQuery,
	jumpHint,
	onMoveBookmark,
	hasFocus,
}: RevisionRowProps) {
	const firstLine = revision.description.split("\n")[0] || "(no description)";
	const [isDragOver, setIsDragOver] = useState(false);
	const [showDropPlaceholder, setShowDropPlaceholder] = useState(false);
	const dragOverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dragEnterCountRef = useRef(0);
	const [draggingBookmark] = useAtom(draggingBookmarkAtom);

	// Calculate the node position area - leaves space for graph edges on the left
	const nodeAreaWidth = LANE_PADDING + (maxLaneOnRow + 1) * LANE_WIDTH;
	const nodeOffset = laneToX(lane);
	const color = laneColor(lane);

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
			style={{ height: ROW_HEIGHT }}
			className={`flex relative select-none outline-none ${
				revision.is_immutable ? "opacity-60" : ""
			} ${isDimmed ? "opacity-40" : ""}`}
			data-selected={isSelected || undefined}
			data-checked={isChecked || undefined}
			data-change-id={revision.change_id}
			onClick={(e) => {
				// Prevent text selection on shift+click
				if (e.shiftKey) {
					e.preventDefault();
					window.getSelection()?.removeAllRanges();
				}
				onSelect(getRevisionKey(revision), { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					onSelect(getRevisionKey(revision), { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
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
				className={`relative flex-1 mr-2 min-w-0 overflow-hidden text-card-foreground flex flex-col justify-center py-1 border-b transition-colors rounded-md ${
					isDragOver
						? "bg-primary/20 border-primary/50"
						: isChecked || isFocused
							? hasFocus
								? "bg-accent/40 border-transparent"
								: "bg-muted border-transparent"
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
							{revision.has_conflict && <span className="ml-1 text-destructive">⚠</span>}
						</code>
						{/* Bookmarks - middle column */}
						<div className="flex items-center gap-1 min-w-0 overflow-hidden">
							{revision.bookmarks.map((bookmark) => (
								<BookmarkTag
									key={bookmark.name}
									bookmark={bookmark}
									changeId={revision.change_id}
								/>
							))}
							{showDropPlaceholder &&
								draggingBookmark &&
								draggingBookmark.fromChangeId !== revision.change_id && (
									<span className="text-xs text-primary/60 font-medium whitespace-nowrap px-1 rounded-sm border border-dashed border-primary/40 bg-primary/5 pointer-events-none">
										{draggingBookmark.bookmark}
									</span>
								)}
						</div>
						<span className="text-xs text-muted-foreground truncate whitespace-nowrap">
							{revision.author.split("@")[0]} · {revision.timestamp}
						</span>
					</div>
					<div className="text-sm mt-1 truncate">{firstLine}</div>
				</div>

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
