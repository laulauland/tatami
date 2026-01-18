import { useAtom } from "@effect-atom/atom-react";
import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Route } from "@/routes/project.$projectId";
import { focusPanelAtom, viewModeAtom } from "@/atoms";
import { ChangedFilesList } from "@/components/ChangedFilesList";
import { emptyChangesCollection, getRevisionChangesCollection } from "@/db";
import type { Revision } from "@/tauri-commands";
import { ROW_HEIGHT, LANE_PADDING, LANE_WIDTH, NODE_RADIUS, laneToX, laneColor } from "./constants";
import { GraphNode } from "./GraphNode";

interface RevisionRowProps {
	revision: Revision;
	lane: number;
	maxLaneOnRow: number;
	isSelected: boolean;
	isChecked: boolean;
	onSelect: (changeId: string, modifiers: { shift: boolean; meta: boolean }) => void;
	isFlashing: boolean;
	isDimmed: boolean;
	isExpanded: boolean;
	isFocused: boolean;
	repoPath: string | null;
	isPendingAbandon: boolean;
	jumpModeActive: boolean;
	jumpQuery: string;
	jumpHint: string | null;
}

/**
 * RevisionRow - Renders a single revision in the graph
 * Includes graph node, revision metadata, branches, and expandable file list
 */
export function RevisionRow({
	revision,
	lane,
	maxLaneOnRow,
	isSelected,
	isChecked,
	onSelect,
	isFlashing,
	isDimmed,
	isExpanded,
	isFocused,
	repoPath,
	isPendingAbandon,
	jumpModeActive,
	jumpQuery,
	jumpHint,
}: RevisionRowProps) {
	const firstLine = revision.description.split("\n")[0] || "(no description)";
	const fullDescription = revision.description || "(no description)";

	// Calculate the node position area - leaves space for graph edges on the left
	const nodeAreaWidth = LANE_PADDING + (maxLaneOnRow + 1) * LANE_WIDTH;
	const nodeOffset = laneToX(lane);
	const color = laneColor(lane);

	const selectedFile = useSearch({ from: Route.fullPath, select: (s) => s.file ?? null });
	const search = useSearch({ from: Route.fullPath });
	const navigate = useNavigate({ from: Route.fullPath });
	const [viewMode, setViewMode] = useAtom(viewModeAtom);
	const [, setFocusPanel] = useAtom(focusPanelAtom);

	const changedFilesCollection =
		isExpanded && repoPath
			? getRevisionChangesCollection(repoPath, revision.change_id)
			: emptyChangesCollection;
	const changedFilesQuery = useLiveQuery(changedFilesCollection);

	function handleSelectFile(filePath: string) {
		// If in overview mode, switch to split mode and focus diff panel
		if (viewMode === 1) {
			setViewMode(2);
			setFocusPanel("diff");
		}
		// Clear expanded state and navigate to file
		navigate({
			search: { ...search, file: filePath, expanded: undefined },
		});
	}

	// Constants matching edge layer calculations
	const TOP_PADDING = 16;
	const CONTENT_MIN_HEIGHT = 56;
	const nodeSize = revision.is_working_copy ? NODE_RADIUS * 2 + 14 : NODE_RADIUS * 2 + 8;

	return (
		<div style={{ height: isExpanded ? "auto" : ROW_HEIGHT }} className="flex flex-col relative">
			{/* Graph node - absolutely positioned to align with edge layer */}
			<div
				className="absolute z-20 flex items-center justify-center"
				style={{
					left: nodeOffset - nodeSize / 2,
					top: TOP_PADDING + CONTENT_MIN_HEIGHT / 2 - nodeSize / 2,
				}}
			>
				<GraphNode revision={revision} lane={lane} isSelected={isSelected} color={color} />
			</div>
			<div className="flex items-start min-h-[56px] pt-4">
				{/* Spacer for graph area */}
				<div className="shrink-0" style={{ width: nodeAreaWidth }} />
				{/* biome-ignore lint/a11y/useSemanticElements: Complex styling requires div */}
				<div
					role="button"
					tabIndex={0}
					className={`relative flex-1 mr-2 min-w-0 overflow-hidden rounded my-2 mx-1 select-none border ${
						isFocused || isChecked
							? "bg-accent/40 border-accent/60 hover:bg-accent/50"
							: "bg-card hover:bg-muted border-border"
					} text-card-foreground shadow-sm hover:shadow hover:cursor-pointer ${
						revision.is_immutable ? "opacity-60" : ""
					} ${isDimmed ? "opacity-40" : ""}`}
					data-focused={isFocused || undefined}
					data-selected={isSelected || undefined}
					data-checked={isChecked || undefined}
					data-expanded={isExpanded || undefined}
					data-change-id={revision.change_id}
					onClick={(e) => {
						// Prevent text selection on shift+click
						if (e.shiftKey) {
							e.preventDefault();
							window.getSelection()?.removeAllRanges();
						}
						onSelect(revision.change_id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							onSelect(revision.change_id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
						}
					}}
				>
					<div className={`px-3 py-2 min-w-0 ${isPendingAbandon ? "blur-sm" : ""}`}>
						<div className="flex items-center gap-2 flex-nowrap min-w-0">
							<code
								className={`text-xs font-mono rounded px-0.5 shrink-0 ${
									isFlashing ? "bg-primary/40 animate-pulse" : ""
								} text-muted-foreground`}
							>
								{jumpModeActive && jumpHint ? (
									<>
										{/* Already matched portion */}
										{jumpQuery && (
											<span className="bg-primary/30 text-primary font-semibold">
												{revision.change_id_short.slice(0, jumpQuery.length)}
											</span>
										)}
										{/* Next character to type (the hint) */}
										<span className="bg-primary text-primary-foreground font-semibold rounded-sm">
											{revision.change_id_short[jumpQuery.length]}
										</span>
										{/* Rest of the ID */}
										<span>{revision.change_id_short.slice(jumpQuery.length + 1)}</span>
									</>
								) : (
									revision.change_id_short
								)}
							</code>
							{revision.bookmarks.length > 0 && (
								<span
									className="text-xs text-primary font-medium truncate min-w-0 whitespace-nowrap"
									title={revision.bookmarks.join(", ")}
								>
									{revision.bookmarks.join(", ")}
								</span>
							)}
							<span className="text-xs text-muted-foreground truncate min-w-0 shrink-0">
								{revision.author.split("@")[0]} · {revision.timestamp}
							</span>
						</div>
						<div className={`text-sm mt-1 ${isExpanded ? "" : "truncate"}`}>{firstLine}</div>
					</div>
					{isExpanded && (
						<div className={`px-3 pb-3 pt-0 space-y-3 ${isPendingAbandon ? "blur-sm" : ""}`}>
							<pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono bg-muted/40 border border-border/60 rounded p-2">
								{fullDescription}
							</pre>
							<div className="border border-border rounded-lg overflow-hidden bg-background">
								<ChangedFilesList
									files={changedFilesQuery.data ?? []}
									selectedFile={selectedFile}
									onSelectFile={handleSelectFile}
									isLoading={changedFilesQuery.isLoading}
								/>
							</div>
						</div>
					)}
					{isPendingAbandon && (
						<div className="absolute inset-0 flex items-center justify-center bg-destructive/10 rounded">
							<div className="text-sm font-medium text-destructive-foreground bg-destructive/90 px-3 py-1.5 rounded">
								Abandon this revision? <kbd className="ml-1 px-1 bg-background/20 rounded">Y</kbd> /{" "}
								<kbd className="px-1 bg-background/20 rounded">N</kbd>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
