import type { RefObject } from "react";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";

const SCROLL_AMOUNT = 100;

interface UseDiffPanelKeyboardOptions {
	scrollContainerRef: RefObject<HTMLDivElement | null>;
	revisionsPanelRef: RefObject<HTMLElement | null>;
	hasFocus: boolean;
	enabled?: boolean;
}

/**
 * Hook for diff panel keyboard navigation.
 * - j/k/ArrowDown/ArrowUp: scroll the diff panel
 * - h/ArrowLeft: move focus back to revisions panel
 */
export function useDiffPanelKeyboard({
	scrollContainerRef,
	revisionsPanelRef,
	hasFocus,
	enabled = true,
}: UseDiffPanelKeyboardOptions) {
	const isEnabled = enabled && hasFocus;

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
		onPress: () => {
			// Find the focusable element inside the revisions panel section
			// The RevisionGraph has its own container with tabIndex={-1}
			const section = revisionsPanelRef.current;
			const target = section?.querySelector('[tabindex="-1"]') as HTMLElement | null;
			target?.focus();
		},
		enabled: isEnabled,
	});

	useKeyboardShortcut({
		key: "ArrowLeft",
		modifiers: {},
		onPress: () => {
			const section = revisionsPanelRef.current;
			const target = section?.querySelector('[tabindex="-1"]') as HTMLElement | null;
			target?.focus();
		},
		enabled: isEnabled,
	});
}
