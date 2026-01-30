/**
 * Utilities for parsing and manipulating unified diffs.
 */

/**
 * Extract file path from a unified diff patch.
 * Parses the "+++ b/..." line to get the new file path.
 */
export function extractFilePath(patch: string): string | undefined {
	const match = patch.match(/^\+\+\+ b\/(.+)$/m);
	return match ? match[1] : undefined;
}

/**
 * Split a multi-file unified diff into individual file diffs.
 * Each file diff starts with "--- a/..." line.
 */
export function splitMultiFileDiff(unifiedDiff: string): string[] {
	if (!unifiedDiff.trim()) {
		return [];
	}

	const fileDiffs: string[] = [];
	const lines = unifiedDiff.split("\n");
	let currentDiff: string[] = [];

	for (const line of lines) {
		if (line.startsWith("--- a/") && currentDiff.length > 0) {
			fileDiffs.push(currentDiff.join("\n"));
			currentDiff = [line];
		} else {
			currentDiff.push(line);
		}
	}

	if (currentDiff.length > 0) {
		fileDiffs.push(currentDiff.join("\n"));
	}

	return fileDiffs;
}

/**
 * Parse additions and deletions from a single patch.
 */
export function parsePatchStats(patch: string): { additions: number; deletions: number } {
	let additions = 0;
	let deletions = 0;
	const lines = patch.split("\n");

	for (const line of lines) {
		// Skip header lines
		if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) {
			continue;
		}
		if (line.startsWith("+") && !line.startsWith("++")) {
			additions++;
		} else if (line.startsWith("-") && !line.startsWith("--")) {
			deletions++;
		}
	}

	return { additions, deletions };
}
