---
name: gpui
description: GPUI framework for building GPU-accelerated UIs in Rust. Use when working with GPUI, building Zed-like applications, or implementing complex UI components.
---

# GPUI Framework

GPUI is a hybrid immediate/retained-mode, GPU-accelerated UI framework from the Zed editor.

## Skill Components

This skill is organized into focused modules:

| Skill | Use When |
|-------|----------|
| `gpui-core` | App lifecycle, entities, contexts, subscriptions |
| `gpui-elements` | Building UI with div, text, lists, custom elements |
| `gpui-styling` | Flexbox layout, colors, theming, spacing |
| `gpui-keyboard-actions` | Keyboard handling, actions, keybindings |
| `gpui-async-windows` | Async tasks, multiple windows, modals |
| `gpui-text-editing` | Text rendering, editing, diffs, syntax highlighting |
| `gpui-advanced` | Context menus, drag/drop, animations, performance |

## Quick Reference

### Minimal App

```rust
use gpui::*;

fn main() {
    Application::new().run(|cx: &mut App| {
        cx.open_window(WindowOptions::default(), |window, cx| {
            cx.new(|_| MyView { count: 0 })
        }).unwrap();
    });
}

struct MyView { count: usize }

impl Render for MyView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .flex()
            .size_full()
            .justify_center()
            .items_center()
            .bg(cx.theme().colors().background)
            .child(format!("Count: {}", self.count))
    }
}
```

### Common Patterns

```rust
// Flexbox container
div().flex().flex_col().gap_2().p_4()

// Horizontal layout with centered items
div().flex().flex_row().items_center().gap_2()

// Full-size element
div().size_full()

// Theme colors
.bg(cx.theme().colors().surface_background)
.text_color(cx.theme().colors().text)
.border_color(cx.theme().colors().border)

// Interactive element
div()
    .id("my-button")
    .cursor_pointer()
    .on_click(cx.listener(|this, _, window, cx| {
        this.handle_click(window, cx);
    }))

// Focus management
div()
    .track_focus(&self.focus_handle)
    .on_action(cx.listener(Self::handle_action))

// Async task
cx.spawn_in(window, async move |this, cx| {
    let data = fetch_data().await;
    this.update(&mut cx, |view, _, cx| {
        view.data = data;
        cx.notify();
    }).ok();
}).detach();
```

### Element Lifecycle

1. `request_layout()` - Request size from Taffy layout engine
2. `prepaint()` - Calculate bounds, insert hitboxes
3. `paint()` - Draw to canvas

### Key Traits

| Trait | Purpose |
|-------|---------|
| `Render` | Stateful views with `&mut self` |
| `RenderOnce` | Stateless components with owned `self` |
| `Element` | Custom rendering with full control |
| `IntoElement` | Convert to element (strings, options, etc.) |
| `Styled` | Styling methods (fluent builder) |
| `EventEmitter<E>` | Emit typed events |
| `Global` | App-wide state |

### Context Types

| Context | Scope |
|---------|-------|
| `App` | Global app access |
| `Context<T>` | Entity mutations |
| `Window` | Window operations |
| `AsyncApp` | Async-safe app |
| `AsyncWindowContext` | Async-safe window |

## Dependencies

```toml
[dependencies]
gpui = { git = "https://github.com/zed-industries/zed" }
```

## Resources

- Zed source: https://github.com/zed-industries/zed
- GPUI crate: `zed/crates/gpui/`
- UI components: `zed/crates/ui/`
