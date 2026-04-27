import { useLiveQuery } from "@tanstack/react-db";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
	emptyOperationsCollection,
	getOperationsCollection,
	invalidateRepositoryQueries,
} from "@/db";
import type { Operation } from "@/tauri-commands";
import { undoOperation } from "@/tauri-commands";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";

interface OperationsLogProps {
	repoPath: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function formatTimestamp(timestamp: string): string {
	const parsed = new Date(timestamp);
	if (Number.isNaN(parsed.getTime())) {
		return timestamp;
	}
	return parsed.toLocaleString();
}

function getUndoHint(errorMessage: string): string {
	const lower = errorMessage.toLowerCase();

	if (lower.includes("root") || lower.includes("initial")) {
		return "The initial/root operation cannot be undone.";
	}

	if (
		lower.includes("descendant") ||
		lower.includes("head") ||
		lower.includes("newer") ||
		lower.includes("conflict")
	) {
		return "Undo a newer operation first, then retry.";
	}

	return "Check the operation order and try again.";
}

function operationTimestampMillis(operation: Operation): number {
	const millis = new Date(operation.timestamp).getTime();
	return Number.isNaN(millis) ? 0 : millis;
}

export function OperationsLog({ repoPath, open, onOpenChange }: OperationsLogProps) {
	const [undoingOperationId, setUndoingOperationId] = useState<string | null>(null);

	const operationsCollection =
		repoPath && open ? getOperationsCollection(repoPath) : emptyOperationsCollection;
	const {
		data: operations = [],
		isLoading,
		isError,
		collection,
	} = useLiveQuery(operationsCollection);
	const isFetching = isLoading;

	const sortedOperations = useMemo(() => {
		const copy = [...operations];
		copy.sort((left, right) => operationTimestampMillis(right) - operationTimestampMillis(left));
		return copy;
	}, [operations]);

	async function handleUndo(operation: Operation) {
		if (!repoPath || undoingOperationId) return;

		setUndoingOperationId(operation.id);
		try {
			await undoOperation(repoPath, operation.id);
			await invalidateRepositoryQueries(repoPath);
			toast.success(`Undid operation ${operation.id.slice(0, 8)}`);
			void collection.preload();
		} catch (undoError) {
			const message = undoError instanceof Error ? undoError.message : String(undoError);
			const hint = getUndoHint(message);
			toast.error("Failed to undo operation", {
				description: `${message} ${hint}`,
				duration: Number.POSITIVE_INFINITY,
			});
		} finally {
			setUndoingOperationId(null);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<div className="flex items-center justify-between gap-3">
						<DialogTitle>Operations log</DialogTitle>
						<Button
							variant="ghost"
							size="xs"
							onClick={() => {
								void collection.preload();
							}}
							disabled={!repoPath || isFetching}
						>
							<RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
							Refresh
						</Button>
					</div>
				</DialogHeader>
				<div className="max-h-[420px] overflow-y-auto rounded-sm border border-border">
					{!repoPath ? (
						<p className="p-3 text-xs text-muted-foreground">Select a repository first.</p>
					) : isLoading ? (
						<p className="p-3 text-xs text-muted-foreground">Loading operations...</p>
					) : isError ? (
						<p className="p-3 text-xs text-destructive">Failed to load operations.</p>
					) : sortedOperations.length === 0 ? (
						<p className="p-3 text-xs text-muted-foreground">No operations found.</p>
					) : (
						<ul className="divide-y divide-border">
							{sortedOperations.map((operation) => {
								const isUndoingThis = undoingOperationId === operation.id;
								const isUndoingAny = undoingOperationId !== null;
								return (
									<li key={operation.id} className="p-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="text-xs font-medium leading-5">
													{operation.description || "(no description)"}
												</p>
												<p className="mt-1 text-[11px] text-muted-foreground">
													{formatTimestamp(operation.timestamp)} • {operation.user}@
													{operation.hostname}
												</p>
											</div>
											<div className="flex items-center gap-2 shrink-0">
												<code className="text-[10px] text-muted-foreground">
													{operation.id.slice(0, 8)}
												</code>
												<Button
													variant="outline"
													size="xs"
													onClick={() => {
														void handleUndo(operation);
													}}
													disabled={isUndoingAny}
												>
													{isUndoingThis ? "Undoing..." : "Undo"}
												</Button>
											</div>
										</div>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
