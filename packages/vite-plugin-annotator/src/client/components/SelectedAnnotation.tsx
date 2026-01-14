import { Show, createSignal } from "solid-js";
import {
  state,
  updateAnnotation,
  removeAnnotation,
  selectAnnotation,
} from "../store";

/**
 * Panel showing details of the selected annotation
 */
export function SelectedAnnotation() {
  const selected = () => {
    const id = state().selectedId;
    if (!id) return null;
    return state().annotations.find((a) => a.id === id) ?? null;
  };

  const [isEditing, setIsEditing] = createSignal(false);
  const [editText, setEditText] = createSignal("");

  const startEdit = () => {
    const s = selected();
    if (s) {
      setEditText(s.text);
      setIsEditing(true);
    }
  };

  const saveEdit = () => {
    const s = selected();
    if (s) {
      updateAnnotation(s.id, editText());
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handleDelete = () => {
    const s = selected();
    if (s) {
      removeAnnotation(s.id);
    }
  };

  return (
    <Show when={selected()}>
      {(annotation) => (
        <div
          data-annotator
          style={{
            position: "fixed",
            bottom: "90px",
            right: "20px",
            width: "320px",
            "max-height": "400px",
            background: "white",
            "border-radius": "12px",
            "box-shadow": "0 4px 20px rgba(0,0,0,0.2)",
            overflow: "hidden",
            "z-index": "2147483646",
            display: "flex",
            "flex-direction": "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              "border-bottom": "1px solid #e5e7eb",
              display: "flex",
              "justify-content": "space-between",
              "align-items": "center",
            }}
          >
            <span
              style={{
                "font-weight": "600",
                "font-size": "14px",
                color: "#1f2937",
              }}
            >
              Annotation #{state().annotations.indexOf(annotation()) + 1}
            </span>
            <button
              onClick={() => selectAnnotation(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                color: "#6b7280",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div
            style={{
              padding: "16px",
              overflow: "auto",
              flex: "1",
            }}
          >
            {/* Feedback text */}
            <div style={{ "margin-bottom": "16px" }}>
              <label
                style={{
                  "font-size": "12px",
                  color: "#6b7280",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.05em",
                }}
              >
                Feedback
              </label>
              <Show
                when={isEditing()}
                fallback={
                  <p
                    style={{
                      "margin-top": "4px",
                      "font-size": "14px",
                      color: "#1f2937",
                      cursor: "pointer",
                    }}
                    onClick={startEdit}
                    title="Click to edit"
                  >
                    "{annotation().text}"
                  </p>
                }
              >
                <input
                  type="text"
                  value={editText()}
                  onInput={(e) => setEditText(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  onBlur={saveEdit}
                  autofocus
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    border: "1px solid #3b82f6",
                    "border-radius": "4px",
                    "font-size": "14px",
                    "margin-top": "4px",
                    "box-sizing": "border-box",
                  }}
                />
              </Show>
            </div>

            {/* Component info */}
            <Show when={annotation().element.componentName}>
              <div style={{ "margin-bottom": "12px" }}>
                <label
                  style={{
                    "font-size": "12px",
                    color: "#6b7280",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.05em",
                  }}
                >
                  Component
                </label>
                <p
                  style={{
                    "margin-top": "4px",
                    "font-size": "13px",
                    color: "#1f2937",
                    "font-family": "monospace",
                  }}
                >
                  {annotation().element.componentName}
                  <Show when={annotation().element.sourceLocation}>
                    <span style={{ color: "#6b7280" }}>
                      {" "}
                      at {annotation().element.sourceLocation}
                    </span>
                  </Show>
                </p>
              </div>
            </Show>

            {/* Animation state */}
            <Show when={annotation().animations.length > 0}>
              <div style={{ "margin-bottom": "12px" }}>
                <label
                  style={{
                    "font-size": "12px",
                    color: "#6b7280",
                    "text-transform": "uppercase",
                    "letter-spacing": "0.05em",
                  }}
                >
                  Animations ({annotation().animations.length})
                </label>
                <div
                  style={{
                    "margin-top": "4px",
                    "font-size": "12px",
                    "font-family": "monospace",
                    background: "#f3f4f6",
                    padding: "8px",
                    "border-radius": "4px",
                  }}
                >
                  {annotation().animations.map((anim) => (
                    <div style={{ "margin-bottom": "4px" }}>
                      <span style={{ color: "#7c3aed" }}>{anim.name}</span>
                      <span style={{ color: "#6b7280" }}>
                        {" "}
                        {anim.currentTime.toFixed(0)}ms /{" "}
                        {anim.duration.toFixed(0)}ms (
                        {(anim.progress * 100).toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Show>

            {/* Element preview */}
            <div style={{ "margin-bottom": "12px" }}>
              <label
                style={{
                  "font-size": "12px",
                  color: "#6b7280",
                  "text-transform": "uppercase",
                  "letter-spacing": "0.05em",
                }}
              >
                Element
              </label>
              <pre
                style={{
                  "margin-top": "4px",
                  "font-size": "11px",
                  "font-family": "monospace",
                  background: "#f3f4f6",
                  padding: "8px",
                  "border-radius": "4px",
                  overflow: "auto",
                  "white-space": "pre-wrap",
                  "word-break": "break-all",
                  "max-height": "100px",
                }}
              >
                {annotation().element.html}
              </pre>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "12px 16px",
              "border-top": "1px solid #e5e7eb",
              display: "flex",
              "justify-content": "flex-end",
            }}
          >
            <button
              onClick={handleDelete}
              style={{
                padding: "6px 12px",
                border: "none",
                "border-radius": "6px",
                background: "#fee2e2",
                color: "#dc2626",
                cursor: "pointer",
                "font-size": "13px",
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}
