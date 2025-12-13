use gpui::{div, px, rgb, IntoElement, ParentElement, Styled};

use crate::repo::status::{ChangedFile, FileStatus, WorkingCopyStatus};

pub fn render_status_view(status: &WorkingCopyStatus) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .size_full()
        .p_2()
        .gap_2()
        .child(render_working_copy_info(status))
        .child(render_file_list(&status.files))
}

fn render_working_copy_info(status: &WorkingCopyStatus) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .pb_2()
        .border_b_1()
        .border_color(rgb(0x3d3d3d))
        .child(
            div()
                .flex()
                .gap_2()
                .child(
                    div()
                        .text_color(rgb(0x4ec9b0))
                        .child(format!("@ {}", status.change_id)),
                )
                .child(
                    div()
                        .text_color(rgb(0x808080))
                        .child(status.commit_id.clone()),
                ),
        )
        .child(
            div()
                .text_color(rgb(0xcccccc))
                .child(if status.description.is_empty() {
                    "(no description)".to_string()
                } else {
                    status.description.clone()
                }),
        )
        .child(
            div()
                .text_color(rgb(0x606060))
                .text_sm()
                .child(format!("Parent: {}", status.parent_description)),
        )
}

fn render_file_list(files: &[ChangedFile]) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .text_color(rgb(0x808080))
                .text_sm()
                .child(format!("Changes ({} files)", files.len())),
        )
        .children(files.iter().map(render_file_row).collect::<Vec<_>>())
}

fn render_file_row(file: &ChangedFile) -> impl IntoElement {
    let (status_char, status_color) = match file.status {
        FileStatus::Added => ("A", rgb(0x4ec9b0)),
        FileStatus::Modified => ("M", rgb(0xdcdcaa)),
        FileStatus::Deleted => ("D", rgb(0xf14c4c)),
    };

    div()
        .flex()
        .gap_2()
        .py(px(2.0))
        .child(
            div()
                .w(px(16.0))
                .text_color(status_color)
                .child(status_char),
        )
        .child(div().text_color(rgb(0xcccccc)).child(file.path.clone()))
}
