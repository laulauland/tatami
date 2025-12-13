---
name: gpui-elements
description: GPUI element system - div, text, lists, images, and custom elements. Use when building UI components, creating layouts, or implementing custom rendering.
---

# GPUI Elements

Elements are the building blocks of GPUI UIs. They follow a three-phase rendering pipeline.

## Basic Elements

### Div (Container)

The primary container element:

```rust
div()
    .id("my-container")
    .flex()
    .flex_col()
    .gap_2()
    .p_4()
    .bg(cx.theme().colors().surface_background)
    .child(Label::new("Hello"))
    .child(Button::new("btn", "Click me"))
```

### Text

For text content:

```rust
// Simple text (converts to element)
"Hello, World!"

// Styled text
div()
    .text_color(hsla(0.0, 0.0, 1.0, 1.0))
    .text_size(px(16.0))
    .child("Styled text")

// Shaped text with runs (for syntax highlighting)
let line = window.text_system().shape_line(
    text.into(),
    font_size,
    &[TextRun { len: text.len(), font, color }],
    None,
);
```

### Images

```rust
img(image_source)
    .size(px(100.0))
    .rounded_md()

// From file path
img(PathBuf::from("/path/to/image.png"))

// SVG icon
svg()
    .path("icons/check.svg")
    .size(px(16.0))
    .text_color(Color::Success.color(cx))
```

## Lists

### Uniform List (same height items)

For large lists with uniform item heights - renders only visible items:

```rust
uniform_list(
    self.scroll_handle.clone(),
    "item-list",
    items.len(),
    |this, visible_range, window, cx| {
        visible_range
            .map(|ix| this.render_item(ix, window, cx))
            .collect()
    },
)
.track_scroll(self.scroll_handle.clone())
```

### List (variable height items)

For lists with variable item heights:

```rust
list(self.list_state.clone())
    .size_full()
    .with_sizing_behavior(ListSizingBehavior::Auto)
```

### Scroll Handle

```rust
struct MyView {
    scroll_handle: UniformListScrollHandle,
}

impl MyView {
    fn new() -> Self {
        Self {
            scroll_handle: UniformListScrollHandle::new(),
        }
    }

    fn scroll_to_item(&mut self, index: usize) {
        self.scroll_handle.scroll_to_item(index, ScrollStrategy::Center);
    }
}
```

## The Element Trait

Custom elements implement the three-phase pipeline:

```rust
impl Element for MyElement {
    type RequestLayoutState = MyLayoutState;
    type PrepaintState = MyPrepaintState;

    // Phase 1: Request layout from Taffy
    fn request_layout(
        &mut self,
        id: Option<&GlobalElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = px(100.).into();

        let layout_id = window.request_layout(style, None, cx);
        (layout_id, MyLayoutState { /* ... */ })
    }

    // Phase 2: Prepaint - calculate bounds, insert hitboxes
    fn prepaint(
        &mut self,
        id: Option<&GlobalElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        // Insert hitbox for click detection
        let hitbox = window.insert_hitbox(bounds, false);

        MyPrepaintState { hitbox, bounds }
    }

    // Phase 3: Paint to canvas
    fn paint(
        &mut self,
        id: Option<&GlobalElementId>,
        bounds: Bounds<Pixels>,
        state: &mut Self::RequestLayoutState,
        prepaint: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        // Paint background
        window.paint_quad(fill(bounds, cx.theme().colors().background));

        // Paint text, shapes, etc.
    }
}
```

## RenderOnce vs Render

- `Render` - For stateful views (takes `&mut self`)
- `RenderOnce` - For stateless components (takes owned `self`)

```rust
// Stateful view
impl Render for MyView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div().child("stateful")
    }
}

// Stateless component
struct MyComponent {
    label: SharedString,
}

impl RenderOnce for MyComponent {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        div().child(self.label)
    }
}

// Use stateless component
div().child(MyComponent { label: "hello".into() })
```

## IntoElement Trait

Types that can become elements:

```rust
// Strings
"hello"  // impl IntoElement

// Options (renders nothing for None)
let maybe_label: Option<Label> = Some(Label::new("hi"));
div().child(maybe_label)

// Vectors
let items: Vec<impl IntoElement> = vec![...];
div().children(items)
```

## Deferred Elements

Render later in the paint order (for overlays):

```rust
deferred(
    div()
        .absolute()
        .child("Overlay content")
)
```

## Anchored Elements (Popovers)

Position relative to an anchor:

```rust
anchored()
    .position(AnchoredPosition::Below(anchor_bounds))
    .child(
        div()
            .elevation_3(cx)
            .child("Popover content")
    )
```

## Canvas (Custom Drawing)

For imperative drawing:

```rust
canvas(
    |bounds, window, cx| {
        // Prepaint phase - return state
        PrepaintState { bounds }
    },
    |bounds, state, window, cx| {
        // Paint phase
        window.paint_quad(fill(bounds, hsla(0.0, 1.0, 0.5, 1.0)));
    },
)
```

## Parent Element Methods

```rust
div()
    .child(single_element)           // Add one child
    .children(vec_of_elements)       // Add multiple children
    .children_any(any_elements)      // Add AnyElement children
    .when(condition, |this| {        // Conditional children
        this.child(Label::new("Shown when true"))
    })
    .when_some(option, |this, value| {
        this.child(Label::new(value))
    })
```
