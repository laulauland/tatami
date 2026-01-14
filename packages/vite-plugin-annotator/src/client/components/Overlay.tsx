import { Show, For, createSignal, onMount, onCleanup, createEffect } from "solid-js";
import {
  state,
  setHoveredElement,
  addAnnotation,
  selectAnnotation,
} from "../store";
import type { Annotation } from "../types";

/**
 * Injects cursor style into main document (not shadow DOM)
 */
function CursorStyle() {
  let styleEl: HTMLStyleElement | null = null;

  createEffect(() => {
    const isActive = state().isActive;
    
    if (isActive && !styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "annotator-cursor-style";
      styleEl.textContent = `
        body { cursor: crosshair !important; }
        body * { cursor: crosshair !important; }
        [data-annotator] { cursor: default !important; }
        [data-annotator] * { cursor: pointer !important; }
        [data-annotator] input { cursor: text !important; }
      `;
      document.head.appendChild(styleEl);
    } else if (!isActive && styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  });

  onCleanup(() => {
    styleEl?.remove();
  });

  return null;
}

/**
 * Highlight overlay shown when hovering elements in active mode
 */
function HoverHighlight() {
  const element = () => state().hoveredElement;

  const rect = () => {
    const el = element();
    if (!el) return null;
    return el.getBoundingClientRect();
  };

  return (
    <Show when={rect()}>
      {(r) => (
        <div
          data-annotator
          style={{
            position: "fixed",
            top: `${r().top}px`,
            left: `${r().left}px`,
            width: `${r().width}px`,
            height: `${r().height}px`,
            border: "2px solid #3b82f6",
            "background-color": "rgba(59, 130, 246, 0.1)",
            "pointer-events": "none",
            "border-radius": "4px",
            "z-index": "2147483644",
            transition: "all 0.05s ease-out",
          }}
        />
      )}
    </Show>
  );
}

/**
 * Marker for an existing annotation
 */
function AnnotationMarker(props: { annotation: Annotation; index: number }) {
  const isSelected = () => state().selectedId === props.annotation.id;

  return (
    <div
      data-annotator
      style={{
        position: "fixed",
        top: `${props.annotation.position.y - 10}px`,
        left: `${props.annotation.position.x - 10}px`,
        width: "20px",
        height: "20px",
        "border-radius": "50%",
        "background-color": isSelected() ? "#3b82f6" : "#f97316",
        border: "2px solid white",
        "box-shadow": "0 1px 4px rgba(0,0,0,0.3)",
        cursor: "pointer",
        "z-index": "2147483645",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "font-size": "10px",
        "font-weight": "bold",
        color: "white",
        transition: "transform 0.1s ease-out",
        transform: isSelected() ? "scale(1.2)" : "scale(1)",
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectAnnotation(isSelected() ? null : props.annotation.id);
      }}
      title={props.annotation.text}
    >
      {props.index + 1}
    </div>
  );
}

/**
 * Input popover for adding annotation text
 */
function AnnotationInput(props: {
  position: { x: number; y: number };
  element: Element;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    requestAnimationFrame(() => {
      inputRef?.focus();
    });
  });

  const handleSubmit = () => {
    const value = text().trim();
    if (value) {
      props.onSubmit(value);
    } else {
      props.onCancel();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      props.onCancel();
    }
  };

  const popoverStyle = () => {
    let x = props.position.x + 12;
    let y = props.position.y + 12;

    const popoverWidth = 240;
    const popoverHeight = 72;

    if (x + popoverWidth > window.innerWidth - 16) {
      x = props.position.x - popoverWidth - 12;
    }
    if (y + popoverHeight > window.innerHeight - 16) {
      y = props.position.y - popoverHeight - 12;
    }

    return {
      position: "fixed" as const,
      top: `${y}px`,
      left: `${x}px`,
      width: `${popoverWidth}px`,
      "z-index": "2147483646",
    };
  };

  return (
    <div data-annotator style={popoverStyle()} onClick={(e) => e.stopPropagation()}>
      <div
        style={{
          "background-color": "white",
          "border-radius": "8px",
          "box-shadow": "0 4px 16px rgba(0,0,0,0.2)",
          padding: "10px",
          display: "flex",
          gap: "8px",
        }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="What's wrong?"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: "1",
            padding: "8px 10px",
            border: "1px solid #e5e7eb",
            "border-radius": "6px",
            "font-size": "13px",
            outline: "none",
            "min-width": "0",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#3b82f6";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#e5e7eb";
          }}
        />
        <button
          onClick={handleSubmit}
          style={{
            padding: "8px 12px",
            border: "none",
            "border-radius": "6px",
            background: "#3b82f6",
            color: "white",
            cursor: "pointer",
            "font-size": "13px",
            "white-space": "nowrap",
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * Main overlay component
 */
export function Overlay() {
  const [pendingAnnotation, setPendingAnnotation] = createSignal<{
    position: { x: number; y: number };
    element: Element;
  } | null>(null);

  const handleMouseMove = (e: MouseEvent) => {
    if (!state().isActive || pendingAnnotation()) {
      if (!state().isActive) setHoveredElement(null);
      return;
    }

    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    const target = elements.find((el) => !el.closest("[data-annotator]"));
    setHoveredElement(target ?? null);
  };

  const handleClick = (e: MouseEvent) => {
    if (!state().isActive) return;

    const target = e.target as Element;
    if (target.closest("[data-annotator]")) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const element = state().hoveredElement;
    if (!element) return;

    setPendingAnnotation({
      position: { x: e.clientX, y: e.clientY },
      element,
    });

    setHoveredElement(null);
  };

  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove, { capture: true });
    document.addEventListener("click", handleClick, { capture: true });
  });

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove, { capture: true });
    document.removeEventListener("click", handleClick, { capture: true });
  });

  const handleAnnotationSubmit = async (text: string) => {
    const pending = pendingAnnotation();
    if (!pending) return;

    await addAnnotation(pending.element, pending.position, text);
    setPendingAnnotation(null);
  };

  return (
    <>
      <CursorStyle />
      <HoverHighlight />

      <For each={state().annotations}>
        {(annotation, index) => (
          <AnnotationMarker annotation={annotation} index={index()} />
        )}
      </For>

      <Show when={pendingAnnotation()}>
        {(pending) => (
          <AnnotationInput
            position={pending().position}
            element={pending().element}
            onSubmit={handleAnnotationSubmit}
            onCancel={() => setPendingAnnotation(null)}
          />
        )}
      </Show>
    </>
  );
}
