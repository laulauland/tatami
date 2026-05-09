import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { resolve } from "node:path";
import { nativeAddon } from "./native.ts";
import type { AppRPC, GetRevisionsParams, RevisionStub } from "../shared/rpc.ts";

const DEV_SERVER_PORT = 5174;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
// Dev-only repo path for this spike. Replace with repo picker/persistence in a later revision.
const DEV_REPO_PATH = resolve(import.meta.dir, "../../../..");
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

function getRevisions(params: GetRevisionsParams): RevisionStub[] {
	const repoPath = params.repoPath ?? DEV_REPO_PATH;
	const limit = params.limit ?? DEFAULT_REVISION_LIMIT;

	try {
		const revisionsJson = nativeAddon.getRevisionsJson(repoPath, limit, null, null);
		const revisions = JSON.parse(revisionsJson) as unknown;

		if (!Array.isArray(revisions)) {
			throw new Error("getRevisionsJson did not return a JSON array");
		}

		return revisions as RevisionStub[];
	} catch (error) {
		console.error(`Failed to get revisions for ${repoPath}`, error);
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
