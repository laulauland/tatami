import { Copy, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
	componentStack: string;
}

export function formatErrorForCopy(error: Error | null, componentStack: string): string {
	if (!error) return "Unknown error";
	const parts = [error.toString()];
	if (error.stack) parts.push(error.stack);
	if (componentStack) parts.push(`Component stack:${componentStack}`);
	return parts.join("\n\n");
}

export function ErrorBoundaryFallback({
	error,
	componentStack,
	onReload,
	onCopyError,
}: {
	error: Error | null;
	componentStack: string;
	onReload: () => void;
	onCopyError: () => void;
}) {
	return (
		<div className="h-screen w-full flex items-center justify-center p-6 bg-background">
			<div className="w-full max-w-2xl rounded-md border border-border bg-card p-4 space-y-3">
				<div>
					<h1 className="text-sm font-semibold">Something went wrong</h1>
					<p className="text-xs text-muted-foreground mt-1">
						{error?.message ?? "An unexpected error occurred."}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button size="sm" onClick={onReload}>
						<RefreshCw className="size-3" />
						Reload
					</Button>
					<Button size="sm" variant="outline" onClick={onCopyError}>
						<Copy className="size-3" />
						Copy error
					</Button>
				</div>
				{import.meta.env.DEV && componentStack ? (
					<pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-[40vh] whitespace-pre-wrap">
						{componentStack}
					</pre>
				) : null}
			</div>
		</div>
	);
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
	state: ErrorBoundaryState = {
		hasError: false,
		error: null,
		componentStack: "",
	};

	static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		this.setState({ error, componentStack: errorInfo.componentStack ?? "" });
	}

	private handleReload = () => {
		window.location.reload();
	};

	private handleCopyError = async () => {
		await navigator.clipboard.writeText(
			formatErrorForCopy(this.state.error, this.state.componentStack),
		);
	};

	render() {
		if (this.state.hasError) {
			return (
				<ErrorBoundaryFallback
					error={this.state.error}
					componentStack={this.state.componentStack}
					onReload={this.handleReload}
					onCopyError={this.handleCopyError}
				/>
			);
		}

		return this.props.children;
	}
}
