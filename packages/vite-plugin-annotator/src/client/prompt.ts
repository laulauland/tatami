import type { Annotation, AnimationSnapshot } from "./types";

/**
 * Format a single animation snapshot for the prompt
 */
function formatAnimation(anim: AnimationSnapshot): string {
  const progress = (anim.progress * 100).toFixed(0);
  const currentMs = anim.currentTime.toFixed(0);
  const durationMs = anim.duration.toFixed(0);

  let line = `  - ${anim.name}: ${currentMs}ms / ${durationMs}ms (${progress}% complete)`;

  if (anim.properties?.length) {
    line += ` [${anim.properties.join(", ")}]`;
  }

  if (anim.easing) {
    line += ` easing: ${anim.easing}`;
  }

  if (anim.iterations && anim.iterations > 1) {
    const iterStr =
      anim.iterations === Infinity ? "infinite" : String(anim.iterations);
    line += ` iteration: ${(anim.currentIteration ?? 0) + 1}/${iterStr}`;
  }

  return line;
}

/**
 * Format a single annotation for the prompt
 */
function formatAnnotation(annotation: Annotation, index: number): string {
  const lines: string[] = [];

  lines.push(`### Annotation ${index + 1}`);
  lines.push("");

  // Element info
  lines.push("**Element:**");
  lines.push("```html");
  lines.push(annotation.element.html);
  lines.push("```");
  lines.push("");

  // Component info (if available)
  if (annotation.element.componentName) {
    lines.push(
      `**Component:** \`${annotation.element.componentName}\`${
        annotation.element.sourceLocation
          ? ` at \`${annotation.element.sourceLocation}\``
          : ""
      }`
    );
    lines.push("");
  }

  // Selector
  lines.push(`**Selector:** \`${annotation.element.selector}\``);
  lines.push("");

  // Animation state
  if (annotation.animations.length > 0) {
    lines.push("**Animation State:**");
    for (const anim of annotation.animations) {
      lines.push(formatAnimation(anim));
    }
    lines.push("");
  }

  // Relevant styles
  const styleEntries = Object.entries(annotation.element.computedStyles);
  if (styleEntries.length > 0) {
    lines.push("**Computed Styles:**");
    lines.push("```css");
    for (const [prop, value] of styleEntries) {
      lines.push(`${prop}: ${value};`);
    }
    lines.push("```");
    lines.push("");
  }

  // User feedback
  lines.push(`**Feedback:** "${annotation.text}"`);
  lines.push("");

  // Position context
  lines.push(
    `*Clicked at (${annotation.position.x.toFixed(0)}, ${annotation.position.y.toFixed(0)}) at ${new Date(annotation.timestamp).toLocaleTimeString()}*`
  );

  return lines.join("\n");
}

/**
 * Generate a full prompt from all annotations
 */
export function generatePrompt(annotations: Annotation[]): string {
  if (annotations.length === 0) {
    return "No annotations captured.";
  }

  const lines: string[] = [];

  lines.push("# Visual Feedback Session");
  lines.push("");
  lines.push(
    `*${annotations.length} annotation${annotations.length > 1 ? "s" : ""} captured*`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // Format each annotation
  for (let i = 0; i < annotations.length; i++) {
    lines.push(formatAnnotation(annotations[i], i));
    if (i < annotations.length - 1) {
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push(
    "Each annotation above captures the exact moment when feedback was given, including:"
  );
  lines.push("- The element's HTML and CSS selector");
  lines.push("- React component name and source location (if available)");
  lines.push(
    "- Animation state at that exact moment (timing, progress, easing)"
  );
  lines.push("- Relevant computed styles");
  lines.push("");
  lines.push(
    "Use this context to understand not just *what* needs to change, but *when* in the animation timeline the issue occurs."
  );

  return lines.join("\n");
}
