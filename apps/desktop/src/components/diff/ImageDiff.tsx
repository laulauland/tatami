import { useEffect, useState } from "react";
import type { ChangedFileStatus } from "@/schemas";
import { getFileContentBase64 } from "@/tauri-commands";
import { getMimeType } from "@/utils/file-types";

interface ImageDiffProps {
	repoPath: string;
	changeId: string;
	filePath: string;
	status: ChangedFileStatus;
}

export function ImageDiff({ repoPath, changeId, filePath, status }: ImageDiffProps) {
	const [currentSrc, setCurrentSrc] = useState<string | null>(null);
	const [parentSrc, setParentSrc] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		async function loadImages() {
			setLoading(true);
			setError(null);
			const mimeType = getMimeType(filePath);

			try {
				if (status !== "deleted") {
					const result = await getFileContentBase64(repoPath, changeId, filePath, "current");
					setCurrentSrc(`data:${mimeType};base64,${result.base64}`);
				}
				if (status !== "added") {
					const result = await getFileContentBase64(repoPath, changeId, filePath, "parent");
					setParentSrc(`data:${mimeType};base64,${result.base64}`);
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : "Failed to load image");
			}
			setLoading(false);
		}
		loadImages();
	}, [repoPath, changeId, filePath, status]);

	if (loading) {
		return <div className="p-4 text-muted-foreground">Loading image...</div>;
	}

	if (error) {
		return <div className="p-4 text-destructive">Error: {error}</div>;
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
