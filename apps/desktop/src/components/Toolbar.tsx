interface ToolbarProps {
	repoPath: string | null;
}

export function Toolbar({ repoPath }: ToolbarProps) {
	return (
		<div className="flex items-center h-12 px-2 border-b border-border bg-card">
			<div className="flex-1 text-sm text-muted-foreground truncate">
				{repoPath || "No repository selected"}
			</div>
		</div>
	);
}
