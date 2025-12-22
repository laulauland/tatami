import { useEffect, useRef } from "react";
import type { Revision } from "@/tauri-commands";

interface UseKeyboardNavigationOptions {
	orderedRevisions: Revision[];
	selectedChangeId: string | null;
	onNavigate: (changeId: string) => void;
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
			}

			// Navigate to target and scroll into view
			if (targetChangeId) {
				onNavigate(targetChangeId);

				// Scroll into view after state update
				requestAnimationFrame(() => {
					const element = document.querySelector(`[data-change-id="${targetChangeId}"]`);
					element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
				});
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [orderedRevisions, selectedChangeId, onNavigate]);
}
