import { useAtom } from "@effect-atom/atom-react";
import { draggingBookmarkAtom } from "@/atoms";

interface BookmarkTagProps {
	bookmark: string;
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
		draggingBookmark?.bookmark === bookmark &&
		draggingBookmark?.fromChangeId === changeId;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Draggable element needs drag handlers
		<span
			draggable
			onDragStart={(e) => {
				const dragData = JSON.stringify({ bookmark, changeId });
				e.dataTransfer.setData("text/plain", dragData);
				e.dataTransfer.setData("application/x-bookmark", dragData);
				e.dataTransfer.effectAllowed = "move";

				// Delay state update to avoid re-render cancelling drag
				requestAnimationFrame(() => {
					setDraggingBookmark({ bookmark, fromChangeId: changeId });
				});
			}}
			onDragEnd={() => {
				setDraggingBookmark(null);
			}}
			className={`text-xs text-primary font-medium whitespace-nowrap cursor-grab active:cursor-grabbing px-1.5 py-0.5 rounded-sm hover:bg-primary/10 transition-opacity ${
				isDragging ? "opacity-50" : ""
			}`}
			title={`Drag to move "${bookmark}" to another revision`}
		>
			{bookmark}
		</span>
	);
}
