import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

function Toaster({ ...props }: ToasterProps) {
	return (
		<Sonner
			className="toaster group font-sans"
			position="bottom-right"
			gap={8}
			toastOptions={{
				classNames: {
					toast:
						"group toast group-[.toaster]:bg-popover/80 group-[.toaster]:backdrop-blur-xl group-[.toaster]:text-popover-foreground group-[.toaster]:border group-[.toaster]:border-border/50 group-[.toaster]:shadow-lg group-[.toaster]:rounded-[10px] group-[.toaster]:text-sm group-[.toaster]:px-3 group-[.toaster]:py-2.5",
					title: "group-[.toast]:font-medium group-[.toast]:text-[13px]",
					description: "group-[.toast]:text-muted-foreground group-[.toast]:text-[12px]",
					actionButton:
						"group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:text-xs group-[.toast]:font-medium group-[.toast]:rounded-md",
					cancelButton:
						"group-[.toast]:bg-muted group-[.toast]:text-muted-foreground group-[.toast]:text-xs group-[.toast]:rounded-md",
					success: "group-[.toaster]:border-primary/30 [&_[data-icon]]:text-primary",
					error: "group-[.toaster]:border-destructive/40 [&_[data-icon]]:text-destructive",
					warning: "group-[.toaster]:border-chart-3/40 [&_[data-icon]]:text-chart-3",
					info: "group-[.toaster]:border-primary/30 [&_[data-icon]]:text-primary",
				},
			}}
			{...props}
		/>
	);
}

export { Toaster, toast };
