import { useQuery } from "@tanstack/react-query";
import type { ChangedFileStatus } from "@/schemas";
import { getFileContentBase64 } from "@/tauri-commands";
import { getMimeType } from "@/utils/file-types";

interface ImageDiffProps {
	repoPath: string;
	changeId: string;
	filePath: string;
	status: ChangedFileStatus;
}

async function loadImageSrc(
	repoPath: string,
	changeId: string,
	filePath: string,
	version: "current" | "parent",
): Promise<string> {
	const mimeType = getMimeType(filePath);
	const result = await getFileContentBase64(repoPath, changeId, filePath, version);
	return `data:${mimeType};base64,${result.base64}`;
}

export function ImageDiff({ repoPath, changeId, filePath, status }: ImageDiffProps) {
	// Fetch current image (skip if deleted)
	const {
		data: currentSrc,
		isLoading: currentLoading,
		error: currentError,
	} = useQuery({
		queryKey: ["image", repoPath, changeId, filePath, "current"],
		queryFn: () => loadImageSrc(repoPath, changeId, filePath, "current"),
		enabled: status !== "deleted",
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	// Fetch parent image (skip if added)
	const {
		data: parentSrc,
		isLoading: parentLoading,
		error: parentError,
	} = useQuery({
		queryKey: ["image", repoPath, changeId, filePath, "parent"],
		queryFn: () => loadImageSrc(repoPath, changeId, filePath, "parent"),
		enabled: status !== "added",
		staleTime: 5 * 60 * 1000, // 5 minutes
	});

	const loading = (status !== "deleted" && currentLoading) || (status !== "added" && parentLoading);
	const error = currentError || parentError;

	if (loading) {
		return <div className="p-4 text-muted-foreground">Loading image...</div>;
	}

	if (error) {
		return (
			<div className="p-4 text-destructive">
				Error: {error instanceof Error ? error.message : "Failed to load image"}
			</div>
		);
	}

	if (status === "added" && currentSrc) {
		return (
			<div className="p-4">
				<div className="inline-block border-2 border-green-500 rounded overflow-hidden">
					<img src={currentSrc} alt={filePath} className="max-w-full max-h-96 object-contain" />
				</div>
				<div className="text-xs text-green-600 mt-2">Added</div>
			</div>
		);
	}

	if (status === "deleted" && parentSrc) {
		return (
			<div className="p-4">
				<div className="inline-block border-2 border-red-500 rounded overflow-hidden opacity-50">
					<img src={parentSrc} alt={filePath} className="max-w-full max-h-96 object-contain" />
				</div>
				<div className="text-xs text-red-600 mt-2">Deleted</div>
			</div>
		);
	}

	// Modified: side-by-side (only render if both images are loaded)
	if (parentSrc && currentSrc) {
		return (
			<div className="p-4 flex gap-4">
				<div className="flex-1">
					<div className="text-xs text-muted-foreground mb-2">Before</div>
					<div className="inline-block border border-red-500/50 rounded overflow-hidden">
						<img
							src={parentSrc}
							alt={`${filePath} (before)`}
							className="max-w-full max-h-80 object-contain"
						/>
					</div>
				</div>
				<div className="flex-1">
					<div className="text-xs text-muted-foreground mb-2">After</div>
					<div className="inline-block border border-green-500/50 rounded overflow-hidden">
						<img
							src={currentSrc}
							alt={`${filePath} (after)`}
							className="max-w-full max-h-80 object-contain"
						/>
					</div>
				</div>
			</div>
		);
	}

	// Fallback for unexpected state
	return <div className="p-4 text-muted-foreground">Unable to load image</div>;
}
