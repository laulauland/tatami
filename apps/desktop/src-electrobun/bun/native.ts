import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export type NativeAddon = {
	getRevisionsJson: (
		repoPath: string,
		limit: number,
		revset?: string | null,
		preset?: string | null,
	) => string;
	getRevisionChangesJson: (repoPath: string, changeId: string) => string;
	getRevisionDiffJson: (repoPath: string, changeId: string) => string;
	getChangesBatchJson: (repoPath: string, changeIds: string[]) => string;
	getDiffsBatchJson: (repoPath: string, changeIds: string[]) => string;
	generateChangeIds: (repoPath: string, count: number) => string[];
	jjNew: (repoPath: string, parentChangeIds: string[], changeId?: string | null) => string;
	jjEdit: (repoPath: string, changeId: string) => string;
	jjAbandon: (repoPath: string, changeId: string) => string;
	jjDescribe: (repoPath: string, changeId: string, description: string) => string;
	jjSquash: (repoPath: string, changeId: string) => string;
	jjRebase: (repoPath: string, sourceChangeId: string, destinationChangeId: string) => string;
};

const require = createRequire(import.meta.url);
const WORKSPACE_ROOT = resolve(import.meta.dir, "../../../..");

function getAncestorTargetDirs(startPath: string): string[] {
	const targetDirs: string[] = [];
	let currentPath = resolve(startPath);

	for (;;) {
		targetDirs.push(join(currentPath, "target/debug"));

		const parentPath = dirname(currentPath);
		if (parentPath === currentPath) {
			break;
		}

		currentPath = parentPath;
	}

	return targetDirs;
}

const targetDirCandidates = [
	resolve(process.cwd(), "target/debug"),
	resolve(WORKSPACE_ROOT, "target/debug"),
	...getAncestorTargetDirs(process.cwd()),
	...getAncestorTargetDirs(import.meta.dir),
];

function getPlatformArtifactName(): string {
	switch (process.platform) {
		case "darwin":
			return "libtatami_jj_native.dylib";
		case "linux":
			return "libtatami_jj_native.so";
		case "win32":
			return "tatami_jj_native.dll";
		default:
			throw new Error(`Unsupported platform for tatami-jj-native: ${process.platform}`);
	}
}

function resolveAddonPath(): string {
	const platformArtifactName = getPlatformArtifactName();

	for (const targetDir of targetDirCandidates) {
		const loadPath = join(targetDir, "tatami_jj_native.node");
		const candidates = [join(targetDir, platformArtifactName), loadPath];
		const artifact = candidates.find((path) => existsSync(path));

		if (!artifact) {
			continue;
		}

		if (artifact !== loadPath) {
			mkdirSync(dirname(loadPath), { recursive: true });
			rmSync(loadPath, { force: true });
			copyFileSync(artifact, loadPath);
		}

		return loadPath;
	}

	throw new Error(
		`Could not find tatami-jj-native build artifact in ${targetDirCandidates.join(
			", ",
		)}. Run: cargo build -p tatami-jj-native`,
	);
}

export function loadNativeAddon(): NativeAddon {
	const loadPath = resolveAddonPath();

	try {
		const addon = require(loadPath) as NativeAddon;

		const expectedExports = [
			"getRevisionsJson",
			"getRevisionChangesJson",
			"getRevisionDiffJson",
			"getChangesBatchJson",
			"getDiffsBatchJson",
			"generateChangeIds",
			"jjNew",
			"jjEdit",
			"jjAbandon",
			"jjDescribe",
			"jjSquash",
			"jjRebase",
		] as const;
		for (const exportName of expectedExports) {
			if (typeof addon[exportName] !== "function") {
				throw new Error(`Native addon is missing ${exportName}`);
			}
		}

		console.log(`Loaded tatami-jj-native addon from ${loadPath}`);
		return addon;
	} catch (error) {
		console.error(`Failed to load tatami-jj-native addon from ${loadPath}`, error);
		throw error;
	}
}
