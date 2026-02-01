import { createRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { isTraceEnabled, setTraceEnabled } from "@/lib/trace";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
});

function SettingsPage() {
	const navigate = useNavigate();
	const [traceEnabled, setTraceEnabledState] = useState(isTraceEnabled);

	useKeyboardShortcut({
		key: "Escape",
		onPress: () => navigate({ to: "/" }),
	});

	const handleTraceToggle = (checked: boolean) => {
		setTraceEnabled(checked);
		setTraceEnabledState(checked);
	};

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
					{/* Developer section */}
					<section>
						<h2 className="text-sm font-medium text-muted-foreground mb-4">Developer</h2>
						<div className="space-y-4">
							<label className="flex items-center gap-3 cursor-pointer">
								<Checkbox
									checked={traceEnabled}
									onCheckedChange={handleTraceToggle}
									className="size-4"
								/>
								<div className="space-y-0.5">
									<Label className="cursor-pointer">Performance tracing</Label>
									<p className="text-sm text-muted-foreground">
										Log timing info to console for debugging
									</p>
								</div>
							</label>
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}
