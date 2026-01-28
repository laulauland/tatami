import { useAtom } from "@effect-atom/atom-react";
import { PatchDiff } from "@pierre/diffs/react";
import { diffStyleAtom, diffViewStateAtom } from "@/atoms";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SingleFileDiffProps {
	patch: string | null;
	filePath: string | null;
}

export function SingleFileDiff({ patch, filePath }: SingleFileDiffProps) {
	const [globalDiffStyle] = useAtom(diffStyleAtom);
	const [diffViewState] = useAtom(diffViewStateAtom);

	// Use local override if set, otherwise use global
	const effectiveDiffStyle = filePath
		? (diffViewState.styleOverrides.get(filePath) ?? globalDiffStyle)
		: globalDiffStyle;

	// Empty state
	if (!filePath || patch === null) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground text-sm">
				Select a file to view its diff
			</div>
		);
	}

	return (
		<ScrollArea className="h-full w-full">
			{!patch.trim() ? (
				<div className="px-4 py-8 text-center text-muted-foreground text-sm">
					No changes in this file
				</div>
			) : (
				<PatchDiff
					patch={patch}
					options={{ hunkSeparators: "line-info", diffStyle: effectiveDiffStyle }}
				/>
			)}
		</ScrollArea>
	);
}
