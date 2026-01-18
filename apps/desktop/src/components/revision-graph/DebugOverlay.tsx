import { useAtom } from "@effect-atom/atom-react";
import { useEffect, useRef, useState } from "react";
import { debugOverlayEnabledAtom } from "@/atoms";
import { ROW_HEIGHT } from "./constants";

interface DebugOverlayProps {
	scrollRef: React.RefObject<HTMLDivElement | null>;
	selectedIndex: number | undefined;
	visibleStartRow: number;
	visibleEndRow: number;
	totalRows: number;
	wcIndex: number | undefined;
	selectedChangeId: string | undefined;
	wcChangeId: string | undefined;
}

/**
 * Debug overlay for RevisionGraph - toggle with Ctrl+Shift+D
 * Displays scroll position, viewport info, and selection state
 */
export function DebugOverlay({
	scrollRef,
	selectedIndex,
	visibleStartRow,
	visibleEndRow,
	totalRows,
	wcIndex,
	selectedChangeId,
	wcChangeId,
}: DebugOverlayProps) {
	const [enabled] = useAtom(debugOverlayEnabledAtom);

	// Force re-render on scroll/resize/focus
	const [, forceUpdate] = useState(0);

	const prevScrollTop = useRef<number>(0);

	useEffect(() => {
		if (!enabled) return;
		const el = scrollRef.current;
		if (!el) return;

		const update = () => {
			const newScrollTop = el.scrollTop;
			prevScrollTop.current = newScrollTop;
			forceUpdate((n) => n + 1);
		};
		el.addEventListener("scroll", update);
		window.addEventListener("resize", update);
		document.addEventListener("focusin", update);
		return () => {
			el.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			document.removeEventListener("focusin", update);
		};
	}, [scrollRef, enabled]);

	if (!enabled) return null;

	const el = scrollRef.current;
	const scrollTop = el?.scrollTop ?? 0;
	const clientHeight = el?.clientHeight ?? 0;
	const scrollHeight = el?.scrollHeight ?? 0;

	const selectedItemTop = selectedIndex !== undefined ? selectedIndex * ROW_HEIGHT : 0;
	const selectedItemBottom = selectedItemTop + ROW_HEIGHT;
	const distanceFromTop = selectedItemTop - scrollTop;
	const distanceFromBottom = scrollTop + clientHeight - selectedItemBottom;
	const isInViewport = distanceFromTop >= 0 && distanceFromBottom >= 0;

	const active = document.activeElement;
	const activeElement = active
		? `${active.tagName}${active.className ? `.${active.className.split(" ")[0]}` : ""}`
		: "none";

	const info = {
		scrollTop,
		clientHeight,
		scrollHeight,
		viewportEnd: scrollTop + clientHeight,
		selectedIndex,
		wcIndex,
		itemTop: selectedItemTop,
		itemBottom: selectedItemBottom,
		distFromTop: distanceFromTop,
		distFromBottom: distanceFromBottom,
		isInViewport,
		virtualRange: `${visibleStartRow}-${visibleEndRow}`,
		totalRows,
		ROW_HEIGHT,
		activeElement,
		selected: selectedChangeId?.slice(0, 4),
		wc: wcChangeId?.slice(0, 4),
	};

	return (
		<button
			type="button"
			className="fixed bottom-12 right-4 z-50 bg-black/90 text-green-400 font-mono text-xs p-3 rounded-lg shadow-lg max-w-xs cursor-pointer hover:bg-black/95 active:scale-95 transition-transform text-left"
			onClick={() => navigator.clipboard.writeText(JSON.stringify(info, null, 2))}
			title="Click to copy"
		>
			<div className="font-bold text-green-300 mb-2">
				Debug Info <span className="text-green-600">(click to copy)</span>
			</div>
			<div className="space-y-1">
				<div>scrollTop: {scrollTop.toFixed(0)}</div>
				<div>clientHeight: {clientHeight.toFixed(0)}</div>
				<div>scrollHeight: {scrollHeight}</div>
				<div>viewportEnd: {(scrollTop + clientHeight).toFixed(0)}</div>
				<div className="border-t border-green-800 my-2" />
				<div>selectedIndex: {selectedIndex ?? "none"}</div>
				<div>wcIndex: {wcIndex ?? "none"}</div>
				<div>selected: {selectedChangeId?.slice(0, 4) ?? "none"}</div>
				<div>wc: {wcChangeId?.slice(0, 4) ?? "none"}</div>
				<div className="border-t border-green-800 my-2" />
				<div>itemTop: {selectedItemTop}</div>
				<div>itemBottom: {selectedItemBottom}</div>
				<div>distFromTop: {distanceFromTop.toFixed(0)}</div>
				<div>distFromBottom: {distanceFromBottom.toFixed(0)}</div>
				<div className={isInViewport ? "text-green-400" : "text-red-400"}>
					inViewport: {isInViewport ? "YES" : "NO"}
				</div>
				<div className="border-t border-green-800 my-2" />
				<div>
					virtualRange: {visibleStartRow}-{visibleEndRow}
				</div>
				<div>totalRows: {totalRows}</div>
				<div>ROW_HEIGHT: {ROW_HEIGHT}</div>
				<div className="border-t border-green-800 my-2" />
				<div className="truncate" title={activeElement}>
					focus: {activeElement}
				</div>
			</div>
		</button>
	);
}
