import { useLiveQuery } from "@tanstack/react-db";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { repositoriesCollection } from "@/db";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { type Repository, removeRepository } from "@/tauri-commands";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
	getParentRoute: () => rootRoute,
	path: "/repositories",
	component: RepositoriesPage,
});

function RepositoriesPage() {
	const navigate = useNavigate();
	const { data: repositories = [] } = useLiveQuery(repositoriesCollection);
	const [pendingDelete, setPendingDelete] = useState<Repository | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	useKeyboardShortcut({
		key: "Escape",
		onPress: () => navigate({ to: "/" }),
	});

	async function handleConfirmDelete() {
		if (!pendingDelete || isDeleting) return;
		setIsDeleting(true);
		try {
			await removeRepository(pendingDelete.id);
			repositoriesCollection.utils.writeDelete(pendingDelete.id);
		} finally {
			setIsDeleting(false);
			setPendingDelete(null);
		}
	}

	return (
		<div className="flex flex-col h-screen p-6 gap-4">
			<div className="flex items-center justify-between">
				<h1 className="text-lg font-medium">Repositories</h1>
				<Button variant="outline" onClick={() => navigate({ to: "/" })}>
					Done
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Repository list</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-2">
					{repositories.length === 0 ? (
						<p className="text-muted-foreground text-sm">No repositories yet.</p>
					) : (
						repositories.map((repository) => (
							<div
								key={repository.id}
								className="flex items-center justify-between gap-4 rounded-sm border border-border px-3 py-2"
							>
								<div className="min-w-0">
									<div className="font-medium truncate">{repository.name}</div>
									<div className="text-muted-foreground text-xs truncate">{repository.path}</div>
								</div>
								<Button
									variant="destructive"
									size="sm"
									onClick={() => setPendingDelete(repository)}
								>
									Remove
								</Button>
							</div>
						))
					)}
				</CardContent>
			</Card>

			<AlertDialog
				open={pendingDelete !== null}
				onOpenChange={(open) => {
					if (!open) setPendingDelete(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove repository?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes the repository from Tatami, but does not delete any files on disk.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={!pendingDelete || isDeleting}
							onClick={handleConfirmDelete}
						>
							{isDeleting ? "Removing…" : "Remove repository"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
