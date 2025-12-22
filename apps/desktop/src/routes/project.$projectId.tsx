import { useLiveQuery } from "@tanstack/react-db";
import { createRoute, Navigate, useParams } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { projectsCollection } from "@/db";
import type { Project } from "@/tauri-commands";
import { Route as rootRoute } from "./__root";

export type ProjectSearchParams = {
	rev?: string;
};

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/project/$projectId",
	validateSearch: (search: Record<string, unknown>): ProjectSearchParams => {
		return {
			rev: typeof search.rev === "string" ? search.rev : undefined,
		};
	},
	component: ProjectComponent,
});

function ProjectComponent() {
	const { projectId } = useParams({ from: Route.id });
	const { data: projects = [] } = useLiveQuery(projectsCollection);

	// Validate that the project exists
	const projectExists = projects.some((p: Project) => p.id === projectId);

	if (!projectExists && projects.length > 0) {
		// Project doesn't exist, redirect to index which will handle navigation
		return <Navigate to="/" />;
	}

	return <AppShell />;
}
