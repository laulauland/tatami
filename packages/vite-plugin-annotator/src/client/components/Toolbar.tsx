import { Show, createSignal } from "solid-js";
import {
  state,
  toggleActive,
  clearAnnotations,
  exportAnnotations,
} from "../store";

/**
 * Small floating toolbar for the annotator
 */
export function Toolbar() {
  const isActive = () => state().isActive;
  const annotationCount = () => state().annotations.length;
  const [isHovered, setIsHovered] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const showExpanded = () => isHovered() || isActive() || annotationCount() > 0;

  const handleExport = async () => {
    await exportAnnotations();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      data-annotator
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        "z-index": "2147483647",
        display: "flex",
        "align-items": "center",
        gap: "6px",
        padding: "6px",
        background: isActive() ? "rgba(59, 130, 246, 0.95)" : "rgba(24, 24, 27, 0.95)",
        "border-radius": "9999px",
        "box-shadow": "0 2px 8px rgba(0,0,0,0.2)",
        transition: "all 0.15s ease-out",
        "backdrop-filter": "blur(8px)",
      }}
    >
      {/* Export/Clear buttons - only when have annotations */}
      <Show when={showExpanded() && annotationCount() > 0}>
        <button
          onClick={handleExport}
          title={copied() ? "Copied!" : "Copy prompt to clipboard"}
          style={{
            height: "28px",
            "padding-left": "10px",
            "padding-right": "10px",
            "border-radius": "9999px",
            border: "none",
            background: copied() ? "#10b981" : "rgba(255,255,255,0.15)",
            color: "white",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            gap: "6px",
            "font-size": "12px",
            "font-weight": "500",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            if (!copied()) e.currentTarget.style.background = "rgba(255,255,255,0.25)";
          }}
          onMouseLeave={(e) => {
            if (!copied()) e.currentTarget.style.background = "rgba(255,255,255,0.15)";
          }}
        >
          <Show when={copied()} fallback={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          }>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </Show>
          {annotationCount()}
        </button>

        <button
          onClick={clearAnnotations}
          title="Clear annotations"
          style={{
            width: "28px",
            height: "28px",
            "border-radius": "50%",
            border: "none",
            background: "rgba(239, 68, 68, 0.8)",
            color: "white",
            cursor: "pointer",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            transition: "transform 0.1s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1)"}
          onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.2)" }} />
      </Show>

      {/* Main toggle button */}
      <button
        onClick={toggleActive}
        title={isActive() ? "Stop annotating (Esc)" : "Start annotating (⌘⇧A)"}
        style={{
          width: "32px",
          height: "32px",
          "border-radius": "50%",
          border: "none",
          background: isActive() ? "white" : "transparent",
          color: isActive() ? "#3b82f6" : "white",
          cursor: "pointer",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          if (!isActive()) e.currentTarget.style.background = "rgba(255,255,255,0.15)";
        }}
        onMouseLeave={(e) => {
          if (!isActive()) e.currentTarget.style.background = "transparent";
        }}
      >
        <Show
          when={isActive()}
          fallback={
            /* Annotation/pencil icon */
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          }
        >
          {/* Check/done icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </Show>
      </button>
    </div>
  );
}
