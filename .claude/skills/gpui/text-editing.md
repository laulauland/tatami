---
name: gpui-text-editing
description: GPUI text rendering, editing, and display mapping. Use when implementing text editors, syntax highlighting, or diff views.
---

# GPUI Text Editing

Patterns from Zed's editor for text rendering and editing.

## Text System Basics

### Shaping Text

```rust
// Shape a line of text for rendering
let line = window.text_system().shape_line(
    text.into(),           // SharedString
    font_size,             // Pixels
    &[TextRun {
        len: text.len(),
        font: font.clone(),
        color: text_color,
        background_color: None,
        underline: None,
        strikethrough: None,
    }],
    None, // wrap_width
)?;

// Get line dimensions
let width = line.width;
let ascent = line.ascent;
let descent = line.descent;
```

### Multiple Text Runs (Syntax Highlighting)

```rust
// Build runs from highlight spans
let mut runs = Vec::new();
let mut offset = 0;

for (range, style) in highlights {
    if range.start > offset {
        // Unstyled gap
        runs.push(TextRun {
            len: range.start - offset,
            font: default_font.clone(),
            color: default_color,
            ..Default::default()
        });
    }

    runs.push(TextRun {
        len: range.end - range.start,
        font: style.font.unwrap_or(default_font.clone()),
        color: style.color.unwrap_or(default_color),
        underline: style.underline,
        ..Default::default()
    });

    offset = range.end;
}

let shaped = window.text_system().shape_line(text, font_size, &runs, None)?;
```

### Line Wrapping

```rust
// Create a line wrapper
let mut wrapper = window.text_system().line_wrapper(font.clone(), font_size);

// Wrap text to width
let wrap_boundaries = wrapper.wrap_line(&text, wrap_width);
// Returns indices where line breaks should occur
```

## Display Mapping (Zed's Pattern)

Zed uses layered transformations for display mapping:

```
Buffer Text
    ↓ InlayMap (insert inlay hints)
    ↓ FoldMap (collapse folded regions)
    ↓ TabMap (expand tabs to spaces)
    ↓ WrapMap (soft line wrapping)
    ↓ BlockMap (insert block decorations)
Display Text
```

### Basic Display Point Conversion

```rust
// Buffer position to display position
struct DisplayMap {
    buffer: Entity<Buffer>,
    wrap_width: Option<Pixels>,
}

impl DisplayMap {
    fn buffer_point_to_display(&self, point: Point, cx: &App) -> DisplayPoint {
        let buffer = self.buffer.read(cx);
        // Apply transformations...
        DisplayPoint { row, column }
    }

    fn display_point_to_buffer(&self, display: DisplayPoint, cx: &App) -> Point {
        // Reverse transformations...
        Point { row, column }
    }
}

// Display point for rendering
#[derive(Clone, Copy)]
struct DisplayPoint {
    row: u32,
    column: u32,
}
```

## Selection Rendering

```rust
struct SelectionLayout {
    range: Range<DisplayPoint>,
    head: DisplayPoint,        // Cursor position
    is_newest: bool,           // Primary selection
    cursor_shape: CursorShape,
}

impl SelectionLayout {
    fn from_selection(
        selection: &Selection,
        map: &DisplayMap,
        cx: &App,
    ) -> Self {
        let start = map.buffer_point_to_display(selection.start, cx);
        let end = map.buffer_point_to_display(selection.end, cx);

        Self {
            range: start..end,
            head: if selection.reversed { start } else { end },
            is_newest: selection.is_primary,
            cursor_shape: CursorShape::Bar,
        }
    }
}

// Render selection highlight
fn paint_selection(
    &self,
    selection: &SelectionLayout,
    line_height: Pixels,
    window: &mut Window,
    cx: &App,
) {
    let color = cx.theme().colors().selection;

    for row in selection.range.start.row..=selection.range.end.row {
        let start_x = if row == selection.range.start.row {
            self.x_for_column(row, selection.range.start.column)
        } else {
            Pixels::ZERO
        };

        let end_x = if row == selection.range.end.row {
            self.x_for_column(row, selection.range.end.column)
        } else {
            self.line_width(row)
        };

        let y = self.y_for_row(row);
        let bounds = Bounds {
            origin: point(start_x, y),
            size: size(end_x - start_x, line_height),
        };

        window.paint_quad(fill(bounds, color));
    }
}
```

## Cursor Rendering

```rust
enum CursorShape {
    Bar,
    Block,
    Underline,
    Hollow,
}

fn paint_cursor(
    &self,
    position: DisplayPoint,
    shape: CursorShape,
    color: Hsla,
    line_height: Pixels,
    window: &mut Window,
) {
    let x = self.x_for_column(position.row, position.column);
    let y = self.y_for_row(position.row);

    let bounds = match shape {
        CursorShape::Bar => Bounds {
            origin: point(x, y),
            size: size(px(2.0), line_height),
        },
        CursorShape::Block => Bounds {
            origin: point(x, y),
            size: size(self.char_width, line_height),
        },
        CursorShape::Underline => Bounds {
            origin: point(x, y + line_height - px(2.0)),
            size: size(self.char_width, px(2.0)),
        },
        CursorShape::Hollow => {
            // Paint outline
            let bounds = Bounds {
                origin: point(x, y),
                size: size(self.char_width, line_height),
            };
            window.paint_quad(outline(bounds, color));
            return;
        }
    };

    window.paint_quad(fill(bounds, color));
}
```

