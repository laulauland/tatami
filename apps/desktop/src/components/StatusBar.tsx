import { Circle } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface StatusBarProps {
	branch: string | null;
	isConnected: boolean;
}

export function StatusBar({ branch, isConnected }: StatusBarProps) {
	return (
		<div className="flex items-center h-8 px-2 border-t border-border bg-card text-xs text-muted-foreground">
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
					<Circle
						className={`h-2 w-2 fill-current ${isConnected ? "text-green-500" : "text-red-500"}`}
					/>
					<span>{isConnected ? "Connected" : "Disconnected"}</span>
				</div>
			</div>
		</div>
	);
}
