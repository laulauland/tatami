type UnlistenFn = () => void;

interface Event<T> {
	payload: T;
}

type EventCallback<T> = (event: Event<T>) => void;

export async function listen<T>(
	_event: string,
	_handler: EventCallback<T>,
): Promise<UnlistenFn> {
	// In mock mode, never emit events - just return a no-op unlisten
	return () => {};
}

export async function emit(_event: string, _payload?: unknown): Promise<void> {
	// no-op in mock mode
}
