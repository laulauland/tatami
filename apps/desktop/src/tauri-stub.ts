// This file MUST be imported before any @tauri-apps/* imports
// It sets up a minimal stub so Tauri modules don't crash in browser mode

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

if (!isTauri && typeof window !== "undefined") {
	// biome-ignore lint/suspicious/noExplicitAny: Tauri internals stub
	(window as any).__TAURI_INTERNALS__ = {
		invoke: () => Promise.reject(new Error("Tauri mocks not initialized yet")),
		metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
	};
}

export const IS_TAURI = isTauri;
