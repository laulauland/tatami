use std::cell::RefCell;

use gpui::{
    div, px, rgb, rgba, uniform_list, Context, IntoElement, InteractiveElement, MouseButton,
    MouseDownEvent, MouseMoveEvent, ParentElement, Pixels, Point, Render, Styled, Window,
    prelude::FluentBuilder,
};

use super::syntax::{StyledSpan, SyntaxHighlighter};
use super::theme::{Colors, TextSize};
use crate::repo::diff::{DiffLine, FileDiff};

const LINE_HEIGHT: f32 = 20.0;
const MAX_VISIBLE_LINES: usize = 20;

#[derive(Clone, Debug)]
pub struct TextPosition {
    pub line: usize,
    pub column: usize,
}

#[derive(Clone)]
struct HighlightedLine {
    text: String,
    spans: Vec<StyledSpan>,
    bg_color: u32,
    prefix: &'static str,
    prefix_color: u32,
}

pub struct DiffView {
    lines: Vec<HighlightedLine>,
    selection_start: Option<TextPosition>,
    selection_end: Option<TextPosition>,
}

impl DiffView {
    pub fn new(diff: &FileDiff, file_path: Option<&str>, _cx: &mut Context<Self>) -> Self {
        let raw_lines: Vec<DiffLine> = diff
            .hunks
            .iter()
            .flat_map(|hunk| hunk.lines.clone())
            .collect();

        let language = file_path.and_then(SyntaxHighlighter::detect_language);
        let highlighter = RefCell::new(SyntaxHighlighter::new());

        let lines: Vec<HighlightedLine> = raw_lines
            .iter()
            .map(|line| {
                let (text, bg_color, prefix_color, prefix) = match line {
                    DiffLine::Context(content) => {
                        (content.clone(), Colors::BG_BASE, Colors::TEXT, " ")
                    }
                    DiffLine::Added(content) => (content.clone(), 0x0d3a1f, Colors::ADDED, "+"),
                    DiffLine::Deleted(content) => (content.clone(), 0x3d1014, Colors::DELETED, "-"),
                };

                let trimmed_text = text.trim_end_matches('\n').to_string();
                let spans = if let Some(ref lang) = language {
                    highlighter.borrow_mut().highlight_line(&trimmed_text, lang)
                } else {
                    vec![StyledSpan {
                        text: trimmed_text.clone(),
                        color: Colors::TEXT,
                    }]
                };

                HighlightedLine {
                    text: trimmed_text,
                    spans,
                    bg_color,
                    prefix,
                    prefix_color,
                }
            })
            .collect();

        Self {
            lines,
            selection_start: None,
            selection_end: None,
        }
    }

    fn position_from_point(&self, point: Point<Pixels>) -> TextPosition {
        const GUTTER_WIDTH: f32 = 40.0;
        const PREFIX_WIDTH: f32 = 16.0;
        const CHAR_WIDTH: f32 = 7.5;

        let y_pixels: f32 = point.y.into();
        let line = (y_pixels / LINE_HEIGHT).floor() as usize;
        let line = line.min(self.lines.len().saturating_sub(1));

        let x_pixels: f32 = point.x.into();
        let content_x = x_pixels - GUTTER_WIDTH - PREFIX_WIDTH;
        let column = if content_x > 0.0 {
            (content_x / CHAR_WIDTH).floor() as usize
        } else {
            0
        };

        let column = column.min(self.lines.get(line).map_or(0, |l| l.text.len()));

        TextPosition { line, column }
    }

    fn get_selection_for_line(&self, line_idx: usize) -> Option<(usize, usize)> {
        let start = self.selection_start.as_ref()?;
        let end = self.selection_end.as_ref()?;

        let (start, end) = if start.line < end.line || (start.line == end.line && start.column <= end.column) {
            (start, end)
        } else {
            (end, start)
        };

        if line_idx < start.line || line_idx > end.line {
            return None;
        }

        let line_len = self.lines.get(line_idx)?.text.len();

        let start_col = if line_idx == start.line {
            start.column.min(line_len)
        } else {
            0
        };

        let end_col = if line_idx == end.line {
            end.column.min(line_len)
        } else {
            line_len
        };

        if start_col >= end_col {
            return None;
        }

        Some((start_col, end_col))
    }

