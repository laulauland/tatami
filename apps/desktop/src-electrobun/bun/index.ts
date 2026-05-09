import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type { AppRPC, RevisionStub } from "../shared/rpc.ts";

const DEV_SERVER_PORT = 5174;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

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

const revisionFixtures: RevisionStub[] = [
	{
		changeId: "ol",
		commitId: "bc91d47c",
		description: "feat(desktop): add typed electrobun rpc stubs",
		author: "Laurynas",
		timestamp: "2026-05-08T12:00:00.000Z",
		bookmarks: [],
		isWorkingCopy: true,
	},
	{
		changeId: "zq",
		commitId: "6ce3b1f1",
		description: "feat(desktop): add electrobun svelte shell",
		author: "Laurynas",
		timestamp: "2026-05-08T10:30:00.000Z",
		bookmarks: ["electrobun-svelte-shell"],
		isWorkingCopy: false,
	},
	{
		changeId: "mk",
		commitId: "91a3f2bd",
		description: "docs: shape electrobun svelte rewrite",
		author: "Laurynas",
		timestamp: "2026-05-07T17:45:00.000Z",
		bookmarks: [],
		isWorkingCopy: false,
	},
	{
		changeId: "pv",
		commitId: "4f7c9a21",
		description: "feat(repo): render revision graph shell",
		author: "Tatami contributors",
		timestamp: "2026-05-06T09:15:00.000Z",
		bookmarks: ["main"],
		isWorkingCopy: false,
	},
];

const appRpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			getRevisions: () => revisionFixtures,
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

setTimeout(() => {
	appRpc.send.repoChanged({ timestamp: Date.now() });
}, 1000);

console.log("Tatami Electrobun shell started", mainWindow.id);
