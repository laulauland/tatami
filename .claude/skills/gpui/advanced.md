---
name: gpui-advanced
description: GPUI advanced patterns - context menus, tooltips, drag/drop, animations, and performance. Use for complex UI interactions and optimizations.
---

# GPUI Advanced Patterns

## Context Menus

### Building a Context Menu

```rust
use gpui::*;

fn build_context_menu(cx: &mut App) -> Entity<ContextMenu> {
    cx.new(|cx| {
        ContextMenu::build(cx, |menu, _cx| {
            menu.entry("Cut", None, |_cx| { /* handler */ })
                .entry("Copy", None, |_cx| { /* handler */ })
                .entry("Paste", None, |_cx| { /* handler */ })
                .separator()
                .entry("Delete", None, |_cx| { /* handler */ })
        })
    })
}
```

### Showing Context Menu on Right-Click

```rust
div()
    .on_mouse_down(MouseButton::Right, cx.listener(|this, event, window, cx| {
        let menu = build_context_menu(cx);
        window.show_context_menu(event.position, menu, cx);
    }))
```

### Custom Context Menu Items

```rust
ContextMenu::build(cx, |menu, cx| {
    menu.custom(move |window, cx| {
        // Return any element
        div()
            .p_2()
            .child(Label::new("Custom Item"))
            .into_any_element()
    })
    .entry("Normal Entry", None, |_| {})
})
```

## Tooltips

### Simple Tooltip

```rust
div()
    .id("my-button")
    .tooltip(|window, cx| {
        Tooltip::text("Click to save")
    })
    .child("Save")
```

### Tooltip with Keybinding

```rust
div()
    .id("save-button")
    .tooltip(|window, cx| {
        Tooltip::for_action("Save file", &Save, window, cx)
    })
    .child("Save")
```

### Rich Tooltip

```rust
div()
    .id("complex-item")
    .tooltip(|window, cx| {
        Tooltip::rich(
            div()
                .p_2()
                .max_w(px(300.0))
                .child(Label::new("Title").size(LabelSize::Large))
                .child(Label::new("Detailed description here..."))
        )
    })
```

## Drag and Drop

### Draggable Element

```rust
div()
    .id("draggable-item")
    .on_drag(DraggedItem { id: item_id }, |item, window, cx| {
        // Return element shown while dragging
        div()
            .bg(cx.theme().colors().element_background)
            .rounded_md()
            .p_2()
            .child(format!("Dragging: {}", item.id))
    })
    .child("Drag me")
```

### Drop Target

```rust
div()
    .on_drop(cx.listener(|this, item: &DraggedItem, window, cx| {
        this.handle_drop(item.id, cx);
    }))
    .drag_over::<DraggedItem>(|style, _, _, _| {
        style.bg(hsla(0.0, 0.0, 0.5, 0.2))
    })
    .child("Drop here")
```

### Drag State

```rust
struct MyView {
    dragging: Option<DraggedItem>,
}

impl Render for MyView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .when(self.dragging.is_some(), |this| {
                this.opacity(0.5)
            })
            .on_drag_start(cx.listener(|this, item: &DraggedItem, window, cx| {
                this.dragging = Some(item.clone());
            }))
            .on_drag_end(cx.listener(|this, _, window, cx| {
                this.dragging = None;
            }))
    }
}
```

## Popover Menus

```rust
struct MyView {
    popover_handle: PopoverMenuHandle<ContextMenu>,
}

impl Render for MyView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        PopoverMenu::new("my-popover")
            .trigger(
                Button::new("trigger", "Open Menu")
                    .style(ButtonStyle::Ghost)
            )
            .menu(move |window, cx| {
                Some(ContextMenu::build(cx, |menu, _| {
                    menu.entry("Option 1", None, |_| {})
                        .entry("Option 2", None, |_| {})
                }))
            })
            .attach(Corner::BottomLeft)
            .offset(point(px(0.0), px(4.0)))
    }
}

// Programmatic control
self.popover_handle.toggle(window, cx);
self.popover_handle.show(window, cx);
self.popover_handle.hide(cx);
```

## Animations

### Basic Animation

```rust
div()
    .with_animation(
        "fade-in",
        Animation::new(Duration::from_millis(200))
            .with_easing(Easing::EaseOut),
        |style, progress| {
            style.opacity(progress)
        },
    )
```

### Keyframe Animation

```rust
div()
    .with_animation(
        "slide-in",
        Animation::new(Duration::from_millis(300))
            .with_easing(Easing::EaseInOut),
        |style, progress| {
            let offset = px(20.0) * (1.0 - progress);
            style
                .opacity(progress)
                .transform(Transform::translate_y(offset))
        },
    )
```

### Conditional Animation

