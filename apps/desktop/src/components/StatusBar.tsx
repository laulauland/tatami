import { useAtom } from "@effect-atom/atom-react";
import { Circle, Laptop, Moon, Sun } from "lucide-react";
import { shortcutsHelpOpenAtom } from "@/atoms";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useTheme } from "@/hooks/useTheme";

interface StatusBarProps {
	branch: string | null;
	isConnected: boolean;
	hasConflict: boolean;
}

export function StatusBar({ branch, isConnected, hasConflict }: StatusBarProps) {
	const { theme, cycleTheme } = useTheme();
	const ThemeIcon = theme === "system" ? Laptop : theme === "dark" ? Moon : Sun;
	const [, setShortcutsOpen] = useAtom(shortcutsHelpOpenAtom);

	return (
		<div className="flex items-center h-8 px-2 border-t border-border bg-card text-xs text-muted-foreground">
			<Button
				variant="ghost"
				size="icon-xs"
				onClick={cycleTheme}
				className="h-6 w-6"
				aria-label="Toggle theme"
			>
				<ThemeIcon className="h-3.5 w-3.5" />
			</Button>
			<Separator orientation="vertical" className="h-4 mx-1" />
			<Button
				variant="ghost"
				size="icon-xs"
				onClick={() => setShortcutsOpen(true)}
				className="h-6 w-6 text-muted-foreground/70 hover:text-foreground font-mono text-[10px] font-bold"
				aria-label="Keyboard shortcuts help"
			>
				?
			</Button>
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

				{hasConflict && (
					<>
						<div className="flex items-center gap-1.5 text-destructive">
							<Circle className="h-2 w-2 fill-current" />
							<span>Conflicts</span>
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
