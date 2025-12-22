import { useEffect, useRef } from "react";
import type { Revision } from "@/tauri-commands";

interface UseKeyboardNavigationOptions {
	orderedRevisions: Revision[];
	selectedChangeId: string | null;
	onNavigate: (changeId: string) => void;
}

interface UseKeyboardShortcutOptions {
	key: string;
	modifiers?: {
		meta?: boolean;
		ctrl?: boolean;
		alt?: boolean;
		shift?: boolean;
	};
	onPress: () => void;
	enabled?: boolean;
	ignoreInputFocus?: boolean;
}

const GG_TIMEOUT_MS = 300;

export function useKeyboardNavigation({
	orderedRevisions,
	selectedChangeId,
	onNavigate,
}: UseKeyboardNavigationOptions) {
	const lastKeyPressRef = useRef<{ key: string; timestamp: number } | null>(null);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			// Don't handle if input/textarea is focused
			const activeElement = document.activeElement;
			if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
				return;
			}

			// Find current revision and index in display order
			// If no selection, default to working copy or first revision
			let currentIndex = orderedRevisions.findIndex((r) => r.change_id === selectedChangeId);
			if (currentIndex < 0) {
				currentIndex = orderedRevisions.findIndex((r) => r.is_working_copy);
				if (currentIndex < 0) currentIndex = 0;
			}
			const currentRevision = orderedRevisions[currentIndex] ?? null;

			let targetChangeId: string | null = null;

			switch (event.key) {
				case "j":
				case "ArrowDown":
					// Move down in display order
					if (currentIndex >= 0 && currentIndex < orderedRevisions.length - 1) {
						targetChangeId = orderedRevisions[currentIndex + 1].change_id;
					}
					event.preventDefault();
					break;

				case "k":
				case "ArrowUp":
					// Move up in display order
					if (currentIndex > 0) {
						targetChangeId = orderedRevisions[currentIndex - 1].change_id;
					}
					event.preventDefault();
					break;

				case "J":
					// Jump to parent
					if (currentRevision && currentRevision.parent_ids.length > 0) {
						const parentId = currentRevision.parent_ids[0];
						const parentRevision = orderedRevisions.find((r) => r.commit_id === parentId);
						targetChangeId = parentRevision?.change_id || null;
					}
					event.preventDefault();
					break;

				case "K":
					// Jump to child (find revision where current is in parent_ids)
					if (currentRevision) {
						const childRevision = orderedRevisions.find((r) =>
							r.parent_ids.includes(currentRevision.commit_id),
						);
						targetChangeId = childRevision?.change_id || null;
					}
					event.preventDefault();
					break;

				case "@":
					// Jump to working copy
					targetChangeId = orderedRevisions.find((r) => r.is_working_copy)?.change_id || null;
					event.preventDefault();
					break;

				case "g": {
					// Check for gg (double g within timeout)
					const now = Date.now();
					const lastPress = lastKeyPressRef.current;

					if (lastPress && lastPress.key === "g" && now - lastPress.timestamp < GG_TIMEOUT_MS) {
						// Jump to first revision
						targetChangeId = orderedRevisions[0]?.change_id || null;
						lastKeyPressRef.current = null;
						event.preventDefault();
					} else {
						// Record first g press
						lastKeyPressRef.current = { key: "g", timestamp: now };
					}
					break;
				}

				case "G":
					// Jump to last revision
					targetChangeId = orderedRevisions[orderedRevisions.length - 1]?.change_id || null;
					event.preventDefault();
					break;

				case "Escape":
					// Deselect current revision
					onNavigate("");
					event.preventDefault();
					break;
			}

			// Navigate to target and focus element
			if (targetChangeId) {
				onNavigate(targetChangeId);

				// Focus the element (triggers :focus-visible for keyboard navigation)
				requestAnimationFrame(() => {
					const element = document.querySelector<HTMLElement>(`[data-change-id="${targetChangeId}"]`);
					if (element) {
						element.focus({ preventScroll: true });
						element.scrollIntoView({ block: "nearest", behavior: "smooth" });
					}
				});
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [orderedRevisions, selectedChangeId, onNavigate]);
}

export function useKeyboardShortcut({
	key,
	modifiers = {},
	onPress,
	enabled = true,
	ignoreInputFocus = false,
}: UseKeyboardShortcutOptions) {
	useEffect(() => {
		if (!enabled) return;

		function handleKeyDown(event: KeyboardEvent) {
			// Don't handle if input/textarea is focused (unless explicitly ignored)
			if (!ignoreInputFocus) {
				const activeElement = document.activeElement;
				if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
					return;
				}
			}

			// Check if the key matches
			if (event.key !== key) return;

			// Check modifiers
			// For meta/ctrl: if both are true, accept either; if one is true, require that one
			let metaCtrlMatch = true;
			if (modifiers.meta !== undefined || modifiers.ctrl !== undefined) {
				if (modifiers.meta === true && modifiers.ctrl === true) {
					// Either meta OR ctrl (cross-platform support)
					metaCtrlMatch = event.metaKey || event.ctrlKey;
				} else if (modifiers.meta === true) {
					metaCtrlMatch = event.metaKey;
				} else if (modifiers.ctrl === true) {
					metaCtrlMatch = event.ctrlKey;
				} else {
					// Both false - require neither
					metaCtrlMatch = !event.metaKey && !event.ctrlKey;
				}
			}

			const altMatch = modifiers.alt === undefined || event.altKey === modifiers.alt;
			const shiftMatch = modifiers.shift === undefined || event.shiftKey === modifiers.shift;

			if (metaCtrlMatch && altMatch && shiftMatch) {
				event.preventDefault();
				onPress();
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [key, modifiers.meta, modifiers.ctrl, modifiers.alt, modifiers.shift, onPress, enabled, ignoreInputFocus]);
}
