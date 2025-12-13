use gpui::{
    ClipboardItem, CursorStyle, InteractiveElement, IntoElement, ParentElement, SharedString,
    StatefulInteractiveElement, Styled, div, px, rgb,
};

use super::theme::{Colors, TextSize};
use crate::repo::status::{ChangedFile, FileStatus, WorkingCopyStatus};

pub fn render_status_view(status: &WorkingCopyStatus) -> impl IntoElement {
    div()
        .flex_shrink_0()
        .h(px(200.0))
        .w_full()
        .flex()
        .flex_col()
        .border_t_1()
        .border_color(rgb(Colors::BORDER_MUTED))
        .bg(rgb(Colors::BG_SURFACE))
        .text_size(TextSize::SM)
        .child(render_header(status))
        .child(render_file_list(&status.files))
}

fn render_header(status: &WorkingCopyStatus) -> impl IntoElement {
    let change_id = status.change_id.clone();
    let change_id_for_click = change_id.clone();

    div()
        .flex_shrink_0()
        .px_3()
        .py_2()
        .flex()
        .gap_4()
        .items_center()
        .border_b_1()
        .border_color(rgb(Colors::BORDER_MUTED))
        .child(
            div()
                .flex_shrink_0()
                .flex()
                .gap_2()
                .items_center()
                .child(
                    div()
                        .id("status-change-id")
                        .text_color(rgb(Colors::WORKING_COPY))
                        .cursor(CursorStyle::PointingHand)
                        .on_click(move |_event, _window, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(
                                change_id_for_click.clone(),
                            ));
                        })
                        .child(format!("@ {}", change_id)),
                )
                .child(
                    div()
                        .text_color(rgb(Colors::TEXT_SUBTLE))
                        .text_size(TextSize::XS)
                        .child(status.commit_id.chars().take(8).collect::<String>()),
                ),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(rgb(Colors::TEXT))
                .overflow()
                .whitespace_nowrap()
                .text_ellipsis()
                .child(if status.description.is_empty() {
                    "(no description)".to_string()
                } else {
                    status.description.clone()
                }),
        )
}

fn render_file_list(files: &[ChangedFile]) -> impl IntoElement {
    div()
        .flex_1()
        .overflow_y_auto()
        .px_3()
        .py_2()
        .flex()
        .flex_col()
        .gap_1()
        .children(files.iter().map(render_file_row).collect::<Vec<_>>())
}

fn render_file_row(file: &ChangedFile) -> impl IntoElement {
    let (status_char, status_color) = match file.status {
        FileStatus::Added => ("A", rgb(Colors::ADDED)),
        FileStatus::Modified => ("M", rgb(Colors::MODIFIED)),
        FileStatus::Deleted => ("D", rgb(Colors::DELETED)),
    };

    let path: SharedString = file.path.clone().into();
    let path_for_click = path.clone();
    let path_for_child = path.clone();

    div()
        .id(path)
        .flex_shrink_0()
        .flex()
        .gap_2()
        .h(px(20.0))
        .items_center()
        .cursor(CursorStyle::PointingHand)
        .on_click(move |_event, _window, cx| {
            cx.write_to_clipboard(ClipboardItem::new_string(path_for_click.to_string()));
        })
        .child(
            div()
                .flex_shrink_0()
                .w(px(14.0))
                .text_color(status_color)
                .child(status_char),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(rgb(Colors::TEXT))
                .overflow()
                .whitespace_nowrap()
                .text_ellipsis()
                .child(path_for_child),
        )
}
