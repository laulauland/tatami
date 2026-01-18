import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// ============================================================================
// Types
// ============================================================================

export interface PersistedEvent {
	id: string;
	sequence: number;
	name: string;
	payload: string;
	timestamp: number;
	clientId: string;
}

// ============================================================================
// Channel names for cross-window sync
// ============================================================================

export const TAURI_SYNC_CHANNEL = "tauri-livestore-sync";
export const TAURI_SYNC_REQUEST = "tauri-livestore-request";

interface TauriAdapterConfig {
	storeId?: string;
	batchSize?: number;
	flushDebounceMs?: number;
}

// ============================================================================
// LiveStore Event Types (simplified interface matching LiveStore's needs)
// ============================================================================

interface StoredEvent {
	id: string;
	sequence: number;
	name: string;
	payload: unknown;
	timestamp: number;
	clientId: string;
}

interface SyncStatus {
	pendingEvents: number;
	lastPersistedSequence: number;
	isOnline: boolean;
}

// ============================================================================
// Tauri Sync Adapter
// ============================================================================

/**
 * TauriSyncAdapter bridges LiveStore's event log to Rust SQLite.
 *
 * Key design:
 * - Events are the unit of sync (not queries, not tables)
 * - Writes are batched and debounced for efficiency
 * - Hydration streams events via Tauri Channel for backpressure
 * - No queries cross the IPC boundary
 */
export function createTauriAdapter(config: TauriAdapterConfig = {}) {
	const { storeId = "default", batchSize = 100, flushDebounceMs = 50 } = config;

	let pendingEvents: StoredEvent[] = [];
	let flushTimeout: ReturnType<typeof setTimeout> | null = null;
	let lastPersistedSequence = 0;
	let unlistenFn: UnlistenFn | null = null;
	const clientId = crypto.randomUUID();

	const adapter = {
		async init(): Promise<{ lastPersistedSequence: number }> {
			await invoke("init_event_store", { storeId });
			lastPersistedSequence = await invoke<number>("get_last_sequence", { storeId });
			return { lastPersistedSequence };
		},

		async loadEvents(onEvent: (event: StoredEvent) => void, onComplete: () => void): Promise<void> {
			const channel = new Channel<PersistedEvent | { done: true }>();

			channel.onmessage = (message) => {
				if ("done" in message) {
					onComplete();
				} else {
					onEvent({
						id: message.id,
						sequence: message.sequence,
						name: message.name,
						payload: JSON.parse(message.payload),
						timestamp: message.timestamp,
						clientId: message.clientId,
					});
				}
			};

			await invoke("stream_events", { storeId, channel, afterSequence: 0 });
		},

		onEvent(event: StoredEvent): void {
			pendingEvents.push(event);

			if (flushTimeout) clearTimeout(flushTimeout);

			if (pendingEvents.length >= batchSize) {
				adapter.flush();
			} else {
				flushTimeout = setTimeout(() => adapter.flush(), flushDebounceMs);
			}
		},

		async flush(): Promise<void> {
			if (pendingEvents.length === 0) return;

			const eventsToFlush = pendingEvents;
			pendingEvents = [];

			if (flushTimeout) {
				clearTimeout(flushTimeout);
				flushTimeout = null;
			}

			try {
				const serialized = eventsToFlush.map((e) => ({
					id: e.id,
					sequence: e.sequence,
					name: e.name,
					payload: JSON.stringify(e.payload),
					timestamp: e.timestamp,
					clientId,
				}));

				await invoke("persist_events", { storeId, events: serialized });
				lastPersistedSequence = eventsToFlush[eventsToFlush.length - 1].sequence;
			} catch (error) {
				// Re-add failed events to front of queue
				pendingEvents = [...eventsToFlush, ...pendingEvents];
				throw error;
			}
		},

		async subscribe(onExternalEvent: (event: StoredEvent) => void): Promise<void> {
			unlistenFn = await listen<PersistedEvent>("livestore:event", (event) => {
				// Ignore events from this client
				if (event.payload.clientId === clientId) return;

				onExternalEvent({
					id: event.payload.id,
					sequence: event.payload.sequence,
					name: event.payload.name,
					payload: JSON.parse(event.payload.payload),
					timestamp: event.payload.timestamp,
					clientId: event.payload.clientId,
				});
			});
		},

		getStatus(): SyncStatus {
			return {
				pendingEvents: pendingEvents.length,
				lastPersistedSequence,
				isOnline: true,
			};
		},

		async dispose(): Promise<void> {
			await adapter.flush();
			if (unlistenFn) {
				unlistenFn();
				unlistenFn = null;
			}
		},

		clientId,
		storeId,
	};

	return adapter;
}

export type TauriAdapter = ReturnType<typeof createTauriAdapter>;
