import { ArrowDownUpIcon, CommandIcon, FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface EmptyStateProps {
	onOpenRepo: () => void;
	onOpenShortcutsHelp: () => void;
}

export function EmptyState({ onOpenRepo, onOpenShortcutsHelp }: EmptyStateProps) {
	return (
		<Card className="max-w-md w-full">
			<CardHeader className="text-center">
				<CardTitle>Welcome to Tatami</CardTitle>
				<CardDescription>A desktop client for Jujutsu version control</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex flex-col gap-3">
					<div className="flex items-center gap-3">
						<FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="text-xs">Open a repository to get started</span>
						<Button
							variant="outline"
							size="sm"
							className="ml-auto h-6 text-xs px-2"
							onClick={onOpenRepo}
						>
							Add Repository
						</Button>
					</div>
					<div className="flex items-center gap-3">
						<ArrowDownUpIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="text-xs">Navigate revisions with j/k keys</span>
					</div>
					<button
						type="button"
						className="flex items-center gap-3 rounded-md -mx-2 px-2 py-1 hover:bg-muted/50 transition-colors text-left"
						onClick={onOpenShortcutsHelp}
					>
						<CommandIcon className="size-4 shrink-0 text-muted-foreground" />
						<span className="text-xs">Press ? to view all keyboard shortcuts</span>
					</button>
				</div>
			</CardContent>
		</Card>
	);
}
