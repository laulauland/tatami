use gpui::{
    div, px, rgb, prelude::FluentBuilder, Hsla, InteractiveElement, IntoElement, ParentElement,
    SharedString, Styled,
};

use super::theme::{Colors, TextSize};
use crate::repo::log::Revision;

pub fn render_log_view(
    revisions: &[Revision],
    selected_index: Option<usize>,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .flex_1()
        .overflow_hidden()
        .text_size(TextSize::SM)
        .children(revisions.iter().enumerate().map(|(idx, rev)| {
            let is_selected = Some(idx) == selected_index;
            let is_last = idx == revisions.len() - 1;
            render_revision_entry(rev, is_selected, is_last)
        }))
}

fn render_revision_entry(rev: &Revision, is_selected: bool, is_last: bool) -> impl IntoElement {
    let id_color = if rev.is_working_copy {
        rgb(Colors::WORKING_COPY)
    } else if rev.is_immutable {
        rgb(Colors::IMMUTABLE)
    } else {
        rgb(Colors::MUTABLE)
    };

    let graph_symbol = if rev.is_working_copy {
        "@"
    } else if rev.is_immutable {
        "◆"
    } else {
        "○"
    };

    let row_id: SharedString = format!("rev-{}", rev.change_id).into();

    div()
        .flex()
        .flex_col()
        .child(
            // Main row
            div()
                .id(row_id)
                .w_full()
                .h(px(24.0))
                .flex()
                .items_center()
                .hover(|s| s.bg(rgb(Colors::BG_HOVER)))
                .child(render_graph_column(graph_symbol, id_color.into(), is_last))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .items_center()
                        .gap_3()
                        .pr_2()
                        .child(
                            div()
                                .flex_shrink_0()
                                .w(px(96.0))
                                .text_color(id_color)
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .child(rev.change_id.clone()),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .text_color(rgb(Colors::TEXT))
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .child(if rev.description.is_empty() {
                                    "(no description)".to_string()
                                } else {
                                    rev.description.clone()
                                }),
                        )
                        .child(render_bookmarks(&rev.bookmarks))
                        .child(
                            div()
                                .flex_shrink_0()
                                .w(px(100.0))
                                .text_color(rgb(Colors::TEXT_SUBTLE))
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis()
                                .child(rev.author.clone()),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .w(px(88.0))
                                .text_color(rgb(Colors::TEXT_SUBTLE))
                                .whitespace_nowrap()
                                .child(rev.timestamp.clone()),
                        ),
                ),
        )
        .when(is_selected, |el| {
            el.child(render_expanded_detail(rev, is_last))
        })
}

fn render_graph_column(symbol: &'static str, color: Hsla, is_last: bool) -> impl IntoElement {
    div()
        .flex_shrink_0()
        .w(px(24.0))
        .h(px(24.0))
        .flex()
        .flex_col()
        .items_center()
        .child(
            div()
                .h(px(4.0))
                .w(px(1.0))
                .bg(rgb(Colors::BORDER_MUTED)),
        )
        .child(
            div()
                .h(px(16.0))
                .flex()
                .items_center()
                .justify_center()
                .text_color(color)
                .child(symbol),
        )
        .child(
            div()
                .h(px(4.0))
                .w(px(1.0))
                .when(!is_last, |el| el.bg(rgb(Colors::BORDER_MUTED))),
        )
}

fn render_expanded_detail(rev: &Revision, is_last: bool) -> impl IntoElement {
    div()
        .flex()
        .child(
            // Graph continuation line
            div()
                .flex_shrink_0()
                .w(px(24.0))
                .flex()
                .justify_center()
                .child(
                    div()
                        .w(px(1.0))
                        .h_full()
                        .when(!is_last, |el| el.bg(rgb(Colors::BORDER_MUTED))),
                ),
        )
        .child(
            // Detail panel
            div()
                .flex_1()
                .my_1()
                .mr_2()
                .p_3()
                .bg(rgb(Colors::BG_SURFACE))
                .rounded_md()
                .border_1()
                .border_color(rgb(Colors::BORDER_MUTED))
                .flex()
                .flex_col()
                .gap_2()
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(
                            div()
                                .text_color(rgb(Colors::WORKING_COPY))
                                .child(format!("@ {}", rev.change_id)),
                        )
                        .child(
                            div()
                                .text_color(rgb(Colors::TEXT_SUBTLE))
                                .text_size(TextSize::XS)
                                .child(rev.commit_id.chars().take(12).collect::<String>()),
                        ),
                )
                .child(
                    div()
                        .text_color(rgb(Colors::TEXT))
                        .child(if rev.description.is_empty() {
                            "(no description)".to_string()
                        } else {
                            rev.description.clone()
                        }),
                )
                .child(
                    div()
                        .text_size(TextSize::XS)
                        .text_color(rgb(Colors::TEXT_SUBTLE))
                        .child(format!("{} · {}", rev.author, rev.timestamp)),
                ),
        )
}

fn render_bookmarks(bookmarks: &[String]) -> impl IntoElement {
    div()
        .flex_shrink_0()
        .w(px(80.0))
        .flex()
        .gap_1()
        .overflow_hidden()
        .children(
            bookmarks
                .iter()
                .take(2)
                .map(|b| {
                    div()
                        .flex_shrink_0()
                        .px(px(6.0))
                        .py(px(1.0))
                        .rounded_sm()
                        .bg(rgb(Colors::BG_ELEVATED))
                        .text_color(rgb(Colors::ACCENT))
                        .text_size(TextSize::XS)
                        .whitespace_nowrap()
                        .child(b.clone())
                })
                .collect::<Vec<_>>(),
        )
}
