import { createSignal, createRoot } from "solid-js";
import type { Annotation, AnnotatorState } from "./types";
import { getElementAnimations } from "./animations";
import { captureElementContext } from "./context";
import { generatePrompt } from "./prompt";

// Create store in a root to ensure proper cleanup
const store = createRoot(() => {
  const [state, setState] = createSignal<AnnotatorState>({
    isActive: false,
    isPaused: false,
    annotations: [],
    selectedId: null,
    hoveredElement: null,
  });

  return { state, setState };
});

export const { state, setState } = store;

/**
 * Toggle annotator active state (just enables/disables click capture)
 */
export function toggleActive(): void {
  setState((s) => ({
    ...s,
    isActive: !s.isActive,
    hoveredElement: null,
  }));
}

/**
 * Add a new annotation at the clicked element
 */
export async function addAnnotation(
  element: Element,
  position: { x: number; y: number },
  text: string
): Promise<void> {
  const elementContext = await captureElementContext(element);
  const animations = getElementAnimations(element);

  const annotation: Annotation = {
    id: crypto.randomUUID(),
    text,
    timestamp: Date.now(),
    position,
    element: elementContext,
    animations,
  };

  setState((s) => ({
    ...s,
    annotations: [...s.annotations, annotation],
    selectedId: annotation.id,
  }));
}

/**
 * Update an annotation's text
 */
export function updateAnnotation(id: string, text: string): void {
  setState((s) => ({
    ...s,
    annotations: s.annotations.map((a) => (a.id === id ? { ...a, text } : a)),
  }));
}

/**
 * Remove an annotation
 */
export function removeAnnotation(id: string): void {
  setState((s) => ({
    ...s,
    annotations: s.annotations.filter((a) => a.id !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }));
}

/**
 * Clear all annotations
 */
export function clearAnnotations(): void {
  setState((s) => ({
    ...s,
    annotations: [],
    selectedId: null,
  }));
}

/**
 * Select an annotation
 */
export function selectAnnotation(id: string | null): void {
  setState((s) => ({
    ...s,
    selectedId: id,
  }));
}

/**
 * Set hovered element
 */
export function setHoveredElement(element: Element | null): void {
  setState((s) => ({
    ...s,
    hoveredElement: element,
  }));
}

/**
 * Export annotations as prompt and copy to clipboard
 */
export async function exportAnnotations(): Promise<void> {
  const current = state();
  const prompt = generatePrompt(current.annotations);

  try {
    await navigator.clipboard.writeText(prompt);
    console.log("[Annotator] Prompt copied to clipboard ✓");
  } catch (err) {
    console.error("[Annotator] Failed to copy:", err);
    console.log("[Annotator] Generated prompt:\n", prompt);
  }
}
