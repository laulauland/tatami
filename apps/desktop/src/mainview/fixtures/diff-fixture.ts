const buildHunk = (
	oldStart: number,
	oldLines: readonly string[],
	newStart: number,
	newLines: readonly string[],
): string[] => {
	const maxLineCount = Math.max(oldLines.length, newLines.length);
	const hunkLines = [`@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`];

	for (let index = 0; index < maxLineCount; index += 1) {
		const oldLine = oldLines[index];
		const newLine = newLines[index];

		if (oldLine === newLine && oldLine !== undefined) {
			hunkLines.push(` ${oldLine}`);
			continue;
		}

		if (oldLine !== undefined) {
			hunkLines.push(`-${oldLine}`);
		}

		if (newLine !== undefined) {
			hunkLines.push(`+${newLine}`);
		}
	}

	return hunkLines;
};

const buildPatchHeader = (fileName: string): string[] => [
	`diff --git a/${fileName} b/${fileName}`,
	"index 2b2b2b2..8c8c8c8 100644",
	`--- a/${fileName}`,
	`+++ b/${fileName}`,
];

const oldRevisionRows = [
	'import { Effect, Layer } from "effect";',
	'import { NativeClient } from "../services/NativeClient";',
	"",
	"export interface RevisionRow {",
	"\tid: string;",
	"\tdescription: string;",
	"\tauthor: string;",
	"\ttimestamp: string;",
	"\tbookmarks: readonly string[];",
	"}",
	"",
	"const DEFAULT_LIMIT = 50;",
	"",
	"function normalizeDescription(description: string): string {",
	'\treturn description.trim() || "(no description)";',
	"}",
	"",
	"function normalizeAuthor(author: string): string {",
	"\treturn author.trim();",
	"}",
	"",
	"export function toRevisionRow(revision: Revision): RevisionRow {",
	"\treturn {",
	"\t\tid: revision.change_id_short,",
	"\t\tdescription: normalizeDescription(revision.description),",
	"\t\tauthor: normalizeAuthor(revision.author),",
	"\t\ttimestamp: revision.timestamp,",
	"\t\tbookmarks: revision.bookmarks.map((bookmark) => bookmark.name),",
	"\t};",
	"}",
	"",
	"export const loadRevisionRows = Effect.gen(function* () {",
	"\tconst nativeClient = yield* NativeClient;",
	"\tconst revisions = yield* nativeClient.getRevisions({ limit: DEFAULT_LIMIT });",
	"\treturn revisions.map(toRevisionRow);",
	"});",
	"",
	"export function groupRowsByAuthor(rows: readonly RevisionRow[]): Map<string, RevisionRow[]> {",
	"\tconst groups = new Map<string, RevisionRow[]>();",
	"\tfor (const row of rows) {",
	"\t\tconst authorRows = groups.get(row.author) ?? [];",
	"\t\tauthorRows.push(row);",
	"\t\tgroups.set(row.author, authorRows);",
	"\t}",
	"\treturn groups;",
	"}",
	"",
	"export function describeRevision(row: RevisionRow): string {",
	'\treturn row.description + " by " + row.author;',
	"}",
	"",
	"export function hasBookmark(row: RevisionRow, bookmark: string): boolean {",
	"\treturn row.bookmarks.includes(bookmark);",
	"}",
	"",
	"export function latestRevision(rows: readonly RevisionRow[]): RevisionRow | undefined {",
	"\treturn rows[0];",
	"}",
	"",
	"export const RevisionLayer = Layer.empty;",
] as const;

