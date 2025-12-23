import { createRoute, useNavigate } from "@tanstack/react-router";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
});

function SettingsPage() {
	const navigate = useNavigate();

	useKeyboardShortcut({
		key: "Escape",
		onPress: () => navigate({ to: "/" }),
	});

	return (
		<div className="flex flex-col h-screen p-6">
			<h1 className="text-lg font-medium mb-4">Settings</h1>
			<p className="text-muted-foreground text-sm">
				Settings will be available in a future update.
			</p>
		</div>
	);
}
