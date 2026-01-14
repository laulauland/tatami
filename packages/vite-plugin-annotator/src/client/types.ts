/**
 * Snapshot of a single animation's state at capture time
 */
export interface AnimationSnapshot {
  /** Target element's annotator ID */
  targetId: string;
  /** CSS selector path to element */
  selector: string;
  /** Animation name (from @keyframes) or 'transition' */
  name: string;
  /** Current time in milliseconds */
  currentTime: number;
  /** Total duration in milliseconds */
  duration: number;
  /** Progress from 0 to 1 */
  progress: number;
  /** Play state when captured */
  playState: AnimationPlayState;
  /** CSS properties being animated */
  properties?: string[];
  /** Easing function */
  easing?: string;
  /** Number of iterations (Infinity for infinite) */
  iterations?: number;
  /** Current iteration */
  currentIteration?: number;
}

/**
 * Context captured for an annotated element
 */
export interface ElementContext {
  /** Outer HTML (truncated) */
  html: string;
  /** CSS selector path */
  selector: string;
  /** Bounding rect at capture time */
  rect: DOMRect;
  /** Computed styles (subset) */
  computedStyles: Record<string, string>;
  /** React component name (via bippy) */
  componentName?: string;
  /** Source file location (via bippy) */
  sourceLocation?: string;
}

/**
 * A single annotation with all captured context
 */
export interface Annotation {
  id: string;
  /** User's feedback text */
  text: string;
  /** Timestamp when annotation was created */
  timestamp: number;
  /** Click coordinates */
  position: { x: number; y: number };
  /** Element context */
  element: ElementContext;
  /** Animation states at capture time */
  animations: AnimationSnapshot[];
}

/**
 * Annotator state
 */
export interface AnnotatorState {
  /** Is the annotator active (paused and accepting annotations) */
  isActive: boolean;
  /** Is currently paused */
  isPaused: boolean;
  /** All annotations */
  annotations: Annotation[];
  /** Currently selected annotation ID */
  selectedId: string | null;
  /** Element being hovered while active */
  hoveredElement: Element | null;
}
