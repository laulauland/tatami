import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dir, "..");
const workspaceRoot = resolve(desktopRoot, "../..");
const targetDir = resolve(workspaceRoot, "target/debug");
const outputPath = resolve(desktopRoot, "native/tatami_jj_native.node");

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

const candidates = [
	join(targetDir, "tatami_jj_native.node"),
	join(targetDir, getPlatformArtifactName()),
];
const artifact = candidates.find((candidate) => existsSync(candidate));

if (!artifact) {
	throw new Error(
		`Could not find tatami-jj-native build artifact. Checked: ${candidates.join(", ")}`,
	);
}

mkdirSync(dirname(outputPath), { recursive: true });
copyFileSync(artifact, outputPath);
console.log(`Prepared native addon: ${artifact} -> ${outputPath}`);
