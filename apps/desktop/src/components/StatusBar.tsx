import { Circle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface StatusBarProps {
	branch: string | null;
	lastRefresh: Date | null;
	isConnected: boolean;
}

export function StatusBar({ branch, lastRefresh, isConnected }: StatusBarProps) {
	const formatRefreshTime = (date: Date | null) => {
		if (!date) return "Never";
		return date.toLocaleTimeString();
	};

	return (
		<div className="flex items-center h-8 px-2 border-t border-border bg-card text-xs text-muted-foreground">
			<SidebarTrigger />
			<div className="flex items-center gap-3 ml-auto">
				{branch && (
					<>
						<div className="flex items-center gap-1.5">
							<span className="font-medium">Closest bookmark:</span>
							<span>{branch}</span>
						</div>
						<Separator orientation="vertical" className="h-4" />
					</>
				)}

				<div className="flex items-center gap-1.5">
					<span className="font-medium">Last refresh:</span>
					<span>{formatRefreshTime(lastRefresh)}</span>
				</div>

				<Separator orientation="vertical" className="h-4" />

				<div className="flex items-center gap-1.5">
					<Circle
						className={`h-2 w-2 fill-current ${isConnected ? "text-green-500" : "text-red-500"}`}
					/>
					<span>{isConnected ? "Connected" : "Disconnected"}</span>
				</div>
			</div>
		</div>
	);
}
