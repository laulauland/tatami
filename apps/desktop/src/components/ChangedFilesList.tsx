import { CheckIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ChangedFile } from "@/schemas";

interface ChangedFilesListProps {
	files: ChangedFile[];
	selectedFile: string | null;
	onSelectFile: (path: string) => void;
	isLoading?: boolean;
	/** Set of file paths that are "selected" (checked) */
	selectedFiles?: Set<string>;
	/** Called when a file's selection state changes */
	onToggleFileSelection?: (path: string) => void;
	/** Whether to show selection checkboxes */
	showSelection?: boolean;
}

function StatusIndicator({ status }: { status: ChangedFile["status"] }) {
	const statusConfig = {
		added: {
			label: "A",
			className: "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/40",
		},
		modified: {
			label: "M",
			className: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/40",
		},
		deleted: {
			label: "D",
			className: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/40",
		},
	};

	const config = statusConfig[status];

	return (
		<span
			className={cn(
				"flex items-center justify-center w-4 h-4 text-[10px] font-semibold border rounded-none shrink-0",
				config.className,
			)}
		>
			{config.label}
		</span>
	);
}

function FileListItem({
	file,
	isFocused,
	isChecked,
	onClick,
	onToggleSelection,
	showSelection,
}: {
	file: ChangedFile;
	isFocused: boolean;
	isChecked: boolean;
	onClick: () => void;
	onToggleSelection?: () => void;
	showSelection?: boolean;
}) {
	return (
		<button
			type="button"
			className={cn(
				"flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer group w-full",
				isFocused ? "bg-muted text-foreground" : "hover:bg-muted/50",
			)}
			data-focused={isFocused || undefined}
			data-checked={isChecked || undefined}
			data-file-path={file.path}
			onClick={onClick}
		>
			{showSelection && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onToggleSelection?.();
					}}
					className={cn(
						"flex items-center justify-center w-4 h-4 border rounded-sm shrink-0 transition-colors",
						isChecked
							? "bg-primary border-primary text-primary-foreground"
							: "border-muted-foreground/40 hover:border-muted-foreground",
					)}
					title={isChecked ? "Deselect file" : "Select file"}
				>
					{isChecked && <CheckIcon className="size-3" />}
				</button>
			)}
			<StatusIndicator status={file.status} />
			<span
				className={cn(
					"font-mono text-xs truncate flex-1",
					isFocused ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
				)}
				title={file.path}
			>
				{file.path}
			</span>
		</button>
	);
}

function LoadingSkeleton() {
	return (
		<div className="space-y-1 px-3 py-2">
			{Array.from({ length: 3 }).map((_, index) => (
				<div key={index} className="flex items-center gap-2">
					<Skeleton className="w-4 h-4" />
					<Skeleton className="h-3 flex-1" />
				</div>
			))}
		</div>
	);
}

function EmptyState() {
	return (
		<div className="px-3 py-8 text-center text-sm text-muted-foreground">No files changed</div>
	);
}

export function ChangedFilesList({
	files,
	selectedFile,
	onSelectFile,
	isLoading = false,
	selectedFiles,
	onToggleFileSelection,
	showSelection = false,
}: ChangedFilesListProps) {
	if (isLoading) {
		return (
			<div className="flex flex-col">
				<div className="px-3 py-2 border-b border-border">
					<Skeleton className="h-4 w-24" />
				</div>
				<LoadingSkeleton />
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div className="flex flex-col">
				<div className="px-3 py-2 border-b border-border">
					<span className="text-xs font-semibold text-muted-foreground">0 files changed</span>
				</div>
				<EmptyState />
			</div>
		);
	}

	const filesCount = files.length;
	const fileWord = filesCount === 1 ? "file" : "files";
	const selectedCount = selectedFiles?.size ?? 0;

	return (
		<div>
			<div className="px-3 py-2 border-b border-border flex items-center justify-between">
				<span className="text-xs font-semibold text-muted-foreground">
					{filesCount} {fileWord} changed
				</span>
				{showSelection && selectedCount > 0 && (
					<span className="text-xs text-primary font-medium">{selectedCount} selected</span>
				)}
			</div>
			<div>
				{files.map((file) => (
					<FileListItem
						key={file.path}
						file={file}
						isFocused={selectedFile === file.path}
						isChecked={selectedFiles?.has(file.path) ?? false}
						onClick={() => onSelectFile(file.path)}
						onToggleSelection={
							onToggleFileSelection ? () => onToggleFileSelection(file.path) : undefined
						}
						showSelection={showSelection}
					/>
				))}
			</div>
		</div>
	);
}
