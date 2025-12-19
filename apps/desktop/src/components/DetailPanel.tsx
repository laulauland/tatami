import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export function DetailPanel() {
	return (
		<div className="flex flex-col h-full bg-background">
			<div className="p-4 border-b border-border">
				<h2 className="text-sm font-semibold">Detail Panel</h2>
			</div>
			<ScrollArea className="flex-1">
				<div className="p-4 space-y-4">
					<div>
						<h3 className="text-xs font-semibold mb-2 text-muted-foreground">Status</h3>
						<Card className="p-3 text-sm text-muted-foreground">
							Status information will appear here when @ is selected
						</Card>
					</div>

					<Separator />

					<div>
						<h3 className="text-xs font-semibold mb-2 text-muted-foreground">Changed Files</h3>
						<Card className="p-3 text-sm text-muted-foreground">
							List of changed files will appear here
						</Card>
					</div>

					<Separator />

					<div>
						<h3 className="text-xs font-semibold mb-2 text-muted-foreground">File Diff</h3>
						<Card className="p-3 text-sm text-muted-foreground">
							File diff viewer will appear here
						</Card>
					</div>
				</div>
			</ScrollArea>
		</div>
	);
}