    fn handle_mouse_down(&mut self, event: &MouseDownEvent, _window: &mut Window, cx: &mut Context<Self>) {
        let position = self.position_from_point(event.position);
        self.selection_start = Some(position.clone());
        self.selection_end = Some(position);
        cx.notify();
    }

    fn handle_mouse_move(&mut self, event: &MouseMoveEvent, _window: &mut Window, cx: &mut Context<Self>) {
        if event.pressed_button == Some(MouseButton::Left) {
            let position = self.position_from_point(event.position);
            self.selection_end = Some(position);
            cx.notify();
        }
    }
}

impl Render for DiffView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let line_count = self.lines.len();
        let visible_height = (line_count.min(MAX_VISIBLE_LINES) as f32) * LINE_HEIGHT;
        let lines = self.lines.clone();
        let selection_ranges: Vec<Option<(usize, usize)>> = (0..line_count)
            .map(|idx| self.get_selection_for_line(idx))
            .collect();

        div()
            .flex()
            .flex_col()
            .bg(rgb(Colors::BG_BASE))
            .rounded_md()
            .border_1()
            .border_color(rgb(Colors::BORDER_MUTED))
            .overflow_hidden()
            .h(px(visible_height))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::handle_mouse_down))
            .on_mouse_move(cx.listener(Self::handle_mouse_move))
            .child(
                uniform_list("diff-lines", line_count, move |range, _window, _cx| {
                    range
                        .map(|idx| {
                            let line = lines[idx].clone();
                            let selection = selection_ranges[idx];
                            render_highlighted_line(line, idx + 1, selection)
                        })
                        .collect()
                })
                .flex_1()
                .text_size(TextSize::XS),
            )
    }
}

fn render_highlighted_line(
    line: HighlightedLine,
    line_number: usize,
    selection: Option<(usize, usize)>,
) -> impl IntoElement {
    const GUTTER_WIDTH: f32 = 40.0;
    const PREFIX_WIDTH: f32 = 16.0;
    const CHAR_WIDTH: f32 = 7.5;

    div()
        .h(px(LINE_HEIGHT))
        .w_full()
        .flex()
        .items_center()
        .bg(rgb(line.bg_color))
        .relative()
        .when_some(selection, |element, (start_col, end_col)| {
            let x_offset = GUTTER_WIDTH + PREFIX_WIDTH + (start_col as f32 * CHAR_WIDTH);
            let width = (end_col - start_col) as f32 * CHAR_WIDTH;

            element.child(
                div()
                    .absolute()
                    .top_0()
                    .left(px(x_offset))
                    .h(px(LINE_HEIGHT))
                    .w(px(width))
                    .bg(rgba(0x4a9eff40))
            )
        })
        .child(
            div()
                .w(px(40.0))
                .flex_shrink_0()
                .text_color(rgb(Colors::TEXT_SUBTLE))
                .text_right()
                .pr_2()
                .child(format!("{line_number}")),
        )
        .child(
            div()
                .w(px(16.0))
                .flex_shrink_0()
                .text_color(rgb(line.prefix_color))
                .child(line.prefix),
        )
        .child(
            div()
                .flex_1()
                .flex()
                .overflow_hidden()
                .whitespace_nowrap()
                .children(line.spans.into_iter().map(|span| {
                    div().text_color(rgb(span.color)).child(span.text)
                })),
        )
}

pub fn get_diff_text(diff: &FileDiff) -> String {
    diff.hunks
        .iter()
        .flat_map(|hunk| hunk.lines.iter())
        .map(|line| {
            let (prefix, text) = match line {
                DiffLine::Context(content) => (" ", content.as_str()),
                DiffLine::Added(content) => ("+", content.as_str()),
                DiffLine::Deleted(content) => ("-", content.as_str()),
            };
            format!("{}{}", prefix, text.trim_end_matches('\n'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}
