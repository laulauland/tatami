---
name: gpui-keyboard-actions
description: GPUI keyboard handling, actions, and keybindings. Use when implementing keyboard navigation, shortcuts, or action dispatch.
---

# GPUI Keyboard and Actions

## Defining Actions

Actions are the bridge between keybindings and behavior:

```rust
use gpui::actions;

// Simple actions (no data)
actions!(my_app, [
    MoveUp,
    MoveDown,
    SelectAll,
    Delete,
    Confirm,
    Cancel,
]);

// Action with data
#[derive(Clone, PartialEq, Deserialize)]
struct GoToLine {
    line: usize,
}

impl_actions!(my_app, [GoToLine]);
```

## Registering Action Handlers

In your view's render or setup:

```rust
impl Render for MyView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Register actions on the element
        div()
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::move_up))
            .on_action(cx.listener(Self::move_down))
            .on_action(cx.listener(Self::select_all))
            .child(/* ... */)
    }
}

impl MyView {
    fn move_up(&mut self, _: &MoveUp, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_index = self.selected_index.saturating_sub(1);
        cx.notify();
    }

    fn move_down(&mut self, _: &MoveDown, window: &mut Window, cx: &mut Context<Self>) {
        self.selected_index = (self.selected_index + 1).min(self.items.len() - 1);
        cx.notify();
    }
}
```

## Keybindings

Bind keys to actions in your keymap:

```rust
// In app setup
cx.bind_keys([
    KeyBinding::new("up", MoveUp, None),
    KeyBinding::new("down", MoveDown, None),
    KeyBinding::new("enter", Confirm, None),
    KeyBinding::new("escape", Cancel, None),
    KeyBinding::new("cmd-a", SelectAll, None),  // macOS
    KeyBinding::new("ctrl-a", SelectAll, None), // Linux/Windows
]);
```

### Key Syntax

```rust
// Modifiers
"cmd-s"      // Command (macOS)
"ctrl-s"     // Control
"alt-s"      // Alt/Option
"shift-s"    // Shift
"cmd-shift-s" // Multiple modifiers

// Special keys
"enter"
"escape"
"tab"
"space"
"backspace"
"delete"
"up" / "down" / "left" / "right"
"home" / "end"
"pageup" / "pagedown"
"f1" through "f12"
```

## Key Context

Bind actions only in specific contexts:

```rust
// Define context
window.set_key_context(KeyContext::new_with_defaults());

// Bind with context
KeyBinding::new("j", MoveDown, Some("Editor"))
KeyBinding::new("j", NextItem, Some("List"))
```

In render, set the context:

```rust
div()
    .key_context("Editor")  // This subtree uses "Editor" context
    .on_action(cx.listener(Self::move_down))
```

## Direct Key Event Handling

For custom key handling without actions:

```rust
div()
    .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
        match &event.keystroke.key {
            "j" if event.keystroke.modifiers.control => {
                this.move_down(window, cx);
            }
            _ => {}
        }
    }))
```

## Key Event Types

```rust
// Key down
.on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
    let key = &event.keystroke.key;
    let mods = &event.keystroke.modifiers;
    // mods.control, mods.alt, mods.shift, mods.platform (cmd on mac)
}))

// Key up
.on_key_up(cx.listener(|this, event: &KeyUpEvent, window, cx| {
    // Handle key release
}))

// Modifiers changed (for UI feedback)
.on_modifiers_changed(cx.listener(|this, event: &ModifiersChangedEvent, window, cx| {
    this.alt_held = event.modifiers.alt;
    cx.notify();
}))
```

## Focus and Action Dispatch

Actions bubble up from the focused element:

```rust
struct MyView {
    focus_handle: FocusHandle,
}

impl MyView {
    fn new(cx: &mut Context<Self>) -> Self {
        Self {
            focus_handle: cx.focus_handle(),
        }
    }
}

impl Render for MyView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            // Make this element focusable
            .track_focus(&self.focus_handle)
            // Register action handlers
            .on_action(cx.listener(Self::handle_action))
    }
}
```

## Dispatching Actions Programmatically

```rust
// Dispatch to focused element
window.dispatch_action(Box::new(MoveDown));

// Dispatch with data
window.dispatch_action(Box::new(GoToLine { line: 42 }));
```

## Action Availability

Check if an action is available:

```rust
if window.is_action_available(&MoveDown) {
    // Action has a handler in the current focus context
}
```

## Keyboard Navigation Pattern

Common pattern for list navigation:

```rust
struct ListView {
    items: Vec<Item>,
    selected: usize,
    focus_handle: FocusHandle,
}

impl Render for ListView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::select_prev))
            .on_action(cx.listener(Self::select_next))
            .on_action(cx.listener(Self::confirm_selection))
            .children(
                self.items.iter().enumerate().map(|(i, item)| {
                    self.render_item(i, item, cx)
                })
            )
    }
}

impl ListView {
    fn select_prev(&mut self, _: &SelectPrev, _window: &mut Window, cx: &mut Context<Self>) {
        self.selected = self.selected.saturating_sub(1);
        cx.notify();
    }

    fn select_next(&mut self, _: &SelectNext, _window: &mut Window, cx: &mut Context<Self>) {
        if self.selected < self.items.len().saturating_sub(1) {
            self.selected += 1;
        }
        cx.notify();
    }

    fn confirm_selection(&mut self, _: &Confirm, _window: &mut Window, cx: &mut Context<Self>) {
        if let Some(item) = self.items.get(self.selected) {
            cx.emit(ItemSelected(item.clone()));
        }
    }
}
```

## Input Method (IME) Handling

For text input with IME support:

```rust
impl InputHandler for MyEditor {
    fn text_for_range(&mut self, range: Range<usize>, cx: &mut Window) -> Option<String> {
        // Return text in range
    }

    fn selected_text_range(&mut self, ignore_disabled: bool, cx: &mut Window) -> Option<Range<usize>> {
        // Return current selection
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        cx: &mut Window,
    ) {
        // Insert/replace text
    }

    fn marked_text_range(&self, cx: &mut Window) -> Option<Range<usize>> {
        // Return IME composition range
    }

    // ... other methods
}
```
