import type { AnimationSnapshot } from "./types";

/**
 * Get a CSS selector path for an element
 */
export function getSelector(el: Element): string {
  if (el.id) return `#${el.id}`;

  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector = `#${current.id}`;
      parts.unshift(selector);
      break;
    }

    if (current.className && typeof current.className === "string") {
      const classes = current.className.trim().split(/\s+/).slice(0, 2);
      if (classes.length > 0 && classes[0]) {
        selector += `.${classes.join(".")}`;
      }
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    parts.unshift(selector);
    current = parent;
  }

  return parts.join(" > ");
}

/**
 * Get animation snapshots for a specific element (captures current state)
 */
export function getElementAnimations(element: Element): AnimationSnapshot[] {
  const animations = element.getAnimations({ subtree: false });
  const snapshots: AnimationSnapshot[] = [];

  for (const anim of animations) {
    const effect = anim.effect;
    const target = effect?.target as Element | null;
    if (!target) continue;

    const timing = effect?.getComputedTiming();
    const currentTime = anim.currentTime ?? 0;
    const duration =
      typeof timing?.duration === "number" ? timing.duration : 0;
    const progress = timing?.progress ?? 0;

    let name = "animation";
    let easing: string | undefined;
    let properties: string[] | undefined;

    if (anim instanceof CSSAnimation) {
      name = anim.animationName;
    } else if (anim instanceof CSSTransition) {
      name = "transition";
      properties = [anim.transitionProperty];
    }

    if (effect instanceof KeyframeEffect) {
      const keyframeTiming = effect.getTiming();
      easing =
        typeof keyframeTiming.easing === "string"
          ? keyframeTiming.easing
          : undefined;
    }

    snapshots.push({
      targetId: getSelector(target),
      selector: getSelector(target),
      name,
      currentTime: Number(currentTime),
      duration,
      progress,
      playState: anim.playState,
      properties,
      easing,
      iterations: timing?.iterations ?? 1,
      currentIteration: timing?.currentIteration ?? 0,
    });
  }

  return snapshots;
}
