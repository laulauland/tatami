import { useLiveQuery } from "@tanstack/react-db";
import { createRoute, Navigate, useParams } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { repositoriesCollection } from "@/db";
import type { Repository } from "@/tauri-commands";
import { Route as rootRoute } from "./__root";

export type ProjectSearchParams = {
	rev?: string;
	file?: string;
	expanded?: boolean;
	stack?: string; // Focused collapsed stack id
	selected?: string; // Comma-separated list of selected revision changeIds
	selectionAnchor?: string; // changeId where shift-selection started
};

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/project/$projectId",
	validateSearch: (search: Record<string, unknown>): ProjectSearchParams => {
		return {
			rev: typeof search.rev === "string" ? search.rev : undefined,
			file: typeof search.file === "string" ? search.file : undefined,
			expanded: search.expanded === true || search.expanded === "true",
			stack: typeof search.stack === "string" ? search.stack : undefined,
			selected: typeof search.selected === "string" ? search.selected : undefined,
			selectionAnchor:
				typeof search.selectionAnchor === "string" ? search.selectionAnchor : undefined,
		};
	},
	component: ProjectComponent,
});

function ProjectComponent() {
	const { projectId } = useParams({ from: Route.id });
	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);

	// Validate that the repository exists
	const repositoryExists = repositories.some((p: Repository) => p.id === projectId);

	if (!repositoryExists && repositories.length > 0) {
		// Repository doesn't exist, redirect to index which will handle navigation
		return <Navigate to="/" />;
	}

	return <AppShell />;
}
