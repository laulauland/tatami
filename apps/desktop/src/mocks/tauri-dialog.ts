interface OpenDialogOptions {
	directory?: boolean;
	multiple?: boolean;
	defaultPath?: string;
	title?: string;
}

export async function open(_options?: OpenDialogOptions): Promise<string | null> {
	// In mock mode, just return a fake path
	return "/Users/demo/projects/tatami";
}
