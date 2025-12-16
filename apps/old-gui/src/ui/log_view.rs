use gpui::{
    div, px, rgb, prelude::FluentBuilder, Context, Entity, Hsla, InteractiveElement, IntoElement,
    ParentElement, SharedString, StatefulInteractiveElement, Styled,
};

use super::diff_view::DiffView;
use super::theme::{Colors, TextSize};
use crate::app::Tatami;
use crate::repo::log::{FileStatus, Revision};

pub fn render_log_view(
    revisions: &[Revision],
    selected_index: Option<usize>,
    selected_file: &Option<(String, String)>,
    diff_view: Option<Entity<DiffView>>,
    cx: &mut Context<Tatami>,
) -> impl IntoElement {
    let revision_count = revisions.len();
    let selected_file_cloned = selected_file.clone();

    let entries: Vec<_> = revisions
        .iter()
        .enumerate()
        .map(|(idx, rev)| {
            let is_selected = Some(idx) == selected_index;
            let is_last = idx == revision_count - 1;
            let on_click = cx.listener(move |tatami, _event, _window, cx| {
                tatami.select_revision(idx, cx);
            });

            let file_handlers: Vec<_> = rev
                .files
                .iter()
                .map(|f| {
                    let change_id = rev.change_id.clone();
                    let file_path = f.path.clone();
                    cx.listener(move |tatami, _event, _window, cx| {
                        tatami.select_file(change_id.clone(), file_path.clone(), cx);
                    })
                })
                .collect();

            (
                rev.clone(),
                is_selected,
                is_last,
                on_click,
                selected_file_cloned.clone(),
                diff_view.clone(),
                file_handlers,
            )
        })
        .collect();

    div()
        .id("log-view")
        .flex()
        .flex_col()
        .flex_1()
        .overflow_y_scroll()
        .text_size(TextSize::SM)
        .children(entries.into_iter().map(
            |(rev, is_selected, is_last, on_click, selected_file, file_diff, file_handlers)| {
                render_revision_entry(
                    rev,
                    is_selected,
                    is_last,
                    on_click,
                    selected_file,
                    file_diff,
                    file_handlers,
                )
            },
        ))
}

fn render_revision_entry<F, G>(
    rev: Revision,
    is_selected: bool,
    is_last: bool,
    on_click: F,
    selected_file: Option<(String, String)>,
    diff_view: Option<Entity<DiffView>>,
    file_handlers: Vec<G>,
) -> impl IntoElement
where
    F: Fn(&gpui::ClickEvent, &mut gpui::Window, &mut gpui::App) + 'static,
    G: Fn(&gpui::ClickEvent, &mut gpui::Window, &mut gpui::App) + 'static,
{
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
            div()
                .id(row_id)
                .w_full()
                .h(px(24.0))
                .flex()
                .items_center()
                .cursor_pointer()
                .hover(|s| s.bg(rgb(Colors::BG_HOVER)))
                .on_click(on_click)
                .child(render_graph_column(graph_symbol, id_color.into(), is_last))
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .items_center()
                        .gap_2()
                        .min_w_0()
                        .pr_2()
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_color(id_color)
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
                                .text_color(rgb(Colors::TEXT_SUBTLE))
                                .child(rev.author.clone()),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_color(rgb(Colors::TEXT_SUBTLE))
                                .child(rev.timestamp.clone()),
                        ),
                ),
        )
        .when(is_selected, |el| {
            el.child(render_expanded_detail(
                &rev,
                is_last,
                &selected_file,
                diff_view,
                file_handlers,
            ))
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

fn render_expanded_detail<G>(
    rev: &Revision,
    is_last: bool,
    selected_file: &Option<(String, String)>,
    diff_view: Option<Entity<DiffView>>,
    file_handlers: Vec<G>,
) -> impl IntoElement
where
    G: Fn(&gpui::ClickEvent, &mut gpui::Window, &mut gpui::App) + 'static,
{
    let files_content = if rev.files.is_empty() {
        div()
            .text_size(TextSize::XS)
            .text_color(rgb(Colors::TEXT_MUTED))
            .child("(no file changes)")
    } else {
        let change_id = rev.change_id.clone();

        let file_entries: Vec<_> = rev
            .files
            .iter()
            .enumerate()
            .zip(file_handlers.into_iter())
            .map(|((_idx, f), on_file_click)| {
                let (prefix, color) = match f.status {
                    FileStatus::Added => ("A", Colors::ADDED),
                    FileStatus::Modified => ("M", Colors::MODIFIED),
                    FileStatus::Deleted => ("D", Colors::DELETED),
                };

                let file_path = f.path.clone();
                let is_file_selected = selected_file
                    .as_ref()
                    .map(|(cid, path)| cid == &change_id && path == &file_path)
                    .unwrap_or(false);

                (f.path.clone(), prefix, color, is_file_selected, on_file_click)
            })
            .collect();

        div()
            .flex()
            .flex_col()
            .gap_1()
            .text_size(TextSize::XS)
            .children(file_entries.into_iter().map(
                |(file_path, prefix, color, is_file_selected, on_file_click)| {
                    let file_id: SharedString =
                        format!("file-{}-{}", change_id, file_path.replace('/', "-")).into();

                    let show_diff = is_file_selected && diff_view.is_some();

                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(
                            div()
                                .id(file_id)
                                .flex()
                                .gap_2()
                                .cursor_pointer()
                                .hover(|s| s.bg(rgb(Colors::BG_HOVER)))
                                .on_click(on_file_click)
                                .child(
                                    div()
                                        .w(px(12.0))
                                        .text_color(rgb(color))
                                        .child(prefix),
                                )
                                .child(
                                    div()
                                        .text_color(rgb(Colors::TEXT))
                                        .child(file_path),
                                ),
                        )
                        .when(show_diff, |el| {
                            el.child(
                                div()
                                    .ml(px(18.0))
                                    .mt_1()
                                    .child(diff_view.clone().unwrap()),
                            )
                        })
                },
            ))
    };

    div()
        .flex()
        .child(
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
                        .items_baseline()
                        .child(
                            div()
                                .text_color(rgb(Colors::WORKING_COPY))
                                .child(rev.change_id.clone()),
                        )
                        .child(
                            div()
                                .text_color(rgb(Colors::TEXT_SUBTLE))
                                .text_size(TextSize::XS)
                                .child(rev.commit_id.clone()),
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
                )
                .child(
                    div()
                        .mt_2()
                        .pt_2()
                        .border_t_1()
                        .border_color(rgb(Colors::BORDER_MUTED))
                        .child(files_content),
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
