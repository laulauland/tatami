/**
 * Simple console tracing for debugging performance.
 * Enable via:
 *   - Environment variable: VITE_TRACE=1
 *   - localStorage: localStorage.setItem('TRACE', '1')
 *   - Settings UI toggle
 */

// Check env var at module load time (set by Vite)
const ENV_TRACE_ENABLED = import.meta.env.VITE_TRACE === "1";

export function isTraceEnabled(): boolean {
	return (
		ENV_TRACE_ENABLED ||
		(typeof localStorage !== "undefined" && localStorage.getItem("TRACE") === "1")
	);
}

export function setTraceEnabled(enabled: boolean): void {
	if (typeof localStorage !== "undefined") {
		if (enabled) {
			localStorage.setItem("TRACE", "1");
		} else {
			localStorage.removeItem("TRACE");
		}
	}
}

const TRACE_ENABLED = isTraceEnabled;

const spans = new Map<string, { start: number; parent?: string }>();
let currentSpan: string | null = null;

export function traceStart(name: string, metadata?: Record<string, unknown>): string {
	if (!TRACE_ENABLED()) return name;

	const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	const parent = currentSpan;
	spans.set(id, { start: performance.now(), parent: parent ?? undefined });
	currentSpan = id;

	// Add performance mark for Safari DevTools Timeline
	performance.mark(`${id}-start`);

	const indent = parent ? "  → " : "";
	const meta = metadata ? ` ${JSON.stringify(metadata)}` : "";
	console.log(`%c[TRACE]%c ${indent}${name} start${meta}`, "color: #888", "color: inherit");

	return id;
}

export function traceEnd(id: string, metadata?: Record<string, unknown>): void {
	if (!TRACE_ENABLED()) return;

	const span = spans.get(id);
	if (!span) return;

	// Add performance mark and measure for Safari DevTools Timeline
	performance.mark(`${id}-end`);
	try {
		performance.measure(id.split("-")[0], `${id}-start`, `${id}-end`);
	} catch {
		// Marks may have been cleared
	}

	const duration = performance.now() - span.start;
	const name = id.split("-")[0];
	const indent = span.parent ? "  ← " : "";
	const meta = metadata ? ` ${JSON.stringify(metadata)}` : "";

	console.log(
		`%c[TRACE]%c ${indent}${name} end %c${duration.toFixed(1)}ms%c${meta}`,
		"color: #888",
		"color: inherit",
		duration > 50 ? "color: #f90; font-weight: bold" : "color: #0a0",
		"color: #888",
	);

	spans.delete(id);
	currentSpan = span.parent ?? null;
}

export function traceLog(message: string, metadata?: Record<string, unknown>): void {
	if (!TRACE_ENABLED()) return;

	const indent = currentSpan ? "    " : "";
	const meta = metadata ? ` ${JSON.stringify(metadata)}` : "";
	console.log(`%c[TRACE]%c ${indent}${message}${meta}`, "color: #888", "color: #666");
}

/**
 * React Profiler callback for measuring component render times.
 * Logs renders that take longer than 5ms, with warnings for renders exceeding 16ms (one frame).
 */
export function onRenderCallback(
	id: string,
	phase: "mount" | "update" | "nested-update",
	actualDuration: number,
	baseDuration: number,
	_startTime: number,
	_commitTime: number,
): void {
	if (!TRACE_ENABLED()) return;
	if (actualDuration > 5) {
		console.log(
			`%c[PROFILER]%c ${id} ${phase}: %c${actualDuration.toFixed(1)}ms%c (base: ${baseDuration.toFixed(1)}ms)`,
			"color: #888",
			"color: inherit",
			actualDuration > 16 ? "color: #f00; font-weight: bold" : "color: #f90",
			"color: #888",
		);
	}
}

/**
 * Wrap an async function with tracing
 */
export function traced<T>(
	name: string,
	fn: () => Promise<T>,
	metadata?: Record<string, unknown>,
): Promise<T> {
	const id = traceStart(name, metadata);
	return fn().finally(() => traceEnd(id));
}

/**
 * Wrap an Effect with tracing (returns modified Effect)
 */
export function traceEffect<A, E>(
	name: string,
	metadata?: Record<string, unknown>,
): <R>(effect: import("effect").Effect.Effect<A, E, R>) => import("effect").Effect.Effect<A, E, R> {
	return (effect) => {
		// Dynamic import to avoid circular deps
		const { Effect } = require("effect");
		return Effect.gen(function* () {
			const id = traceStart(name, metadata);
			try {
				const result = yield* effect;
				traceEnd(id);
				return result;
			} catch (e) {
				traceEnd(id, { error: true });
				throw e;
			}
		});
	};
}
