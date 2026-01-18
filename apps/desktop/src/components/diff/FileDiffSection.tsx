import { useAtom } from "@effect-atom/atom-react";
import { PatchDiff } from "@pierre/diffs/react";
import { ChevronDownIcon, ChevronRightIcon, Columns2Icon, RowsIcon } from "lucide-react";
import { type DiffStyle, diffStyleAtom, diffViewStateAtom } from "@/atoms";
import { Button } from "@/components/ui/button";

interface FileDiffSectionProps {
	patch: string;
	filePath: string;
	isSelected?: boolean;
	fileRef?: React.RefObject<HTMLDivElement | null>;
}

export function FileDiffSection({
	patch,
	filePath,
	isSelected = false,
	fileRef,
}: FileDiffSectionProps) {
	const [globalDiffStyle] = useAtom(diffStyleAtom);
	const [diffViewState, setDiffViewState] = useAtom(diffViewStateAtom);

	const isExpanded = diffViewState.expandedFiles.has(filePath);
	const isCollapsed = !isExpanded;
	// Use local override if set, otherwise use global
	const effectiveDiffStyle = diffViewState.styleOverrides.get(filePath) ?? globalDiffStyle;

	function handleToggleCollapse() {
		setDiffViewState((prev) => {
			const next = new Set(prev.expandedFiles);
			if (isCollapsed) {
				next.add(filePath);
			} else {
				next.delete(filePath);
			}
			return { ...prev, expandedFiles: next };
		});
	}

	function handleSetLocalStyle(style: DiffStyle) {
		setDiffViewState((prev) => {
			const next = new Map(prev.styleOverrides);
			next.set(filePath, style);
			return { ...prev, styleOverrides: next };
		});
	}

	return (
		<div
			ref={fileRef}
			className={`border rounded-lg overflow-hidden ${
				isSelected ? "border-accent-foreground border-2" : "border-border"
			}`}
			data-selected={isSelected || undefined}
			data-file-path={filePath}
		>
			<button
				type="button"
				className={`flex items-center gap-2 px-2 py-1.5 border-b cursor-pointer transition-colors w-full text-left ${
					isSelected
						? "bg-accent/30 border-accent-foreground"
						: "bg-muted/30 border-border hover:bg-accent/50"
				}`}
				onClick={handleToggleCollapse}
			>
				{/* Collapse toggle - left side */}
				<span className="text-muted-foreground shrink-0">
					{isCollapsed ? (
						<ChevronRightIcon className="size-4" />
					) : (
						<ChevronDownIcon className="size-4" />
					)}
				</span>
				<code className="font-mono text-xs text-foreground text-left flex-1 truncate min-w-0">
					{filePath}
				</code>

				{/* Per-file diff style toggle buttons */}
				<span className="flex items-center gap-0.5">
					<Button
						variant={effectiveDiffStyle === "unified" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={(e) => {
							e.stopPropagation();
							handleSetLocalStyle("unified");
						}}
						title="Unified diff"
						className="h-6 w-6"
					>
						<RowsIcon className="size-3" />
					</Button>
					<Button
						variant={effectiveDiffStyle === "split" ? "secondary" : "ghost"}
						size="icon-xs"
						onClick={(e) => {
							e.stopPropagation();
							handleSetLocalStyle("split");
						}}
						title="Split diff"
						className="h-6 w-6"
					>
						<Columns2Icon className="size-3" />
					</Button>
				</span>
			</button>
			{!isCollapsed && (
				<div>
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
				</div>
			)}
		</div>
	);
}
