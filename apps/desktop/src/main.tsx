// MUST be first import - sets up Tauri stub for browser mode
import { IS_TAURI } from "./tauri-stub";

import { RegistryProvider } from "@effect-atom/atom-react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { queryClient } from "./db";
import { initializeTheme } from "./hooks/useTheme";
import { setupMocks } from "./mocks/setup";
import { routeTree } from "./routeTree.gen";
import "./styles/index.css";

const workerPoolOptions = {
	workerFactory: () =>
		new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
	poolSize: 4,
};

const highlighterOptions = {
	theme: { dark: "pierre-dark", light: "pierre-light" } as const,
};

const router = createRouter({
	routeTree,
	defaultPreloadStaleTime: 0,
	scrollRestoration: false,
	defaultStructuralSharing: true,
});

function handleDeepLinks(urls: string[]) {
	for (const url of urls) {
		try {
			const parsed = new URL(url);
			// tatami://project/{projectId}/revision/{revisionId}
			const pathParts = parsed.pathname.split("/").filter(Boolean);

			if (pathParts[0] === "project" && pathParts[1]) {
				const projectId = pathParts[1];
				const revisionId = pathParts[2] === "revision" ? pathParts[3] : undefined;

				router.navigate({
					to: "/project/$projectId",
					params: { projectId },
					search: revisionId ? { rev: revisionId } : {},
				});
			}
		} catch (_error) {}
	}
}

async function setupDeepLinks(): Promise<void> {
	if (!IS_TAURI) return;

	const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");

	// Handle deep links passed on cold start
	const urls = await getCurrent();
	if (urls) {
		handleDeepLinks(urls);
	}

	// Handle deep links when app is already running
	onOpenUrl(handleDeepLinks);
}

async function setupMenuEvents(): Promise<void> {
	if (!IS_TAURI) return;

	const { listen } = await import("@tauri-apps/api/event");

	// Handle "open-project" menu action from Rust
	listen<string>("open-project", (event) => {
		const projectId = event.payload;
		router.navigate({
			to: "/project/$projectId",
			params: { projectId },
		});
	});
}

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

async function bootstrap(): Promise<void> {
	await setupMocks();
	await setupDeepLinks();
	await setupMenuEvents();

	initializeTheme();

	const root = document.getElementById("root");
	if (root) {
		ReactDOM.createRoot(root).render(
			<React.StrictMode>
				<RegistryProvider>
					<QueryClientProvider client={queryClient}>
						<WorkerPoolContextProvider
							poolOptions={workerPoolOptions}
							highlighterOptions={highlighterOptions}
						>
							<RouterProvider router={router} />
						</WorkerPoolContextProvider>
					</QueryClientProvider>
				</RegistryProvider>
			</React.StrictMode>,
		);
	}
}

bootstrap();
