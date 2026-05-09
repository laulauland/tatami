import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { Effect } from "effect";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AppRPC, GetRevisionsParams, RevisionStub } from "../shared/rpc.ts";
import { BackendRuntime } from "./runtime.ts";
import { RepoService } from "./services/RepoService.ts";

const DEV_SERVER_PORT = 5174;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
// Dev-only repo path for this spike. Replace with repo picker/persistence in a later revision.
function findDevRepoPath(): string {
	for (const startPath of [process.cwd(), import.meta.dir]) {
		let currentPath = resolve(startPath);

		for (;;) {
			if (existsSync(join(currentPath, ".jj"))) {
				return currentPath;
			}

			const parentPath = dirname(currentPath);
			if (parentPath === currentPath) {
				break;
			}

			currentPath = parentPath;
		}
	}

	return resolve(import.meta.dir, "../../../..");
}

const DEV_REPO_PATH = findDevRepoPath();
const DEFAULT_REVISION_LIMIT = 50;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run electrobun:dev:hmr' for HMR support.",
			);
		}
	}

	return "views://mainview/index.html";
}

async function getRevisions(params: GetRevisionsParams): Promise<RevisionStub[]> {
	const request = {
		repoPath: params.repoPath ?? DEV_REPO_PATH,
		limit: params.limit ?? DEFAULT_REVISION_LIMIT,
	};

	try {
		return await BackendRuntime.runPromise(
			Effect.gen(function* () {
				const repo = yield* RepoService;
				return yield* repo.getRevisions(request);
			}),
		);
	} catch (error) {
		console.error(`Failed to get revisions for ${request.repoPath}`, error);
		throw error;
	}
}

const appRpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			getRevisions,
		},
		messages: {},
	},
});

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
	title: "Tatami",
	url,
	rpc: appRpc,
	frame: {
		width: 1000,
		height: 700,
		x: 200,
		y: 200,
	},
});

console.log("Tatami Electrobun shell started", mainWindow.id);
