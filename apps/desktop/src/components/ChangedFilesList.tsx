import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ChangedFile } from "@/schemas";

interface ChangedFilesListProps {
	files: ChangedFile[];
	selectedFile: string | null;
	onSelectFile: (path: string) => void;
	isLoading?: boolean;
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
	isSelected,
	onClick,
}: {
	file: ChangedFile;
	isSelected: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer group",
				"hover:bg-muted/50",
				isSelected && "bg-muted text-foreground",
			)}
		>
			<StatusIndicator status={file.status} />
			<span
				className={cn(
					"font-mono text-xs truncate flex-1",
					isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
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

	return (
		<div className="flex flex-col">
			<div className="px-3 py-2 border-b border-border">
				<span className="text-xs font-semibold text-muted-foreground">
					{filesCount} {fileWord} changed
				</span>
			</div>
			<div className="flex flex-col">
				{files.map((file) => (
					<FileListItem
						key={file.path}
						file={file}
						isSelected={selectedFile === file.path}
						onClick={() => onSelectFile(file.path)}
					/>
				))}
			</div>
		</div>
	);
}
