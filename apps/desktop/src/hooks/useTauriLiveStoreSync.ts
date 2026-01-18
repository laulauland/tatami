/**
 * Tauri → BroadcastChannel Relay
 *
 * Relays Tauri events to the worker's sync backend via BroadcastChannel.
 * The sync backend handles everything else (LiveStore processing, materialization).
 *
 * Flow:
 * 1. Rust backend commits to SQLite + emits livestore:event
 * 2. This relay forwards event via BroadcastChannel
 * 3. Worker sync backend receives and processes through LiveStore
 * 4. Materialized views update → React queries re-render
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";
import {
	TAURI_SYNC_CHANNEL,
	TAURI_SYNC_REQUEST,
	type PersistedEvent,
} from "../livestore/tauri-adapter";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useTauriLiveStoreSync(): void {
	useEffect(() => {
		if (!isTauri) {
			return;
		}

		let mounted = true;
		let unlistenEvent: UnlistenFn | null = null;

		// Channel to relay events to worker
		const syncChannel = new BroadcastChannel(TAURI_SYNC_CHANNEL);

		// Handle hydration requests from worker sync backend
		const requestChannel = new BroadcastChannel(TAURI_SYNC_REQUEST);
		requestChannel.onmessage = async (event) => {
			if (!mounted || event.data.type !== "hydrate") return;

			const { afterSequence, storeId } = event.data;

			try {
				const channel = new Channel<PersistedEvent | { done: true }>();

				channel.onmessage = (msg) => {
					if (!mounted) return;
					if (!("done" in msg)) {
						syncChannel.postMessage(msg);
					}
				};

				await invoke("plugin:livestore|stream_events", {
					storeId,
					channel,
					afterSequence,
				});
			} catch {
				// Hydration failed - silently ignore
			}
		};

		// Relay Tauri events to worker via BroadcastChannel
		async function setup() {
			try {
				unlistenEvent = await listen<PersistedEvent>("livestore:event", (event) => {
					if (!mounted) return;
					syncChannel.postMessage(event.payload);
				});
			} catch {
				// Setup failed - silently ignore
			}
		}

		setup();

		return () => {
			mounted = false;
			unlistenEvent?.();
			requestChannel.close();
			syncChannel.close();
		};
	}, []);
}
