import { useAtom } from "@effect-atom/atom-react";
import { draggingBookmarkAtom } from "@/atoms";
import type { BookmarkInfo } from "@/schemas";

interface BookmarkTagProps {
	bookmark: BookmarkInfo;
	changeId: string;
}

/**
 * BookmarkTag - A draggable bookmark label
 * Can be dragged to another revision to move the bookmark
 */
export function BookmarkTag({ bookmark, changeId }: BookmarkTagProps) {
	const [draggingBookmark, setDraggingBookmark] = useAtom(draggingBookmarkAtom);

	// Derive isDragging from global state instead of local useState
	const isDragging =
		draggingBookmark?.bookmark === bookmark.name && draggingBookmark?.fromChangeId === changeId;

	// Determine status indicator and tooltip
	let statusIndicator: React.ReactNode = null;
	let statusDescription = "";

	if (bookmark.is_conflicted) {
		statusIndicator = <span className="text-destructive ml-0.5">↕</span>;
		statusDescription = " (diverged - local and remote have conflicting changes)";
	} else if (bookmark.is_ahead && bookmark.is_behind) {
		statusIndicator = <span className="text-destructive ml-0.5">↕</span>;
		statusDescription = " (diverged - ahead and behind remote)";
	} else if (bookmark.is_ahead) {
		statusIndicator = <span className="text-yellow-500 ml-0.5">↑</span>;
		statusDescription = " (ahead of remote)";
	} else if (bookmark.is_behind) {
		statusIndicator = <span className="text-blue-500 ml-0.5">↓</span>;
		statusDescription = " (behind remote)";
	}

	const remoteInfo = bookmark.remote ? ` tracking ${bookmark.remote}` : "";
	const trackingInfo = bookmark.is_tracked ? remoteInfo : " (untracked)";
	const tooltip = `Drag to move "${bookmark.name}" to another revision${trackingInfo}${statusDescription}`;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Draggable element needs drag handlers
		<span
			draggable
			onDragStart={(e) => {
				const dragData = JSON.stringify({ bookmark: bookmark.name, changeId });
				e.dataTransfer.setData("text/plain", dragData);
				e.dataTransfer.setData("application/x-bookmark", dragData);
				e.dataTransfer.effectAllowed = "move";

				// Delay state update to avoid re-render cancelling drag
				requestAnimationFrame(() => {
					setDraggingBookmark({ bookmark: bookmark.name, fromChangeId: changeId });
				});
			}}
			onDragEnd={() => {
				setDraggingBookmark(null);
			}}
			className={`text-xs text-primary font-medium whitespace-nowrap cursor-grab active:cursor-grabbing px-1.5 py-0.5 rounded-sm hover:bg-primary/10 transition-opacity ${
				isDragging ? "opacity-50" : ""
			}`}
			title={tooltip}
		>
			{bookmark.name}
			{statusIndicator}
		</span>
	);
}
