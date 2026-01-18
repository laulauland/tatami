import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

/**
 * Syncs the document title and Tauri window title.
 * Updates both whenever the title changes.
 */
export function useAppTitle(title: string) {
	useEffect(() => {
		document.title = title;
		const windowHandle = getCurrentWindow();
		windowHandle.setTitle(title).catch(() => undefined);
	}, [title]);
}
