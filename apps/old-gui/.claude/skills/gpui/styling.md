---
name: gpui-styling
description: GPUI styling system - flexbox, colors, spacing, theming. Use when styling components, working with themes, or building layouts.
---

# GPUI Styling

GPUI uses a Tailwind-like builder pattern for styling via the `Styled` trait.

## Flexbox Layout

```rust
// Horizontal layout
div()
    .flex()
    .flex_row()        // Default direction
    .items_center()    // Cross-axis alignment
    .gap_2()           // Gap between children

// Vertical layout
div()
    .flex()
    .flex_col()
    .gap_3()

// Shorthand helpers (if available via StyledExt)
h_flex()  // flex + flex_row + items_center
v_flex()  // flex + flex_col
```

### Main Axis Alignment (justify)

```rust
.justify_start()      // Pack at start
.justify_center()     // Center items
.justify_end()        // Pack at end
.justify_between()    // Space between items
.justify_around()     // Space around items
.justify_evenly()     // Equal spacing
```

### Cross Axis Alignment (items/align)

```rust
.items_start()        // Align to start
.items_center()       // Center align
.items_end()          // Align to end
.items_baseline()     // Baseline align
.items_stretch()      // Stretch to fill
```

### Flex Item Properties

```rust
.flex_1()             // Grow and shrink equally (flex: 1 1 0)
.flex_auto()          // Grow/shrink based on content
.flex_initial()       // Don't grow, can shrink
.flex_none()          // Don't grow or shrink
.flex_grow()          // Allow growing
.flex_shrink()        // Allow shrinking
.flex_shrink_0()      // Prevent shrinking
```

## Sizing

```rust
// Fixed sizes
.w(px(200.0))         // Width in pixels
.h(px(100.0))         // Height in pixels
.size(px(50.0))       // Width and height

// Relative sizes
.w_full()             // 100% width
.h_full()             // 100% height
.size_full()          // 100% both
.w_half()             // 50% width
.min_w(px(100.0))     // Minimum width
.max_w(px(500.0))     // Maximum width

// Aspect ratio
.aspect_ratio(16.0 / 9.0)
```

## Spacing

### Padding

```rust
.p(px(16.0))          // All sides
.p_1() / .p_2() / .p_3() / .p_4()  // Preset sizes
.px_2()               // Horizontal (left + right)
.py_2()               // Vertical (top + bottom)
.pt_2()               // Top only
.pb_2()               // Bottom only
.pl_2()               // Left only
.pr_2()               // Right only
```

### Margin

```rust
.m(px(8.0))           // All sides
.m_1() / .m_2() / .m_3() / .m_4()
.mx_auto()            // Center horizontally
.my_2()               // Vertical margin
.mt_2() / .mb_2() / .ml_2() / .mr_2()  // Individual sides
```

### Gap

```rust
.gap(px(8.0))         // Gap between flex children
.gap_1() / .gap_2() / .gap_3() / .gap_4()
.gap_x(px(8.0))       // Horizontal gap only
.gap_y(px(4.0))       // Vertical gap only
```

## Colors and Backgrounds

```rust
// Background
.bg(hsla(0.0, 0.0, 0.2, 1.0))           // HSLA color
.bg(rgb(0x1a1a1a))                       // RGB hex
.bg(cx.theme().colors().background)      // Theme color

// Text color (cascades to children)
.text_color(hsla(0.0, 0.0, 1.0, 1.0))
.text_color(cx.theme().colors().text)

// Opacity
.opacity(0.5)
```

## Borders

```rust
.border_1()           // 1px border all sides
.border_2()           // 2px border
.border_t_1()         // Top border only
.border_b_1()         // Bottom border only
.border_l_1()         // Left only
.border_r_1()         // Right only

.border_color(hsla(0.0, 0.0, 0.3, 1.0))
.border_color(cx.theme().colors().border)
```

## Corner Radius

```rust
.rounded(px(4.0))     // Custom radius
.rounded_sm()         // Small
.rounded_md()         // Medium
.rounded_lg()         // Large
.rounded_xl()         // Extra large
.rounded_full()       // Fully rounded (pill shape)
.rounded_none()       // No rounding
```

## Shadows

```rust
.shadow_sm()          // Small shadow
.shadow_md()          // Medium shadow
.shadow_lg()          // Large shadow
.shadow_xl()          // Extra large shadow
```

## Text Styling

```rust
// Size
.text_xs()            // 12px
.text_sm()            // 14px
.text_base()          // 16px
.text_lg()            // 18px
.text_xl()            // 20px
.text_2xl()           // 24px
.text_size(px(18.0))  // Custom size

// Weight
.font_weight(FontWeight::BOLD)

// Alignment
.text_left()
.text_center()
.text_right()

// Overflow
.truncate()           // Ellipsis with nowrap
.line_clamp(2)        // Max 2 lines
.whitespace_nowrap()  // No wrapping
.overflow_hidden()    // Hide overflow

// Decoration
.underline()
.line_through()
```

## Positioning

```rust
.relative()           // Position relative
.absolute()           // Position absolute

// Inset (for absolute positioned elements)
.top(px(10.0))
.bottom(px(10.0))
.left(px(10.0))
.right(px(10.0))
.inset(px(0.0))       // All sides
```

## Overflow

```rust
.overflow_hidden()    // Clip overflow
.overflow_scroll()    // Scrollable
.overflow_x_scroll()  // Horizontal scroll
.overflow_y_scroll()  // Vertical scroll
.overflow_visible()   // Show overflow
```

## Cursor

```rust
.cursor_default()
.cursor_pointer()
.cursor_text()
.cursor_move()
.cursor_not_allowed()
```

## Visibility

```rust
.visible()
.invisible()          // Hidden but takes space
```

## Theme Integration

Access theme colors consistently:

```rust
fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
    let colors = cx.theme().colors();

    div()
        .bg(colors.surface_background)
        .border_color(colors.border)
        .text_color(colors.text)
        .child("Themed content")
}
```

### Common Theme Colors

```rust
colors.background              // App background
colors.surface_background      // Surface/panel background
colors.elevated_surface_background  // Elevated elements
colors.text                    // Primary text
colors.text_muted              // Secondary text
colors.text_disabled           // Disabled text
colors.border                  // Primary borders
colors.border_variant          // Secondary borders
colors.border_focused          // Focused element border
colors.element_background      // Interactive element bg
colors.element_hover           // Hover state
colors.element_active          // Active/pressed state
colors.element_selected        // Selected state
```

## Conditional Styling

```rust
div()
    .when(is_selected, |this| {
        this.bg(cx.theme().colors().element_selected)
    })
    .when(is_hovered, |this| {
        this.bg(cx.theme().colors().element_hover)
    })
    .when_some(custom_color, |this, color| {
        this.bg(color)
    })
```

## Debug Helpers

```rust
// Temporarily visualize layout
.debug_bg_red()
.debug_bg_green()
.debug_bg_blue()
```
