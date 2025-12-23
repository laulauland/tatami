import { useAtom } from "@effect-atom/atom-react";
import { X } from "lucide-react";
import { stackViewChangeIdAtom } from "@/atoms";
import { Badge } from "@/components/ui/badge";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";

interface StackIndicatorProps {
	onDismiss?: () => void;
}

export function StackIndicator({ onDismiss }: StackIndicatorProps) {
	const [stackViewChangeId, setStackViewChangeId] = useAtom(stackViewChangeIdAtom);

	function handleDismiss() {
		setStackViewChangeId(null);
		onDismiss?.();
	}

	useKeyboardShortcut({
		key: "Escape",
		onPress: handleDismiss,
		enabled: !!stackViewChangeId,
	});

	if (!stackViewChangeId) return null;

	return (
		<div className="absolute top-2 left-2 z-20">
			<Badge
				variant="secondary"
				className="text-xs cursor-pointer hover:bg-destructive/20 gap-1 pr-1"
				onClick={handleDismiss}
			>
				<span className="font-mono">{stackViewChangeId.slice(0, 8)}</span>
				<X className="h-3 w-3" />
			</Badge>
		</div>
	);
}
