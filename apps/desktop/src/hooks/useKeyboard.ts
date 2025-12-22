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

interface UseKeySequenceOptions {
	sequence: string;
	onTrigger: () => void;
	enabled?: boolean;
	timeoutMs?: number;
}

const DEFAULT_SEQUENCE_TIMEOUT_MS = 500;

export function useKeyboardNavigation({
	orderedRevisions,
	selectedChangeId,
	onNavigate,
}: UseKeyboardNavigationOptions) {
	const navigateToChangeId = (targetChangeId: string | null) => {
		if (!targetChangeId) return;
		onNavigate(targetChangeId);
		requestAnimationFrame(() => {
			const element = document.querySelector<HTMLElement>(`[data-change-id="${targetChangeId}"]`);
			if (element) {
				element.focus({ preventScroll: true });
				element.scrollIntoView({ block: "nearest", behavior: "smooth" });
			}
		});
	};

	const getCurrentContext = () => {
		let currentIndex = orderedRevisions.findIndex((r) => r.change_id === selectedChangeId);
		if (currentIndex < 0) {
			currentIndex = orderedRevisions.findIndex((r) => r.is_working_copy);
			if (currentIndex < 0) currentIndex = 0;
		}
		return { currentIndex, currentRevision: orderedRevisions[currentIndex] ?? null };
	};

	useKeySequence({
		sequence: "gg",
		onTrigger: () => navigateToChangeId(orderedRevisions[0]?.change_id || null),
		enabled: orderedRevisions.length > 0,
	});

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const activeElement = document.activeElement;
			if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
				return;
			}

			const { currentIndex, currentRevision } = getCurrentContext();
			let targetChangeId: string | null = null;

			switch (event.key) {
				case "j":
				case "ArrowDown":
					if (currentIndex >= 0 && currentIndex < orderedRevisions.length - 1) {
						targetChangeId = orderedRevisions[currentIndex + 1].change_id;
					}
					event.preventDefault();
					break;

				case "k":
				case "ArrowUp":
					if (currentIndex > 0) {
						targetChangeId = orderedRevisions[currentIndex - 1].change_id;
					}
					event.preventDefault();
					break;

				case "J":
					if (currentRevision && currentRevision.parent_ids.length > 0) {
						const parentId = currentRevision.parent_ids[0];
						const parentRevision = orderedRevisions.find((r) => r.commit_id === parentId);
						targetChangeId = parentRevision?.change_id || null;
					}
					event.preventDefault();
					break;

				case "K":
					if (currentRevision) {
						const childRevision = orderedRevisions.find((r) =>
							r.parent_ids.includes(currentRevision.commit_id),
						);
						targetChangeId = childRevision?.change_id || null;
					}
					event.preventDefault();
					break;

				case "@":
					targetChangeId = orderedRevisions.find((r) => r.is_working_copy)?.change_id || null;
					event.preventDefault();
					break;

				case "G":
					targetChangeId = orderedRevisions[orderedRevisions.length - 1]?.change_id || null;
					event.preventDefault();
					break;

				case "Escape":
					onNavigate("");
					event.preventDefault();
					break;
			}

			navigateToChangeId(targetChangeId);
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
	}, [
		key,
		modifiers.meta,
		modifiers.ctrl,
		modifiers.alt,
		modifiers.shift,
		onPress,
		enabled,
		ignoreInputFocus,
	]);
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

export function useKeySequence({
	sequence,
	onTrigger,
	enabled = true,
	timeoutMs = DEFAULT_SEQUENCE_TIMEOUT_MS,
}: UseKeySequenceOptions) {
	const bufferRef = useRef<{ keys: string; timestamp: number }>({ keys: "", timestamp: 0 });

	useEffect(() => {
		if (!enabled || sequence.length === 0) return;

		function handleKeyDown(event: KeyboardEvent) {
			if (MODIFIER_KEYS.has(event.key)) return;

			const activeElement = document.activeElement;
			if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
				return;
			}

			const now = Date.now();
			const buffer = bufferRef.current;

			// Reset buffer if timeout elapsed
			if (now - buffer.timestamp > timeoutMs) {
				buffer.keys = "";
			}

			buffer.keys += event.key;
			buffer.timestamp = now;

			// Check if buffer ends with our sequence
			if (buffer.keys.endsWith(sequence)) {
				onTrigger();
				buffer.keys = "";
				event.preventDefault();
			}

			// Trim buffer to max sequence length to avoid memory growth
			if (buffer.keys.length > sequence.length) {
				buffer.keys = buffer.keys.slice(-sequence.length);
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [sequence, onTrigger, enabled, timeoutMs]);
}