## Diff Hunks

```rust
#[derive(Clone)]
enum DiffHunkStatus {
    Added,
    Modified,
    Deleted,
}

struct DiffHunk {
    buffer_range: Range<Point>,
    status: DiffHunkStatus,
}

// Render diff indicators in gutter
fn paint_diff_hunks(
    &self,
    hunks: &[DiffHunk],
    gutter_width: Pixels,
    line_height: Pixels,
    window: &mut Window,
    cx: &App,
) {
    let colors = cx.theme().colors();

    for hunk in hunks {
        let color = match hunk.status {
            DiffHunkStatus::Added => colors.created,
            DiffHunkStatus::Modified => colors.modified,
            DiffHunkStatus::Deleted => colors.deleted,
        };

        let start_y = self.y_for_row(hunk.buffer_range.start.row);
        let end_y = self.y_for_row(hunk.buffer_range.end.row);
        let height = end_y - start_y + line_height;

        let indicator_bounds = Bounds {
            origin: point(gutter_width - px(3.0), start_y),
            size: size(px(2.0), height),
        };

        window.paint_quad(fill(indicator_bounds, color));
    }
}
```

## Inline Diagnostics

```rust
struct Diagnostic {
    range: Range<Point>,
    severity: DiagnosticSeverity,
    message: String,
}

enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
    Hint,
}

// Underline diagnostic ranges
fn paint_diagnostic_underline(
    &self,
    diagnostic: &Diagnostic,
    window: &mut Window,
    cx: &App,
) {
    let color = match diagnostic.severity {
        DiagnosticSeverity::Error => cx.theme().colors().error,
        DiagnosticSeverity::Warning => cx.theme().colors().warning,
        DiagnosticSeverity::Info => cx.theme().colors().info,
        DiagnosticSeverity::Hint => cx.theme().colors().hint,
    };

    // Paint wavy underline for error range
    let start = self.point_to_pixel(diagnostic.range.start);
    let end = self.point_to_pixel(diagnostic.range.end);

    // Use wavy line path or simple underline
    window.paint_underline(start, end, color, UnderlineStyle::Wavy);
}
```

## Gutter Elements

```rust
fn render_gutter(
    &self,
    visible_rows: Range<u32>,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let line_height = self.line_height;
    let gutter_width = self.gutter_width;

    div()
        .w(gutter_width)
        .h_full()
        .flex()
        .flex_col()
        .children(visible_rows.map(|row| {
            self.render_gutter_row(row, line_height, cx)
        }))
}

fn render_gutter_row(
    &self,
    row: u32,
    line_height: Pixels,
    cx: &App,
) -> impl IntoElement {
    let line_number = row + 1;
    let is_current = row == self.cursor_row;

    div()
        .h(line_height)
        .w_full()
        .flex()
        .items_center()
        .justify_end()
        .pr_2()
        .text_color(if is_current {
            cx.theme().colors().text
        } else {
            cx.theme().colors().text_muted
        })
        .child(format!("{}", line_number))
}
```

## Movement Calculations

```rust
impl Editor {
    fn move_up(&mut self, cx: &mut Context<Self>) {
        self.move_cursors(|cursor, map| {
            let current = map.buffer_point_to_display(cursor.position);
            if current.row > 0 {
                let new_display = DisplayPoint {
                    row: current.row - 1,
                    column: cursor.goal_column.unwrap_or(current.column),
                };
                let new_buffer = map.display_point_to_buffer(new_display);
                cursor.position = new_buffer;
            }
        }, cx);
    }

    fn move_to_line_start(&mut self, cx: &mut Context<Self>) {
        self.move_cursors(|cursor, map| {
            cursor.position.column = 0;
            cursor.goal_column = None;
        }, cx);
    }

    fn move_to_line_end(&mut self, cx: &mut Context<Self>) {
        self.move_cursors(|cursor, map| {
            let line_len = map.line_len(cursor.position.row);
            cursor.position.column = line_len;
            cursor.goal_column = None;
        }, cx);
    }
}
```

## Virtual Scrolling for Large Files

```rust
struct EditorElement {
    scroll_position: Point<Pixels>,
    visible_row_range: Range<u32>,
}

impl EditorElement {
    fn calculate_visible_rows(
        &self,
        viewport_height: Pixels,
        line_height: Pixels,
        total_rows: u32,
    ) -> Range<u32> {
        let scroll_top = self.scroll_position.y;
        let first_visible = (scroll_top / line_height).floor() as u32;
        let visible_count = (viewport_height / line_height).ceil() as u32 + 1;
        let last_visible = (first_visible + visible_count).min(total_rows);

        first_visible..last_visible
    }

    fn render_visible_lines(
        &self,
        visible_rows: Range<u32>,
        window: &mut Window,
        cx: &mut App,
    ) -> Vec<impl IntoElement> {
        visible_rows
            .map(|row| self.render_line(row, window, cx))
            .collect()
    }
}
```
