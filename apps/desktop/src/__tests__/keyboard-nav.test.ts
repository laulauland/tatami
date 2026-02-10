// @vitest-environment jsdom
/**
 * Suite 5: Keyboard navigation
 *
 * Tests j/k/enter/escape flows, gg/G shortcuts, @/parent/child navigation.
 * Uses jsdom environment for window/document event simulation.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { buildRevisionChain, resetIdCounter } from "./fixtures";
import type { Revision } from "@/schemas";
import { getRevisionKey } from "@/db.pure";

// ============================================================================
// Standalone keyboard handler (mirrors useKeyboardNavigation logic)
// ============================================================================

/**
 * Creates a keyboard navigation handler identical to the useKeyboardNavigation
 * hook logic but without React dependencies for direct testing.
 */
function createKeyboardHandler(options: {
	getRevisions: () => Revision[];
	getSelectedKey: () => string | null;
	onNavigate: (key: string) => void;
	scrollToChangeId?: (key: string, opts?: { align?: string; smooth?: boolean }) => void;
}) {
	const { getRevisions, getSelectedKey, onNavigate, scrollToChangeId } = options;
	let sequenceBuffer = "";
	let sequenceTimestamp = 0;
	const SEQUENCE_TIMEOUT = 500;

	function handleKeyDown(event: KeyboardEvent) {
		const activeElement = document.activeElement;
		if (activeElement?.tagName === "INPUT" || activeElement?.tagName === "TEXTAREA") {
			return;
		}

		const revisions = getRevisions();
		const revisionKey = getSelectedKey();

		let currentIndex = revisions.findIndex((r) => getRevisionKey(r) === revisionKey);
		if (currentIndex < 0) {
			currentIndex = revisions.findIndex((r) => r.is_working_copy);
			if (currentIndex < 0) currentIndex = 0;
		}
		const currentRevision = revisions[currentIndex] ?? null;

		// Handle "gg" sequence
		const now = Date.now();
		if (now - sequenceTimestamp > SEQUENCE_TIMEOUT) {
			sequenceBuffer = "";
		}
		sequenceBuffer += event.key;
		sequenceTimestamp = now;
		if (sequenceBuffer.length > 2) {
			sequenceBuffer = sequenceBuffer.slice(-2);
		}

		if (sequenceBuffer.endsWith("gg")) {
			const first = revisions[0];
			if (first) {
				onNavigate(getRevisionKey(first));
				scrollToChangeId?.(getRevisionKey(first), { align: "center", smooth: true });
			}
			sequenceBuffer = "";
			event.preventDefault();
			return;
		}

		let targetKey: string | null = null;

		const isMinusKey =
			event.key === "-" || event.code === "Minus" || event.code === "NumpadSubtract";
		const isPlusKey =
			event.key === "+" ||
			event.key === "=" ||
			event.code === "Equal" ||
			event.code === "NumpadAdd";

		switch (true) {
			case event.key === "j" || event.key === "ArrowDown":
				if (currentIndex >= 0 && currentIndex < revisions.length - 1) {
					targetKey = getRevisionKey(revisions[currentIndex + 1]);
				}
				event.preventDefault();
				break;

			case event.key === "k" || event.key === "ArrowUp":
				if (currentIndex > 0) {
					targetKey = getRevisionKey(revisions[currentIndex - 1]);
				}
				event.preventDefault();
				break;

			case isMinusKey:
				if (currentRevision) {
					const parentId = currentRevision.parent_edges[0]?.parent_id;
					if (parentId) {
						const parent = revisions.find((r) => r.commit_id === parentId);
						if (parent) targetKey = getRevisionKey(parent);
					}
				}
				event.preventDefault();
				break;

			case isPlusKey:
				if (currentRevision) {
					const childId = currentRevision.children_ids[0];
					if (childId) {
						const child = revisions.find((r) => r.commit_id === childId);
						if (child) targetKey = getRevisionKey(child);
					}
				}
				event.preventDefault();
				break;

			case event.key === "@": {
				const wc = revisions.find((r) => r.is_working_copy);
				targetKey = wc ? getRevisionKey(wc) : null;
				event.preventDefault();
				break;
			}

			case event.key === "G": {
				const last = revisions[revisions.length - 1];
				targetKey = last ? getRevisionKey(last) : null;
				event.preventDefault();
				break;
			}

			case event.key === "Escape":
				onNavigate("");
				event.preventDefault();
				return; // Early return (Escape navigates to "")
		}

		if (targetKey) {
			onNavigate(targetKey);
			scrollToChangeId?.(targetKey, { align: "auto", smooth: false });
		}
	}

	window.addEventListener("keydown", handleKeyDown);
	return () => window.removeEventListener("keydown", handleKeyDown);
}

// ============================================================================
// Helper to dispatch keyboard events
// ============================================================================