```rust
div()
    .when(is_visible, |this| {
        this.with_animation(
            "appear",
            Animation::new(Duration::from_millis(150)),
            |style, t| style.opacity(t),
        )
    })
```

## Hover and Click States

```rust
div()
    .id("interactive-item")
    .cursor_pointer()
    .bg(cx.theme().colors().element_background)
    .hover(|style| {
        style.bg(cx.theme().colors().element_hover)
    })
    .active(|style| {
        style.bg(cx.theme().colors().element_active)
    })
    .on_click(cx.listener(|this, _, window, cx| {
        this.handle_click(window, cx);
    }))
```

## Performance Patterns

### Memoization with Cached Elements

```rust
struct MyView {
    cached_expensive_element: Option<AnyElement>,
    cache_key: usize,
}

impl Render for MyView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let current_key = self.compute_cache_key();

        if self.cache_key != current_key || self.cached_expensive_element.is_none() {
            self.cached_expensive_element = Some(self.render_expensive(cx).into_any_element());
            self.cache_key = current_key;
        }

        div().child(self.cached_expensive_element.clone().unwrap())
    }
}
```

### Virtualization for Large Lists

```rust
// Use uniform_list for large datasets
uniform_list(
    self.scroll_handle.clone(),
    "large-list",
    self.items.len(),
    |this, visible_range, window, cx| {
        // Only render visible items
        visible_range
            .map(|ix| this.render_item(ix, window, cx))
            .collect()
    },
)
```

### Pre-fetching Around Viewport

```rust
fn prefetch_around_selection(&self, selected: usize, cx: &mut Context<Self>) {
    let prefetch_before = 2;
    let prefetch_after = 2;

    let start = selected.saturating_sub(prefetch_before);
    let end = (selected + prefetch_after + 1).min(self.items.len());

    for ix in start..end {
        self.ensure_item_loaded(ix, cx);
    }
}
```

### SmallVec for Small Collections

```rust
use smallvec::SmallVec;

// Stack-allocate up to 8 items
let mut highlights: SmallVec<[(Range<usize>, Hsla); 8]> = SmallVec::new();
highlights.push((0..10, hsla(0.0, 1.0, 0.5, 1.0)));
```

## Hitbox Optimization

```rust
impl Element for MyElement {
    fn prepaint(&mut self, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
        // Only insert hitbox if interactive
        if self.is_interactive {
            self.hitbox = Some(window.insert_hitbox(bounds, false));
        }
    }

    fn paint(&mut self, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
        // Check if mouse is over this element
        if let Some(hitbox) = &self.hitbox {
            if hitbox.is_hovered(window) {
                // Paint hover state
            }
        }
    }
}
```

## Scroll Performance

```rust
struct ScrollableView {
    scroll_handle: ScrollHandle,
    last_scroll_position: Point<Pixels>,
}

impl Render for ScrollableView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .overflow_y_scroll()
            .track_scroll(&self.scroll_handle)
            .on_scroll_wheel(cx.listener(|this, event: &ScrollWheelEvent, window, cx| {
                // Custom scroll handling if needed
            }))
            .children(/* ... */)
    }
}
```

## Deferred Rendering (Overlays)

```rust
// Render overlay after other content
fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    div()
        .relative()
        .child(self.render_main_content(cx))
        .child(
            deferred(
                anchored()
                    .position(self.popup_position)
                    .child(self.render_popup(cx))
            )
        )
}
```

## Click Outside to Dismiss

```rust
struct Popup {
    is_open: bool,
}

impl Render for Popup {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.is_open {
            return div().into_any_element();
        }

        // Capture all clicks
        div()
            .absolute()
            .inset(px(0.0))
            .on_mouse_down(MouseButton::Left, cx.listener(|this, event, window, cx| {
                // Check if click is outside popup bounds
                if !this.popup_bounds.contains(&event.position) {
                    this.is_open = false;
                    cx.notify();
                }
            }))
            .child(
                div()
                    .absolute()
                    .top(self.position.y)
                    .left(self.position.x)
                    .child(self.render_popup_content(cx))
            )
            .into_any_element()
    }
}
```

## Keyboard Trap (Modal Focus)

```rust
impl Render for Modal {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .track_focus(&self.focus_handle)
            // Trap tab key within modal
            .on_action(cx.listener(|this, _: &Tab, window, cx| {
                this.focus_next(window, cx);
            }))
            .on_action(cx.listener(|this, _: &ShiftTab, window, cx| {
                this.focus_previous(window, cx);
            }))
            // Dismiss on escape
            .on_action(cx.listener(|this, _: &Escape, window, cx| {
                cx.emit(DismissEvent);
            }))
            .child(/* modal content */)
    }
}
```
