import { RegistryProvider } from "@effect-atom/atom-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import React from "react";
import ReactDOM from "react-dom/client";
import { queryClient } from "./db";
import { routeTree } from "./routeTree.gen";
import "./styles/index.css";

const router = createRouter({
	routeTree,
	defaultPreloadStaleTime: 0,
	scrollRestoration: false,
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

// Handle deep links passed on cold start
getCurrent().then((urls) => {
	if (urls) {
		handleDeepLinks(urls);
	}
});

// Handle deep links when app is already running
onOpenUrl(handleDeepLinks);

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const root = document.getElementById("root");
if (root) {
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<RegistryProvider>
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>
			</RegistryProvider>
		</React.StrictMode>,
	);
}
