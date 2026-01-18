import { useAtom } from "@effect-atom/atom-react";
import type { RefObject } from "react";
import { focusPanelAtom } from "@/atoms";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";

const SCROLL_AMOUNT = 100;

interface UseDiffPanelKeyboardOptions {
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	enabled?: boolean;
}

/**
 * Hook for diff panel keyboard navigation.
 * - j/k/ArrowDown/ArrowUp: scroll the diff panel
 * - h/ArrowLeft: move focus back to revisions panel
 */
export function useDiffPanelKeyboard({
	scrollContainerRef,
	enabled = true,
}: UseDiffPanelKeyboardOptions) {
	const [focusPanel, setFocusPanel] = useAtom(focusPanelAtom);
	const hasDiffFocus = focusPanel === "diff";
	const isEnabled = enabled && hasDiffFocus;

	// j/k/arrows scroll the diff panel
	useKeyboardShortcut({
		key: "j",
		modifiers: {},
		onPress: () =>
			scrollContainerRef.current?.scrollBy({ top: SCROLL_AMOUNT, behavior: "instant" }),
		enabled: isEnabled,
	});

	useKeyboardShortcut({
		key: "ArrowDown",
		modifiers: {},
		onPress: () =>
			scrollContainerRef.current?.scrollBy({ top: SCROLL_AMOUNT, behavior: "instant" }),
		enabled: isEnabled,
	});

	useKeyboardShortcut({
		key: "k",
		modifiers: {},
		onPress: () =>
			scrollContainerRef.current?.scrollBy({ top: -SCROLL_AMOUNT, behavior: "instant" }),
		enabled: isEnabled,
	});

	useKeyboardShortcut({
		key: "ArrowUp",
		modifiers: {},
		onPress: () =>
			scrollContainerRef.current?.scrollBy({ top: -SCROLL_AMOUNT, behavior: "instant" }),
		enabled: isEnabled,
	});

	// h/ArrowLeft to move focus back to revisions panel
	useKeyboardShortcut({
		key: "h",
		modifiers: {},
		onPress: () => setFocusPanel("revisions"),
		enabled: isEnabled,
	});

	useKeyboardShortcut({
		key: "ArrowLeft",
		modifiers: {},
		onPress: () => setFocusPanel("revisions"),
		enabled: isEnabled,
	});
}
