import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { useEffect, useRef } from "react";

interface InlineEditorProps {
	/** Initial document content. Also used to detect external changes. */
	value: string;
	/** Called with the current text when the user saves (Cmd+Enter) or blurs after making changes. */
	onSave: (value: string) => void;
	placeholder?: string;
	/** If true, the editor is not editable (for immutable revisions). */
	readOnly?: boolean;
	/**
	 * Visual mode:
	 * - `"transparent"` (default): no border/background — looks like plain text.
	 * - `"bordered"`: always shows a border.
	 */
	variant?: "transparent" | "bordered";
	/** If true, auto-focus and select all text on mount. */
	autoFocus?: boolean;
	/** If true, constrains height with overflow scroll (for compact contexts). */
	compact?: boolean;
	/** Called when Escape is pressed. If not provided, Escape reverts changes and blurs. */
	onCancel?: () => void;
	className?: string;
}

/**
 * Theme that inherits the app's CSS variables for seamless integration.
 * Strips all default CodeMirror chrome so it feels like native inline editing.
 */
const baseTheme = EditorView.theme({
	"&": {
		fontSize: "14px",
		lineHeight: "20px",
		fontFamily: "var(--font-sans)",
	},
	"&.cm-focused": {
		outline: "none",
	},
	".cm-scroller": {
		fontFamily: "inherit",
		lineHeight: "inherit",
	},
	".cm-content": {
		padding: "0",
		caretColor: "var(--foreground)",
	},
	".cm-line": {
		padding: "0",
	},
	".cm-cursor": {
		borderLeftColor: "var(--foreground)",
	},
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
		backgroundColor: "color-mix(in oklch, var(--accent) 30%, transparent)",
	},
	".cm-placeholder": {
		color: "var(--muted-foreground)",
		fontStyle: "italic",
	},
});

/**
 * A minimal CodeMirror 6 editor for inline plain-text editing (commit messages, etc).
 *
 * Two modes:
 * - **transparent** (default): looks like plain text, border appears on focus,
 *   saves on blur if content changed. Ideal for always-visible document editing.
 * - **bordered**: always has a visible border, designed for modal/pop-up editing
 *   (e.g. the revision graph row). Auto-focuses and selects all on mount.
 *
 * Common: Cmd/Ctrl+Enter → save, Escape → revert + blur, undo/redo, line wrapping.
 */
export function InlineEditor({
	value,
	onSave,
	placeholder = "",
	readOnly = false,
	variant = "transparent",
	autoFocus = false,
	compact = false,
	onCancel,
	className = "",
}: InlineEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	// Track the "committed" value so we can detect real changes and revert on Escape
	const committedValueRef = useRef(value);

	// Stable refs for callbacks
	const onSaveRef = useRef(onSave);
	const onCancelRef = useRef(onCancel);
	onSaveRef.current = onSave;
	onCancelRef.current = onCancel;

	// Sync external value changes into the editor (e.g. after a save round-trips through the backend)
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const currentDoc = view.state.doc.toString();
		if (value !== committedValueRef.current && value !== currentDoc) {
			committedValueRef.current = value;
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: value },
			});
		}
	}, [value]);

	useEffect(() => {
		if (!containerRef.current) return;

		const customKeymap = keymap.of([
			{
				key: "Mod-Enter",
				run: (view) => {
					const text = view.state.doc.toString();
					if (text !== committedValueRef.current) {
						committedValueRef.current = text;
						onSaveRef.current(text);
					}
					// Blur after explicit save
					view.contentDOM.blur();
					return true;
				},
			},
			{
				key: "Escape",
				run: (view) => {
					if (onCancelRef.current) {
						onCancelRef.current();
					} else {
						// Revert to committed value and blur
						const committed = committedValueRef.current;
						view.dispatch({
							changes: { from: 0, to: view.state.doc.length, insert: committed },
						});
						view.contentDOM.blur();
					}
					return true;
				},
			},
		]);

		// Save on blur if content changed, stop keyboard events from reaching parent handlers
		const eventHandlers = EditorView.domEventHandlers({
			blur: (_, view) => {
				const text = view.state.doc.toString();
				if (text !== committedValueRef.current) {
					committedValueRef.current = text;
					onSaveRef.current(text);
				}
			},
			keydown: (event) => {
				event.stopPropagation();
			},
		});

		const state = EditorState.create({
			doc: value,
			extensions: [
				customKeymap,
				history(),
				keymap.of([...defaultKeymap, ...historyKeymap]),
				baseTheme,
				EditorView.editable.of(!readOnly),
				...(placeholder ? [cmPlaceholder(placeholder)] : []),
				eventHandlers,
			],
		});

		const view = new EditorView({
			state,
			parent: containerRef.current,
		});

		viewRef.current = view;

		if (autoFocus) {
			requestAnimationFrame(() => {
				view.focus();
				view.dispatch({
					selection: { anchor: 0, head: view.state.doc.length },
				});
			});
		}

		return () => {
			view.destroy();
			viewRef.current = null;
		};
		// Only create once on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const variantClasses =
		variant === "transparent"
			? ""
			: "rounded border border-border bg-background focus-within:ring-1 focus-within:ring-ring";

	return (
		<div
			ref={containerRef}
			className={`${variantClasses} ${
				compact ? "max-h-20 overflow-auto" : ""
			} ${className}`}
		/>
	);
}
