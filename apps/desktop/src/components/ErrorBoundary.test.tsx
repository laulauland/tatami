import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary, ErrorBoundaryFallback, formatErrorForCopy } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
	test("renders error fallback UI", () => {
		const html = renderToStaticMarkup(
			<ErrorBoundaryFallback
				error={new Error("Boom")}
				componentStack={"at Thrower"}
				onReload={() => {}}
				onCopyError={() => {}}
			/>,
		);

		expect(html).toContain("Something went wrong");
		expect(html).toContain("Boom");
		expect(html).toContain("Reload");
	});

	test("marks state as failed when an error is thrown", () => {
		const state = ErrorBoundary.getDerivedStateFromError(new Error("kaboom"));
		expect(state.hasError).toBe(true);
	});

	test("formats copy payload with stack and component stack", () => {
		const error = new Error("Broken");
		error.stack = "Error: Broken\n at SomePlace";
		const text = formatErrorForCopy(error, "\n at Thrower");
		expect(text).toContain("Error: Broken");
		expect(text).toContain("Component stack:");
	});
});
