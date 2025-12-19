import { createRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexComponent,
});

function IndexComponent() {
	return <AppShell />;
}
