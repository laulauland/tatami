import { useLiveQuery } from "@tanstack/react-db";
import { createRoute, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { projectsCollection } from "@/db";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexComponent,
});

function IndexComponent() {
	const { data: projects = [] } = useLiveQuery(projectsCollection);

	if (projects.length > 0) {
		// Sort by last_opened_at descending to get most recently opened project
		const sortedProjects = [...projects].sort(
			(a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0),
		);
		return <Navigate to="/project/$projectId" params={{ projectId: sortedProjects[0].id }} />;
	}

	return <AppShell />;
}
