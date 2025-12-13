---
name: gpui-core
description: GPUI framework fundamentals - App, Window, Context, Entity system, and lifecycle. Use when creating GPUI applications, managing state, or understanding the framework architecture.
---

# GPUI Core Concepts

GPUI is a hybrid immediate/retained-mode, GPU-accelerated UI framework from the Zed editor.

## Application Lifecycle

```rust
use gpui::*;

fn main() {
    Application::new().run(|cx: &mut App| {
        cx.open_window(
            WindowOptions::default(),
            |window, cx| {
                cx.new(|cx| MyView::new(cx))
            },
        ).unwrap();
    });
}
```

## The Render Trait

Views must implement `Render`:

```rust
struct MyView {
    count: usize,
}

impl Render for MyView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .size_full()
            .child(format!("Count: {}", self.count))
    }
}
```

## Entity System

Entities are the core state containers. Use `Entity<T>` for strong references, `WeakEntity<T>` for weak:

```rust
// Create an entity
let entity: Entity<MyModel> = cx.new(|cx| MyModel::new());

// Read entity state
let value = entity.read(cx).some_field;

// Update entity state
entity.update(cx, |model, cx| {
    model.some_field = new_value;
    cx.notify(); // Trigger re-render
});

// Weak reference (won't keep entity alive)
let weak: WeakEntity<MyModel> = entity.downgrade();
if let Some(entity) = weak.upgrade() {
    // Entity still exists
}
```

## Context Types

Different contexts for different scopes:

| Context | Purpose |
|---------|---------|
| `App` / `&mut App` | Global app state access |
| `Context<T>` | Entity-specific context for mutations |
| `Window` / `&mut Window` | Window-specific operations |
| `AsyncApp` | Async-safe app context |
| `AsyncWindowContext` | Async-safe window context |

```rust
// In a view method
fn some_method(&mut self, window: &mut Window, cx: &mut Context<Self>) {
    // cx.notify() triggers re-render
    // cx.emit(event) emits events
    // cx.spawn() spawns async tasks
    // window.focus() manages focus
}
```

## Subscriptions and Observations

Subscribe to entity events:

```rust
// Subscribe to events from another entity
let subscription = cx.subscribe(&other_entity, |this, emitter, event, cx| {
    // Handle event
});

// Observe any changes (when notify() is called)
let subscription = cx.observe(&other_entity, |this, observed, cx| {
    // Entity was updated
});

// Observe global state changes
let subscription = cx.observe_global::<MyGlobal>(|this, cx| {
    // Global changed
});

// Subscriptions auto-cleanup on drop - store them to keep alive
struct MyView {
    _subscriptions: Vec<Subscription>,
}
```

## Global State

For app-wide state:

```rust
// Define a global
struct AppState {
    user: Option<User>,
}
impl Global for AppState {}

// Set global (once at startup)
cx.set_global(AppState { user: None });

// Read global
let state = cx.global::<AppState>();

// Update global
cx.update_global::<AppState, _>(|state, cx| {
    state.user = Some(user);
});
```

## Event Emitting

Entities can emit typed events:

```rust
struct MyView;

// Define event types
struct SelectionChanged(usize);

// Implement EventEmitter
impl EventEmitter<SelectionChanged> for MyView {}

// Emit events
fn select(&mut self, index: usize, cx: &mut Context<Self>) {
    cx.emit(SelectionChanged(index));
}

// Subscribe from another entity
cx.subscribe(&my_view, |this, _emitter, event: &SelectionChanged, cx| {
    println!("Selected: {}", event.0);
});
```

## Focus Management

```rust
impl MyView {
    fn new(cx: &mut Context<Self>) -> Self {
        let focus_handle = cx.focus_handle();

        // React to focus changes
        cx.on_focus(&focus_handle, window, Self::handle_focus);
        cx.on_blur(&focus_handle, window, Self::handle_blur);

        Self { focus_handle }
    }
}

// In render, make element focusable
div()
    .track_focus(&self.focus_handle)
    .child("Focusable content")

// Programmatically focus
window.focus(&self.focus_handle);
```

## Deferred Execution

```rust
// Run after current update cycle
cx.defer(|cx| {
    // Deferred work
});

// Run in window context after update
cx.defer_in(window, |this, window, cx| {
    window.focus(&this.focus_handle);
});
```

## Notify for Re-renders

Call `cx.notify()` to trigger re-render when state changes:

```rust
fn increment(&mut self, cx: &mut Context<Self>) {
    self.count += 1;
    cx.notify(); // Required to update UI
}
```
