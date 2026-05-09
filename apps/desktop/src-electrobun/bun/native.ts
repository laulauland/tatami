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
};

const require = createRequire(import.meta.url);
const WORKSPACE_ROOT = resolve(import.meta.dir, "../../../..");
const targetDirCandidates = [
	resolve(process.cwd(), "target/debug"),
	resolve(WORKSPACE_ROOT, "target/debug"),
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

function loadNativeAddon(): NativeAddon {
	const loadPath = resolveAddonPath();

	try {
		const addon = require(loadPath) as NativeAddon;

		if (typeof addon.getRevisionsJson !== "function") {
			throw new Error("Native addon is missing getRevisionsJson");
		}

		console.log(`Loaded tatami-jj-native addon from ${loadPath}`);
		return addon;
	} catch (error) {
		console.error(`Failed to load tatami-jj-native addon from ${loadPath}`, error);
		throw error;
	}
}

export const nativeAddon = loadNativeAddon();
