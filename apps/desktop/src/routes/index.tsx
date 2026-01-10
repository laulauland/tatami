import { useLiveQuery } from "@tanstack/react-db";
import { createRoute, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { repositoriesCollection } from "@/db";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexComponent,
});

function IndexComponent() {
	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);

	if (repositories.length > 0) {
		// Sort by last_opened_at descending to get most recently opened repository
		const sortedRepositories = [...repositories].sort(
			(a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0),
		);
		return <Navigate to="/project/$projectId" params={{ projectId: sortedRepositories[0].id }} />;
	}

	return <AppShell />;
}
