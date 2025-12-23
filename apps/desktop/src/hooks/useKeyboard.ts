import { useEffect, useRef } from "react";
import type { Revision } from "@/tauri-commands";

interface ScrollOptions {
	align?: "auto" | "center";
	smooth?: boolean;
}

interface UseKeyboardNavigationOptions {
	orderedRevisions: Revision[];
	selectedChangeId: string | null;
	onNavigate: (changeId: string) => void;
	scrollToChangeId?: (changeId: string, options?: ScrollOptions) => void;
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
	scrollToChangeId,
}: UseKeyboardNavigationOptions) {
	// Use refs to avoid stale closures in event handler
	const orderedRevisionsRef = useRef(orderedRevisions);
	const selectedChangeIdRef = useRef(selectedChangeId);
	const onNavigateRef = useRef(onNavigate);
	const scrollToChangeIdRef = useRef(scrollToChangeId);

	orderedRevisionsRef.current = orderedRevisions;
	selectedChangeIdRef.current = selectedChangeId;
	onNavigateRef.current = onNavigate;
	scrollToChangeIdRef.current = scrollToChangeId;

	useKeySequence({
		sequence: "gg",
		onTrigger: () => {
			const revisions = orderedRevisionsRef.current;
			const targetChangeId = revisions[0]?.change_id || null;
			if (targetChangeId) {
				onNavigateRef.current(targetChangeId);
				scrollToChangeIdRef.current?.(targetChangeId, { align: "center", smooth: true });
			}
		},
		enabled: orderedRevisions.length > 0,
	});

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const activeElement = document.activeElement;
			if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
				return;
			}

			const revisions = orderedRevisionsRef.current;
			const changeId = selectedChangeIdRef.current;

			let currentIndex = revisions.findIndex((r) => r.change_id === changeId);
			if (currentIndex < 0) {
				currentIndex = revisions.findIndex((r) => r.is_working_copy);
				if (currentIndex < 0) currentIndex = 0;
			}
			const currentRevision = revisions[currentIndex] ?? null;

			let targetChangeId: string | null = null;
			// "jump" = always scroll to center, "step" = scroll only if needed, "none" = no explicit scroll
			let scrollMode: "jump" | "step" | "none" = "none";

			// Check for - and + using code (more reliable across keyboard layouts)
			const isMinusKey =
				event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract";
			const isPlusKey =
				event.key === "+" ||
				event.key === "=" ||
				event.code === "Equal" ||
				event.code === "NumpadAdd";

			switch (true) {
				case event.key === "j" || event.key === "ArrowDown":
					if (currentIndex >= 0 && currentIndex < revisions.length - 1) {
						targetChangeId = revisions[currentIndex + 1].change_id;
						scrollMode = "step";
					}
					event.preventDefault();
					break;

				case event.key === "k" || event.key === "ArrowUp":
					if (currentIndex > 0) {
						targetChangeId = revisions[currentIndex - 1].change_id;
						scrollMode = "step";
					}
					event.preventDefault();
					break;

				case event.key === "J" || isMinusKey:
					if (currentRevision) {
						// Navigate to parent revision
						const parentId =
							currentRevision.parent_ids[0] || currentRevision.parent_edges[0]?.parent_id;
						if (parentId) {
							const parentRevision = revisions.find((r) => r.commit_id === parentId);
							if (parentRevision) {
								targetChangeId = parentRevision.change_id;
								scrollMode = "step";
							}
						}
					}
					event.preventDefault();
					break;

				case event.key === "K" || isPlusKey:
					if (currentRevision) {
						// Find child by checking if any revision has current as parent
						const childRevision = revisions.find(
							(r) =>
								r.parent_ids.includes(currentRevision.commit_id) ||
								r.parent_edges.some((e) => e.parent_id === currentRevision.commit_id),
						);
						if (childRevision) {
							targetChangeId = childRevision.change_id;
							scrollMode = "step";
						}
					}
					event.preventDefault();
					break;

				case event.key === "@":
					targetChangeId = revisions.find((r) => r.is_working_copy)?.change_id || null;
					scrollMode = "jump";
					event.preventDefault();
					break;

				case event.key === "G":
					targetChangeId = revisions[revisions.length - 1]?.change_id || null;
					scrollMode = "jump";
					event.preventDefault();
					break;

				case event.key === "Escape":
					onNavigateRef.current("");
					event.preventDefault();
					break;
			}

			if (targetChangeId) {
				onNavigateRef.current(targetChangeId);
				if (scrollMode === "jump") {
					scrollToChangeIdRef.current?.(targetChangeId, { align: "center", smooth: true });
				} else if (scrollMode === "step") {
					scrollToChangeIdRef.current?.(targetChangeId, { align: "auto", smooth: false });
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);
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
