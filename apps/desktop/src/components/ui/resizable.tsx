import type * as React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

type PanelDirection = "horizontal" | "vertical";

type ResizablePanelGroupProps = React.ComponentProps<typeof Group> & {
	/**
	 * Optional alias for callers that use `direction` naming.
	 */
	direction?: PanelDirection;
};

function ResizablePanelGroup({
	className,
	orientation,
	direction,
	...props
}: ResizablePanelGroupProps) {
	return (
		<Group
			data-slot="resizable-panel-group"
			orientation={orientation ?? direction ?? "horizontal"}
			className={cn("flex h-full w-full data-[panel-group-direction=vertical]:flex-col", className)}
			{...props}
		/>
	);
}

function ResizablePanel({ ...props }: React.ComponentProps<typeof Panel>) {
	return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
	withHandle,
	orientation = "horizontal",
	className,
	...props
}: React.ComponentProps<typeof Separator> & {
	withHandle?: boolean;
	orientation?: "horizontal" | "vertical";
}) {
	const isVertical = orientation === "vertical";
	return (
		<Separator
			data-slot="resizable-handle"
			className={cn(
				"focus-visible:ring-ring relative flex items-center justify-center shrink-0 transition-colors focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden",
				isVertical
					? "h-2 w-full bg-border/50 hover:bg-border cursor-row-resize"
					: "w-px h-full bg-border/50 hover:bg-border cursor-col-resize",
				className,
			)}
			{...props}
		>
			{withHandle && (
				<div
					className={cn(
						"z-10 flex shrink-0 transition-colors",
						isVertical
							? "h-1.5 w-12 bg-border hover:bg-muted-foreground/60 rounded-full"
							: "h-6 w-1 bg-border/60 hover:bg-border rounded-none",
					)}
				/>
			)}
		</Separator>
	);
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
