import { render } from "solid-js/web";
import { onCleanup, onMount } from "solid-js";
import { Overlay } from "./components/Overlay";
import { Toolbar } from "./components/Toolbar";
import { SelectedAnnotation } from "./components/SelectedAnnotation";
import { state, toggleActive } from "./store";

/**
 * Root component that mounts everything
 */
function Annotator() {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Cmd+Shift+A (Mac) or Ctrl+Shift+A (Windows) to toggle
    if (e.key.toLowerCase() === "a" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      toggleActive();
      return;
    }

    // Escape to deactivate when active
    if (e.key === "Escape" && state().isActive) {
      e.preventDefault();
      e.stopPropagation();
      toggleActive();
      return;
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    console.log("[Annotator] Ready - press ⌘⇧A to start annotating");
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  return (
    <>
      <Overlay />
      <Toolbar />
      <SelectedAnnotation />
    </>
  );
}

/**
 * Mount the annotator into a shadow DOM container
 */
function mount() {
  const container = document.createElement("div");
  container.id = "annotator-root";
  container.setAttribute("data-annotator", "");
  document.body.appendChild(container);

  const shadow = container.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * {
      box-sizing: border-box;
    }
  `;
  shadow.appendChild(style);

  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  render(() => <Annotator />, mountPoint);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
