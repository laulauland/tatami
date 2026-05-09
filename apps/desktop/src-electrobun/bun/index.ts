import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { Effect } from "effect";
import type {
	AppLayout,
	AppRPC,
	ChangedFile,
	GetRevisionsParams,
	Project,
	RevisionChanges,
	RevisionDiff,
	RevisionStub,
	UpsertProjectParams,
} from "../shared/rpc.ts";
import { BackendRuntime } from "./runtime.ts";
import { DesktopService } from "./services/DesktopService.ts";
import { RepoService } from "./services/RepoService.ts";
import { StorageService } from "./services/StorageService.ts";

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
			console.log(
				"Vite dev server not running. Run 'bun run electrobun:dev:hmr' for HMR support.",
			);
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

async function getRevisionChanges(params: { repoPath: string; changeId: string }): Promise<ChangedFile[]> {
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

async function getChangesBatch(params: { repoPath: string; changeIds: string[] }): Promise<RevisionChanges[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getChangesBatch(params);
		}),
	);
}

async function getDiffsBatch(params: { repoPath: string; changeIds: string[] }): Promise<RevisionDiff[]> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const repo = yield* RepoService;
			return yield* repo.getDiffsBatch(params);
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

async function removeProject({ id }: { id: string }): Promise<void> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.removeProject(id);
		}),
	);
}

async function getLayout(): Promise<AppLayout> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.getLayout();
		}),
	);
}

async function updateLayout(layout: Partial<AppLayout>): Promise<void> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const storage = yield* StorageService;
			return yield* storage.updateLayout(layout);
		}),
	);
}

async function openRepositoryDialog(): Promise<string | null> {
	return BackendRuntime.runPromise(
		Effect.gen(function* () {
			const desktop = yield* DesktopService;
			return yield* desktop.openFolderDialog();
		}),
	);
}

const appRpc = BrowserView.defineRPC<AppRPC>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			getRevisions,
			getRevisionChanges,
			getRevisionDiff,
			getChangesBatch,
			getDiffsBatch,
			getProjects,
			upsertProject,
			removeProject,
			getLayout,
			updateLayout,
			openRepositoryDialog,
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
