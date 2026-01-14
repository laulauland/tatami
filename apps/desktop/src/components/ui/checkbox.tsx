import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface CheckboxProps extends Omit<CheckboxPrimitive.Root.Props, "render"> {
	/** Show indicator only on hover when unchecked */
	showOnHover?: boolean;
}

function Checkbox({ className, showOnHover = false, ...props }: CheckboxProps) {
	return (
		<CheckboxPrimitive.Root
			className={cn(
				"group/checkbox peer shrink-0 rounded-sm border transition-colors",
				"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"data-[checked]:bg-primary data-[checked]:border-primary data-[checked]:text-primary-foreground",
				"data-[unchecked]:border-transparent data-[unchecked]:hover:border-muted-foreground/40",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				className={cn(
					"flex items-center justify-center text-current transition-opacity size-full",
					showOnHover
						? "opacity-0 group-hover/checkbox:opacity-40 group-data-[checked]/checkbox:opacity-100"
						: "opacity-0 group-data-[checked]/checkbox:opacity-100",
				)}
			>
				<CheckIcon className="size-full" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
