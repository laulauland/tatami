import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "../components/ui/sonner";

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return (
		<>
			<ErrorBoundary>
				<Outlet />
			</ErrorBoundary>
			<Toaster />
		</>
	);
}