function pressKey(key: string, opts?: Partial<KeyboardEventInit>): void {
	window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

// ============================================================================
// Tests
// ============================================================================

describe("Keyboard navigation", () => {
	let revisions: Revision[];
	let selectedKey: string | null;
	let onNavigateMock: ReturnType<typeof vi.fn>;
	let scrollToMock: ReturnType<typeof vi.fn>;
	let cleanup: () => void;

	beforeEach(() => {
		resetIdCounter();
		revisions = buildRevisionChain(5); // 5 revisions, last is WC
		selectedKey = getRevisionKey(revisions[2]); // Start in the middle
		onNavigateMock = vi.fn((key: string) => {
			selectedKey = key;
		});
		scrollToMock = vi.fn();

		cleanup = createKeyboardHandler({
			getRevisions: () => revisions,
			getSelectedKey: () => selectedKey,
			// biome-ignore lint/complexity/noBannedTypes: vi.fn() returns opaque mock type
			onNavigate: (...args: unknown[]) => (onNavigateMock as Function)(...args),
			// biome-ignore lint/complexity/noBannedTypes: vi.fn() returns opaque mock type
			scrollToChangeId: (...args: unknown[]) => (scrollToMock as Function)(...args),
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	// ── j/k (next/prev) ─────────────────────────────────────────────────────

	test("j moves selection down by one", () => {
		const startKey = getRevisionKey(revisions[2]);
		selectedKey = startKey;

		pressKey("j");

		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[3]));
	});

	test("k moves selection up by one", () => {
		selectedKey = getRevisionKey(revisions[2]);

		pressKey("k");

		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[1]));
	});

	test("ArrowDown moves selection down", () => {
		selectedKey = getRevisionKey(revisions[1]);

		pressKey("ArrowDown");

		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[2]));
	});

	test("ArrowUp moves selection up", () => {
		selectedKey = getRevisionKey(revisions[3]);

		pressKey("ArrowUp");

		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[2]));
	});

	test("j at bottom does not navigate", () => {
		selectedKey = getRevisionKey(revisions[4]); // Last

		pressKey("j");

		expect(onNavigateMock).not.toHaveBeenCalled();
	});

	test("k at top does not navigate", () => {
		selectedKey = getRevisionKey(revisions[0]); // First

		pressKey("k");

		expect(onNavigateMock).not.toHaveBeenCalled();
	});

	// ── G (go to last) ──────────────────────────────────────────────────────

	test("G jumps to last revision", () => {
		selectedKey = getRevisionKey(revisions[0]);

		pressKey("G");

		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[4]));
	});

	// ── gg (go to first) ────────────────────────────────────────────────────

	test("gg jumps to first revision", () => {
		selectedKey = getRevisionKey(revisions[4]);

		pressKey("g");
		pressKey("g");

		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[0]));
	});

	// ── @ (go to working copy) ──────────────────────────────────────────────

	test("@ jumps to working copy revision", () => {
		selectedKey = getRevisionKey(revisions[0]);

		pressKey("@");

		const wcRev = revisions.find((r) => r.is_working_copy);
		expect(wcRev).toBeDefined();
		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(wcRev as Revision));
	});

	// ── Escape (clear selection) ─────────────────────────────────────────────

	test("Escape clears selection", () => {
		selectedKey = getRevisionKey(revisions[2]);

		pressKey("Escape");

		expect(onNavigateMock).toHaveBeenCalledWith("");
	});

	// ── - (parent) and + (child) ─────────────────────────────────────────────

	test("- navigates to parent revision", () => {
		selectedKey = getRevisionKey(revisions[2]);

		pressKey("-");

		// Revision 2's parent is revision 1
		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[1]));
	});

	test("+ navigates to child revision", () => {
		selectedKey = getRevisionKey(revisions[1]);

		pressKey("+");

		// Revision 1's child is revision 2
		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[2]));
	});

	test("- at root does not navigate (no parent)", () => {
		selectedKey = getRevisionKey(revisions[0]);

		pressKey("-");

		expect(onNavigateMock).not.toHaveBeenCalled();
	});

	test("+ at leaf does not navigate (no children)", () => {
		selectedKey = getRevisionKey(revisions[4]); // Last, WC

		pressKey("+");

		// WC has no children (children_ids is [])
		expect(onNavigateMock).not.toHaveBeenCalled();
	});

	// ── Input focus blocking ────────────────────────────────────────────────

	test("keyboard events are ignored when input is focused", () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		input.focus();

		pressKey("j");
		pressKey("k");
		pressKey("G");

		expect(onNavigateMock).not.toHaveBeenCalled();
		document.body.removeChild(input);
	});

	test("keyboard events are ignored when textarea is focused", () => {
		const textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		textarea.focus();

		pressKey("j");

		expect(onNavigateMock).not.toHaveBeenCalled();
		document.body.removeChild(textarea);
	});

	// ── Scroll behavior ─────────────────────────────────────────────────────

	test("j/k scrolls with align auto", () => {
		selectedKey = getRevisionKey(revisions[1]);

		pressKey("j");

		expect(scrollToMock).toHaveBeenCalledWith(getRevisionKey(revisions[2]), {
			align: "auto",
			smooth: false,
		});
	});

	test("G scrolls with align auto", () => {
		pressKey("G");

		expect(scrollToMock).toHaveBeenCalledWith(
			getRevisionKey(revisions[4]),
			expect.objectContaining({ align: "auto" }),
		);
	});

	// ── Sequential j presses walk through all revisions ─────────────────────

	test("pressing j repeatedly walks through all revisions", () => {
		selectedKey = getRevisionKey(revisions[0]);
		const visited: string[] = [selectedKey];

		for (let i = 0; i < 4; i++) {
			pressKey("j");
			visited.push(selectedKey);
		}

		expect(visited).toEqual(revisions.map((r) => getRevisionKey(r)));
	});

	// ── Deterministic: no selection defaults to WC ──────────────────────────

	test("when no revision is selected, navigation starts from working copy", () => {
		selectedKey = null;

		pressKey("j"); // Should move down from WC (index 4), which is at end so no-op

		// WC is last, so j from there is a no-op, but the handler resolves to WC index
		// Let's test k which should move up from WC
		onNavigateMock.mockClear();
		selectedKey = null;
		pressKey("k");

		// From WC (index 4), k should go to index 3
		expect(onNavigateMock).toHaveBeenCalledWith(getRevisionKey(revisions[3]));
	});
});
