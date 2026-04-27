import { useEffect, useState, type RefObject } from "react";

/**
 * Returns true when focus is within the container element.
 * Uses focusin/focusout events for reliable tracking.
 */
export function useFocusWithin(containerRef: RefObject<HTMLElement | null>): boolean {
	// ast-grep-ignore: no-usestate
	const [hasFocus, setHasFocus] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleFocusIn = () => setHasFocus(true);
		const handleFocusOut = (e: FocusEvent) => {
			const relatedTarget = e.relatedTarget as Node | null;
			if (!relatedTarget || !container.contains(relatedTarget)) {
				setHasFocus(false);
			}
		};

		container.addEventListener("focusin", handleFocusIn);
		container.addEventListener("focusout", handleFocusOut);
		setHasFocus(container.contains(document.activeElement));

		return () => {
			container.removeEventListener("focusin", handleFocusIn);
			container.removeEventListener("focusout", handleFocusOut);
		};
		// containerRef is a stable ref object - we intentionally depend on its .current value
		// which is captured at effect time
	}, [containerRef]);

	return hasFocus;
}
