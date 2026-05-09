export type ShortcutModifiers = {
	meta?: boolean;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
};

export type ShortcutOptions = {
	enabled?: () => boolean;
	allowInEditable?: boolean;
	preventDefault?: boolean;
};

export function isEditableElement(element: EventTarget | null = document.activeElement): boolean {
	if (!(element instanceof HTMLElement)) return false;
	const tagName = element.tagName.toLowerCase();
	return (
		tagName === "input" ||
		tagName === "textarea" ||
		tagName === "select" ||
		element.isContentEditable
	);
}

function isMacPlatform(): boolean {
	return typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function modifierMatches(event: KeyboardEvent, modifiers: ShortcutModifiers = {}): boolean {
	const wantsPrimary = modifiers.meta === true && modifiers.ctrl === true;
	if (wantsPrimary) {
		if (isMacPlatform() ? !event.metaKey : !event.ctrlKey) return false;
	} else {
		if (modifiers.meta !== undefined && event.metaKey !== modifiers.meta) return false;
		if (modifiers.ctrl !== undefined && event.ctrlKey !== modifiers.ctrl) return false;
	}
	if (modifiers.alt !== undefined && event.altKey !== modifiers.alt) return false;
	if (modifiers.shift !== undefined && event.shiftKey !== modifiers.shift) return false;
	return true;
}

function isPrintableKey(key: string): boolean {
	return key.length === 1;
}

function keyMatches(event: KeyboardEvent, key: string): boolean {
	return isPrintableKey(key) ? event.key === key : event.key.toLowerCase() === key.toLowerCase();
}

export function createKeyboardShortcut(
	key: string,
	modifiers: ShortcutModifiers,
	handler: (event: KeyboardEvent) => void,
	options: ShortcutOptions = {},
): () => void {
	function onKeydown(event: KeyboardEvent): void {
		if (options.enabled?.() === false) return;
		if (!options.allowInEditable && isEditableElement(event.target)) return;
		if (!keyMatches(event, key) || !modifierMatches(event, modifiers)) return;
		if (options.preventDefault !== false) event.preventDefault();
		handler(event);
	}
	window.addEventListener("keydown", onKeydown);
	return () => window.removeEventListener("keydown", onKeydown);
}

export function createKeySequence(
	sequence: string[],
	handler: (event: KeyboardEvent) => void,
	options: ShortcutOptions & { timeoutMs?: number } = {},
): () => void {
	let buffer: string[] = [];
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const timeoutMs = options.timeoutMs ?? 500;

	function reset(): void {
		buffer = [];
		if (timeout != null) clearTimeout(timeout);
		timeout = null;
	}

	function onKeydown(event: KeyboardEvent): void {
		if (options.enabled?.() === false) return;
		if (!options.allowInEditable && isEditableElement(event.target)) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		buffer = [...buffer, event.key].slice(-sequence.length);
		if (timeout != null) clearTimeout(timeout);
		timeout = setTimeout(reset, timeoutMs);

		const matched = sequence.every((key, index) => {
			const bufferedKey = buffer[index];
			if (bufferedKey == null) return false;
			return isPrintableKey(key)
				? bufferedKey === key
				: bufferedKey.toLowerCase() === key.toLowerCase();
		});
		if (!matched) return;
		if (options.preventDefault !== false) event.preventDefault();
		reset();
		handler(event);
	}

	window.addEventListener("keydown", onKeydown);
	return () => {
		reset();
		window.removeEventListener("keydown", onKeydown);
	};
}
