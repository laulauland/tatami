import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoPath = resolve(process.argv[2] ?? process.cwd());
const targetDir = resolve("target/debug");

const platformArtifact = (() => {
  switch (process.platform) {
    case "darwin":
      return join(targetDir, "libtatami_jj_native.dylib");
    case "linux":
      return join(targetDir, "libtatami_jj_native.so");
    case "win32":
      return join(targetDir, "tatami_jj_native.dll");
    default:
      throw new Error(`Unsupported platform for native smoke test: ${process.platform}`);
  }
})();

const candidates = [platformArtifact, join(targetDir, "tatami_jj_native.node")];

const artifact = candidates.find((path) => existsSync(path));

if (!artifact) {
  throw new Error(
    `Could not find tatami-jj-native build artifact. Run: cargo build -p tatami-jj-native`,
  );
}

const loadPath = join(targetDir, "tatami_jj_native.node");

if (artifact !== loadPath) {
  mkdirSync(dirname(loadPath), { recursive: true });
  rmSync(loadPath, { force: true });
  copyFileSync(artifact, loadPath);
}

const addon = require(loadPath) as {
  getRevisionsJson: (
    repoPath: string,
    limit: number,
    revset?: string | null,
    preset?: string | null,
  ) => string;
};

const revisionsJson = addon.getRevisionsJson(repoPath, 5, null, null);
const revisions = JSON.parse(revisionsJson);

if (!Array.isArray(revisions)) {
  throw new Error("getRevisionsJson did not return a JSON array");
}

console.log(JSON.stringify(revisions, null, 2));