const newRevisionRows = [
	'import { Effect, Layer } from "effect";',
	'import { NativeClient } from "../services/NativeClient";',
	"",
	"export interface RevisionRow {",
	"\tid: string;",
	"\tdescription: string;",
	"\tauthor: string;",
	"\ttimestamp: string;",
	"\tbookmarks: readonly string[];",
	"\tisWorkingCopy: boolean;",
	"}",
	"",
	"const DEFAULT_LIMIT = 75;",
	"",
	"function normalizeDescription(description: string): string {",
	"\tconst trimmedDescription = description.trim();",
	'\treturn trimmedDescription.length > 0 ? trimmedDescription : "(no description)";',
	"}",
	"",
	"function normalizeAuthor(author: string): string {",
	'\treturn author.trim() || "unknown author";',
	"}",
	"",
	"function formatBookmark(bookmark: { name: string }): string {",
	'\treturn bookmark.name.replace(/^refs\\/heads\\//, "");',
	"}",
	"",
	"export function toRevisionRow(revision: Revision): RevisionRow {",
	"\treturn {",
	"\t\tid: revision.change_id_short,",
	"\t\tdescription: normalizeDescription(revision.description),",
	"\t\tauthor: normalizeAuthor(revision.author),",
	"\t\ttimestamp: revision.timestamp,",
	"\t\tbookmarks: revision.bookmarks.map(formatBookmark),",
	"\t\tisWorkingCopy: revision.is_working_copy,",
	"\t};",
	"}",
	"",
	"export const loadRevisionRows = Effect.gen(function* () {",
	"\tconst nativeClient = yield* NativeClient;",
	"\tconst revisions = yield* nativeClient.getRevisions({ limit: DEFAULT_LIMIT });",
	"\treturn revisions.map(toRevisionRow);",
	"});",
	"",
	"export function groupRowsByAuthor(rows: readonly RevisionRow[]): Map<string, RevisionRow[]> {",
	"\tconst groups = new Map<string, RevisionRow[]>();",
	"\tfor (const row of rows) {",
	"\t\tconst authorRows = groups.get(row.author) ?? [];",
	"\t\tgroups.set(row.author, [...authorRows, row]);",
	"\t}",
	"\treturn groups;",
	"}",
	"",
	"export function describeRevision(row: RevisionRow): string {",
	'\tconst bookmarkSummary = row.bookmarks.length > 0 ? " (" + row.bookmarks.join(", ") + ")" : "";',
	'\treturn row.description + " by " + row.author + bookmarkSummary;',
	"}",
	"",
	"export function hasBookmark(row: RevisionRow, bookmark: string): boolean {",
	"\treturn row.bookmarks.some((candidate) => candidate === bookmark);",
	"}",
	"",
	"export function latestRevision(rows: readonly RevisionRow[]): RevisionRow | undefined {",
	"\treturn rows.find((row) => !row.isWorkingCopy) ?? rows[0];",
	"}",
	"",
	"export function countWorkingCopies(rows: readonly RevisionRow[]): number {",
	"\treturn rows.filter((row) => row.isWorkingCopy).length;",
	"}",
	"",
	"export const RevisionLayer = Layer.empty;",
] as const;

const buildLargePatch = (): string => {
	const chunks = Array.from({ length: 64 }, (_, index) => {
		const line = index + 1;
		return [
			` context line ${line}: keep cached graph layout stable`,
			`-const oldValue${line} = revisions[${index}]?.description ?? "";`,
			`-renderRow(oldValue${line}, "muted");`,
			`+const nextValue${line} = revisions[${index}]?.description?.trim() ?? "";`,
			`+renderRow(nextValue${line}, nextValue${line}.length > 0 ? "active" : "muted");`,
			` context line ${line}: preserve keyboard selection anchors`,
			` context line ${line}: update lane measurements after paint`,
			` context line ${line}: leave RPC boundaries untouched`,
		].join("\n");
	});

	return [
		"diff --git a/src/mainview/components/LargeRevisionList.ts b/src/mainview/components/LargeRevisionList.ts",
		"index 1010101..2020202 100644",
		"--- a/src/mainview/components/LargeRevisionList.ts",
		"+++ b/src/mainview/components/LargeRevisionList.ts",
		"@@ -1,384 +1,384 @@",
		...chunks,
	].join("\n");
};

export const FIXTURE_PATCH = [
	...buildPatchHeader("src/mainview/data/revisions.ts"),
	...buildHunk(1, oldRevisionRows.slice(0, 24), 1, newRevisionRows.slice(0, 29)),
	...buildHunk(25, oldRevisionRows.slice(24, 48), 30, newRevisionRows.slice(29, 54)),
	...buildHunk(49, oldRevisionRows.slice(48), 55, newRevisionRows.slice(54)),
].join("\n");

export const FIXTURE_PATCH_LARGE = buildLargePatch();
