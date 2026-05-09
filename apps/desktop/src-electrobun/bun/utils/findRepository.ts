import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findRepository(startPath: string): string | null {
	let currentPath = resolve(startPath);

	for (;;) {
		if (existsSync(join(currentPath, ".jj"))) {
			return currentPath;
		}

		const parentPath = dirname(currentPath);
		if (parentPath === currentPath) {
			return null;
		}

		currentPath = parentPath;
	}
}
