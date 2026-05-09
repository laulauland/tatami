import Electrobun, { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { Effect } from "effect";
import type {
	AppLayout,
	AppRPC,
	ChangedFile,
	GetRevisionsParams,
	JjDescribeParams,
	JjNewParams,
	JjRebaseParams,
	MessageBoxOptions,
	MessageBoxResponse,
	MutationResult,
	Operation,
	Project,
	RevisionChanges,
	RevisionDiff,
	RevisionStub,
	RevsetResult,
	UpsertProjectParams,
} from "../shared/rpc.ts";
import { BackendRuntime } from "./runtime.ts";
import { DesktopService } from "./services/DesktopService.ts";
import { RepoService } from "./services/RepoService.ts";
import { StorageService } from "./services/StorageService.ts";
import { WatcherService } from "./services/WatcherService.ts";

const DEV_SERVER_PORT = 5174;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const DEFAULT_REVISION_LIMIT = 50;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log("Vite dev server not running. Run 'bun run electrobun:dev:hmr' for HMR support.");
		}
	}

	return "views://mainview/index.html";
}

async function getActiveRepoPath(): Promise<string | undefined> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			const layout = yield* storage.getLayout();
			if (layout.active_project_id == null) return undefined;

			const projects = yield* storage.getProjects();
			return projects.find((project) => project.id === layout.active_project_id)?.path;
		}),
	);
}

async function getRevisions(params: GetRevisionsParams): Promise<RevisionStub[]> {
	const repoPath = params.repoPath ?? (await getActiveRepoPath());
	if (repoPath == null) {
		return [];
	}

	const request = {
		repoPath,
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

async function getRevisionChanges(params: {
	repoPath: string;
	changeId: string;
}): Promise<ChangedFile[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getRevisionChanges(params);
		}),
	);
}

async function getRevisionDiff(params: { repoPath: string; changeId: string }): Promise<string> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getRevisionDiff(params);
		}),
	);
}

async function getChangesBatch(params: {
	repoPath: string;
	changeIds: string[];
}): Promise<RevisionChanges[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getChangesBatch(params);
		}),
	);
}

async function getDiffsBatch(params: {
	repoPath: string;
	changeIds: string[];
}): Promise<RevisionDiff[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getDiffsBatch(params);
		}),
	);
}

async function generateChangeIds(params: { repoPath: string; count: number }): Promise<string[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.generateChangeIds(params);
		}),
	);
}

async function jjNew(params: JjNewParams): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.jjNew(params);
		}),
	);
}

async function jjEdit(params: { repoPath: string; changeId: string }): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.jjEdit(params);
		}),
	);
}

async function jjAbandon(params: { repoPath: string; changeId: string }): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.jjAbandon(params);
		}),
	);
}

async function jjDescribe(params: JjDescribeParams): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.jjDescribe(params);
		}),
	);
}

async function jjSquash(params: { repoPath: string; changeId: string }): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.jjSquash(params);
		}),
	);
}

async function jjRebase(params: JjRebaseParams): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.jjRebase(params);
		}),
	);
}

async function getOperations(params: { repoPath: string; limit: number }): Promise<Operation[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getOperations(params);
		}),
	);
}

async function resolveRevset(params: { repoPath: string; revset: string }): Promise<RevsetResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.resolveRevset(params);
		}),
	).catch((error) => ({
		change_ids: [],
		error: error instanceof Error ? error.message : String(error),
	}));
}

async function undoOperation(params: {
	repoPath: string;
	operationId: string;
}): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.undoOperation(params);
		}),
	);
}

async function gitFetch(params: {
	repoPath: string;
	remote?: string | null;
}): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.gitFetch(params);
		}),
	);
}

async function gitPush(params: {
	repoPath: string;
	bookmarkNames: string[];
	remote?: string | null;
}): Promise<MutationResult> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.gitPush(params);
		}),
	);
}

async function getProjects(): Promise<Project[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.getProjects();
		}),
	);
}

async function upsertProject(params: UpsertProjectParams): Promise<Project> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.upsertProject(params);
		}),
	);
}

async function removeProject({ id }: { id: string }): Promise<undefined> {
	await BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.removeProject(id);
		}),
	);
	return undefined;
}

async function getLayout(): Promise<AppLayout> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.getLayout();
		}),
	);
}

async function updateLayout(layout: Partial<AppLayout>): Promise<undefined> {
	await BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.updateLayout(layout);
		}),
	);
	return undefined;
}

async function openRepositoryDialog(): Promise<string | null> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.openFolderDialog();
		}),
	);
}

async function watchRepository(params: { repoPath: string }): Promise<undefined> {
	await BackendRuntime.runPromise(
		Effect.gen(function* () {
			const watcher = yield* WatcherService;
			return yield* watcher.watch(params.repoPath);
		}),
	);
	return undefined;
}

async function unwatchRepository(params: { repoPath: string }): Promise<undefined> {
	await BackendRuntime.runPromise(
		Effect.gen(function* () {
			const watcher = yield* WatcherService;
			return yield* watcher.unwatch(params.repoPath);
		}),
	);
	return undefined;
}

async function setupApplicationMenu(): Promise<void> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.setupApplicationMenu();
		}),
	);
}

async function openExternal(params: { url: string }): Promise<boolean> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.openExternal(params.url);
		}),
	);
}

async function openPath(params: { path: string }): Promise<boolean> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.openPath(params.path);
		}),
	);
}

async function showItemInFolder(params: { path: string }): Promise<undefined> {
	await BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.showItemInFolder(params.path);
		}),
	);
	return undefined;
}

async function showMessageBox(params: MessageBoxOptions): Promise<MessageBoxResponse> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.showMessageBox(params);
		}),
	);
}

const appRpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 15000,
	handlers: {
		requests: {
			getRevisions,
			getRevisionChanges,
			getRevisionDiff,
			getChangesBatch,
			getDiffsBatch,
			generateChangeIds,
			jjNew,
			jjEdit,
			jjAbandon,
			jjDescribe,
			jjSquash,
			jjRebase,
			getOperations,
			resolveRevset,
			undoOperation,
			gitFetch,
			gitPush,
			getProjects,
			upsertProject,
			removeProject,
			getLayout,
			updateLayout,
			openRepositoryDialog,
			watchRepository,
			unwatchRepository,
			openExternal,
			openPath,
			showItemInFolder,
			showMessageBox,
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

await BackendRuntime.runPromise(
	Effect.gen(function* () {
		const watcher = yield* WatcherService;
		yield* watcher.setRepoChangedHandler((event) => {
			mainWindow.webview.rpc?.send.repoChanged(event);
		});
	}),
);
await setupApplicationMenu();

Electrobun.events.on("application-menu-clicked", (event) => {
	const action = event.data.action;
	if (action === "open-repository") {
		mainWindow.webview.rpc?.send.openRepositoryRequested({});
	}
});

Electrobun.events.on("open-url", (event) => {
	const url = event.data.url;
	if (!url.startsWith("tatami://")) {
		console.warn(`Unsupported deep link URL: ${url}`);
		return;
	}
	mainWindow.webview.rpc?.send.deepLink({ url });
});

Electrobun.events.on("before-quit", () => {
	void BackendRuntime.runPromise(
		Effect.gen(function* () {
			const watcher = yield* WatcherService;
			return yield* watcher.unwatchAll();
		}),
	);
});

console.log("Tatami Electrobun shell started", mainWindow.id);
