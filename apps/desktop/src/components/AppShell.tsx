import { useState } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Toolbar } from "@/components/Toolbar";
import { Sidebar } from "@/components/Sidebar";
import { DetailPanel } from "@/components/DetailPanel";
import { StatusBar } from "@/components/StatusBar";

export function AppShell() {
	const [repoPath, setRepoPath] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

	const handleRefresh = () => {
		setIsLoading(true);
		setTimeout(() => {
			setLastRefresh(new Date());
			setIsLoading(false);
		}, 1000);
	};

	const handleOpenRepo = () => {
		setRepoPath("/example/repo/path");
	};

	const handleOpenSettings = () => {
		console.log("Open settings");
	};

	return (
		<div className="flex flex-col h-screen w-screen overflow-hidden">
			<Toolbar
				repoPath={repoPath}
				isLoading={isLoading}
				onRefresh={handleRefresh}
				onOpenRepo={handleOpenRepo}
				onOpenSettings={handleOpenSettings}
			/>

			<ResizablePanelGroup orientation="horizontal" className="flex-1">
				<ResizablePanel id="sidebar" defaultSize="25%">
					<Sidebar />
				</ResizablePanel>

				<ResizableHandle withHandle />

				<ResizablePanel id="detail" defaultSize="75%">
					<DetailPanel />
				</ResizablePanel>
			</ResizablePanelGroup>

			<StatusBar branch={repoPath ? "main" : null} lastRefresh={lastRefresh} isConnected={true} />
		</div>
	);
}
