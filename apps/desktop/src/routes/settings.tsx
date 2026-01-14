import { createRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
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
		<div className="flex flex-col h-screen bg-background">
			{/* Header */}
			<div className="flex items-center gap-3 px-6 py-4 border-b border-border">
				<button
					type="button"
					onClick={() => navigate({ to: "/" })}
					className="p-2 -ml-2 rounded-lg hover:bg-accent/50 transition-colors"
				>
					<ArrowLeft className="w-5 h-5" />
				</button>
				<h1 className="text-lg font-medium">Settings</h1>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-auto p-6">
				<div className="max-w-2xl space-y-8">
					<div className="text-muted-foreground text-sm">Settings coming soon...</div>
				</div>
			</div>
		</div>
	);
}
