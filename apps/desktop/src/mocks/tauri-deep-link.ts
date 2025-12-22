type UnlistenFn = () => void;

export async function getCurrent(): Promise<string[] | null> {
	// In mock mode (browser), there are no deep links on cold start
	return null;
}

export async function onOpenUrl(_handler: (urls: string[]) => void): Promise<UnlistenFn> {
	// In mock mode (browser), deep links won't work - just return a no-op unlisten
	return () => {};
}
