use gpui::{div, px, rgb, InteractiveElement, IntoElement, ParentElement, Styled};

use crate::repo::log::Revision;

pub fn render_log_view(revisions: &[Revision], selected_index: Option<usize>) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .size_full()
        .overflow_hidden()
        .children(
            revisions
                .iter()
                .enumerate()
                .map(|(idx, rev)| render_revision_row(rev, Some(idx) == selected_index)),
        )
}

fn render_revision_row(rev: &Revision, is_selected: bool) -> impl IntoElement {
    let bg_color = if is_selected {
        rgb(0x094771)
    } else {
        rgb(0x1e1e1e)
    };

    let commit_color = if rev.is_working_copy {
        rgb(0x4ec9b0)
    } else if rev.is_immutable {
        rgb(0x808080)
    } else {
        rgb(0xdcdcaa)
    };

    let graph_symbol = if rev.is_working_copy {
        "@"
    } else if rev.is_immutable {
        "◆"
    } else {
        "○"
    };

    div()
        .w_full()
        .px_2()
        .py_1()
        .bg(bg_color)
        .hover(|s| s.bg(rgb(0x2a2d2e)))
        .flex()
        .gap_2()
        .child(
            div()
                .w(px(16.0))
                .text_color(commit_color)
                .child(graph_symbol),
        )
        .child(
            div()
                .w(px(100.0))
                .text_color(commit_color)
                .child(rev.change_id.clone()),
        )
        .child(
            div()
                .flex_1()
                .text_color(rgb(0xcccccc))
                .child(rev.description.clone()),
        )
        .child(render_bookmarks(&rev.bookmarks))
        .child(
            div()
                .w(px(80.0))
                .text_color(rgb(0x808080))
                .child(rev.author.clone()),
        )
        .child(
            div()
                .w(px(100.0))
                .text_color(rgb(0x808080))
                .child(rev.timestamp.clone()),
        )
}

fn render_bookmarks(bookmarks: &[String]) -> impl IntoElement {
    div().w(px(120.0)).flex().gap_1().children(
        bookmarks
            .iter()
            .take(2)
            .map(|b| {
                div()
                    .px_1()
                    .rounded_sm()
                    .bg(rgb(0x4d4d4d))
                    .text_color(rgb(0xe0e0e0))
                    .text_xs()
                    .child(b.clone())
            })
            .collect::<Vec<_>>(),
    )
}
