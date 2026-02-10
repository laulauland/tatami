import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { createRoute, Navigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { repositoriesCollection } from "@/db";
import { getLayout } from "@/tauri-commands";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexComponent,
});

function IndexComponent() {
	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);
	const { data: layout, isPending: isLayoutPending } = useQuery({
		queryKey: ["app-layout"],
		queryFn: getLayout,
		staleTime: Number.POSITIVE_INFINITY,
		enabled: repositories.length > 0,
	});

	if (repositories.length > 0) {
		if (isLayoutPending) {
			return null;
		}

		// Sort by last_opened_at descending to get most recently opened repository
		const sortedRepositories = [...repositories].sort(
			(a, b) => (b.last_opened_at ?? 0) - (a.last_opened_at ?? 0),
		);

		const persistedRepository = layout?.active_project_id
			? repositories.find((repository) => repository.id === layout.active_project_id)
			: null;

		const targetRepository = persistedRepository ?? sortedRepositories[0];

		return <Navigate to="/project/$projectId" params={{ projectId: targetRepository.id }} />;
	}

	return <AppShell />;
}
