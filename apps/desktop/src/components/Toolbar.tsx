import { useAtom } from "@effect-atom/atom-react";
import { useRef } from "react";
import { stackViewChangeIdAtom } from "@/atoms";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";

const PRESET_REVSETS: Record<string, string> = {
	// Current stack: trunk to working copy
	stack: "trunk()..@ | trunk()",
	// Stack + my other mutable work + recent context
	active:
		"trunk()..@ | trunk() | (mine() & mutable() & ~::@) | (heads(mutable()) & ~::@) | ancestors(immutable_heads().., 2)",
	// Everything (debug/power user)
	full_history: "ancestors(visible_heads())",
};

interface ToolbarProps {
	repoPath: string | null;
	currentPreset?: string;
	onPresetChange?: (preset: string) => void;
}

export function Toolbar({ repoPath, currentPreset = "stack", onPresetChange }: ToolbarProps) {
	const [stackViewChangeId, setStackViewChangeId] = useAtom(stackViewChangeIdAtom);
	const revsetExpression = PRESET_REVSETS[currentPreset] ?? currentPreset;
	const selectTriggerRef = useRef<HTMLButtonElement>(null);

	useKeyboardShortcut({
		key: "L",
		onPress: () => selectTriggerRef.current?.click(),
		enabled: !!repoPath && !!onPresetChange,
	});

	return (
		<div className="flex items-center h-10 px-2 border-b border-border bg-card gap-3">
			<div className="text-xs text-muted-foreground truncate shrink-0">
				{repoPath || "No repository selected"}
			</div>
			{repoPath && onPresetChange && (
				<>
					<div className="h-4 w-px bg-border" />
					{stackViewChangeId ? (
						<Badge
							variant="secondary"
							className="text-xs cursor-pointer hover:bg-destructive/20"
							onClick={() => setStackViewChangeId(null)}
						>
							Stack: {stackViewChangeId.slice(0, 8)} ✕
						</Badge>
					) : (
						<Select value={currentPreset} onValueChange={(v) => v && onPresetChange(v)}>
							<SelectTrigger ref={selectTriggerRef} size="sm" className="w-[110px] h-6 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="stack">Stack</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="full_history">Full history</SelectItem>
							</SelectContent>
						</Select>
					)}
					<code className="text-[10px] text-muted-foreground/60 font-mono truncate">
						{stackViewChangeId
							? `::${stackViewChangeId.slice(0, 8)} ~ ::trunk()`
							: revsetExpression}
					</code>
				</>
			)}
		</div>
	);
}
