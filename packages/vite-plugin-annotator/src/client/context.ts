import type { ElementContext } from "./types";
import { getSelector } from "./animations";

// bippy imports - these provide React DevTools-like fiber access
let bippy: typeof import("bippy") | null = null;
let bippySource: typeof import("bippy/source") | null = null;

// Try to load bippy (might fail if React isn't present)
async function loadBippy() {
  if (bippy) return;
  try {
    bippy = await import("bippy");
    bippySource = await import("bippy/source");
  } catch {
    // bippy not available, React component info won't be captured
  }
}

// Initialize bippy on load
loadBippy();

/**
 * Get truncated outer HTML
 */
function getHtmlPreview(element: Element, maxLength = 500): string {
  const clone = element.cloneNode(true) as Element;

  // Truncate text content
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent && node.textContent.length > 50) {
      node.textContent = node.textContent.slice(0, 50) + "...";
    }
  }

  // Truncate attribute values
  const allElements = clone.querySelectorAll("*");
  for (const el of [clone, ...Array.from(allElements)]) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.length > 60) {
        el.setAttribute(attr.name, attr.value.slice(0, 60) + "...");
      }
    }
  }

  let html = clone.outerHTML;
  if (html.length > maxLength) {
    // Find the end of the opening tag
    const openingTagEnd = html.indexOf(">") + 1;
    if (openingTagEnd > 0 && openingTagEnd < maxLength) {
      html = html.slice(0, maxLength) + "...";
    }
  }

  return html;
}

/**
 * Get relevant computed styles
 */
function getRelevantStyles(element: Element): Record<string, string> {
  const computed = getComputedStyle(element);
  const relevant = [
    "animation",
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-play-state",
    "transition",
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transform",
    "opacity",
    "background-color",
    "color",
  ];

  const styles: Record<string, string> = {};
  for (const prop of relevant) {
    const value = computed.getPropertyValue(prop);
    if (value && value !== "none" && value !== "0s" && value !== "all 0s ease 0s") {
      styles[prop] = value;
    }
  }

  return styles;
}

/**
 * Get React component info via bippy
 */
async function getReactInfo(
  element: Element
): Promise<{ componentName?: string; sourceLocation?: string }> {
  if (!bippy || !bippySource) {
    await loadBippy();
  }

  if (!bippy || !bippySource) {
    return {};
  }

  try {
    if (!bippy.isInstrumentationActive()) {
      return {};
    }

    const fiber = bippy.getFiberFromHostInstance(element);
    if (!fiber) return {};

    const stack = await bippySource.getOwnerStack(fiber);
    if (!stack || stack.length === 0) return {};

    // Find the first user component (not internal)
    for (const frame of stack) {
      if (frame.functionName && !isInternalComponent(frame.functionName)) {
        const sourceLocation = frame.fileName
          ? `${frame.fileName}:${frame.lineNumber ?? "?"}:${frame.columnNumber ?? "?"}`
          : undefined;

        return {
          componentName: frame.functionName,
          sourceLocation,
        };
      }
    }

    return {};
  } catch {
    return {};
  }
}

/**
 * Check if component name is internal (React, Next.js, etc.)
 */
function isInternalComponent(name: string): boolean {
  const internals = [
    "Suspense",
    "Fragment",
    "StrictMode",
    "Profiler",
    "InnerLayoutRouter",
    "OuterLayoutRouter",
    "RenderFromTemplateContext",
    "ScrollAndFocusHandler",
    "RedirectErrorBoundary",
    "NotFoundErrorBoundary",
    "LoadingBoundary",
    "ErrorBoundary",
    "HotReload",
  ];

  return (
    internals.includes(name) ||
    name.startsWith("__") ||
    name.startsWith("$") ||
    /^[a-z]/.test(name) // lowercase = DOM element
  );
}

/**
 * Capture full context for an element
 */
export async function captureElementContext(
  element: Element
): Promise<ElementContext> {
  const reactInfo = await getReactInfo(element);

  return {
    html: getHtmlPreview(element),
    selector: getSelector(element),
    rect: element.getBoundingClientRect(),
    computedStyles: getRelevantStyles(element),
    componentName: reactInfo.componentName,
    sourceLocation: reactInfo.sourceLocation,
  };
}
