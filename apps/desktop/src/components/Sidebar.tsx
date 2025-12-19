import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";

export function Sidebar() {
	return (
		<div className="flex flex-col h-full bg-card">
			<div className="p-4 border-b border-border">
				<h2 className="text-sm font-semibold">Log View</h2>
			</div>
			<ScrollArea className="flex-1">
				<div className="p-4 space-y-2">
					<Card className="p-3 text-sm text-muted-foreground">
						Log view will be implemented here
					</Card>
					<Card className="p-3 text-sm text-muted-foreground">
						Showing commit history, revisions, etc.
					</Card>
				</div>
			</ScrollArea>
		</div>
	);
}
