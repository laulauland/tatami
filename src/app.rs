use gpui::{
    div, px, rgb, size, App, AppContext, Bounds, Context, IntoElement, ParentElement, Render,
    Styled, Window, WindowBounds, WindowOptions,
};

use crate::repo::RepoState;
use crate::ui::log_view::render_log_view;
use crate::ui::status_view::render_status_view;

pub struct Tatami {
    repo: RepoState,
    selected_revision: Option<usize>,
}

impl Tatami {
    pub fn new(repo: RepoState) -> Self {
        Self {
            repo,
            selected_revision: Some(0),
        }
    }
}

impl Render for Tatami {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let (main_content, right_panel) = match &self.repo {
            RepoState::NotFound { path } => (
                div()
                    .flex_1()
                    .h_full()
                    .p_4()
                    .child(format!("No jj repository at {}", path.display())),
                div().w(px(300.0)).h_full(),
            ),
            RepoState::Loaded {
                revisions, status, ..
            } => (
                div()
                    .flex_1()
                    .h_full()
                    .child(render_log_view(revisions, self.selected_revision)),
                div()
                    .w(px(300.0))
                    .h_full()
                    .bg(rgb(0x252525))
                    .border_l_1()
                    .border_color(rgb(0x3d3d3d))
                    .children(status.as_ref().map(render_status_view)),
            ),
            RepoState::Error { message } => (
                div()
                    .flex_1()
                    .h_full()
                    .p_4()
                    .child(format!("Error: {}", message)),
                div().w(px(300.0)).h_full(),
            ),
        };

        let status_text = match &self.repo {
            RepoState::NotFound { .. } => "No repository".to_string(),
            RepoState::Loaded {
                workspace_root,
                revisions,
                status,
            } => {
                let file_count = status.as_ref().map(|s| s.files.len()).unwrap_or(0);
                format!(
                    "{} • {} revisions • {} changed files",
                    workspace_root
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    revisions.len(),
                    file_count
                )
            }
            RepoState::Error { .. } => "Error".to_string(),
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(0x1e1e1e))
            .text_color(rgb(0xcccccc))
            .child(
                div()
                    .h(px(40.0))
                    .w_full()
                    .flex()
                    .items_center()
                    .px_4()
                    .bg(rgb(0x2d2d2d))
                    .border_b_1()
                    .border_color(rgb(0x3d3d3d))
                    .child("Tatami"),
            )
            .child(
                div()
                    .flex_1()
                    .flex()
                    .overflow_hidden()
                    .child(
                        div()
                            .w(px(200.0))
                            .h_full()
                            .bg(rgb(0x252525))
                            .border_r_1()
                            .border_color(rgb(0x3d3d3d))
                            .p_2()
                            .child("Bookmarks"),
                    )
                    .child(main_content)
                    .child(right_panel),
            )
            .child(
                div()
                    .h(px(24.0))
                    .w_full()
                    .flex()
                    .items_center()
                    .px_4()
                    .bg(rgb(0x007acc))
                    .text_color(rgb(0xffffff))
                    .child(status_text),
            )
    }
}

pub fn open_window(cx: &mut App, repo: RepoState) {
    let bounds = Bounds::centered(None, size(px(1200.0), px(800.0)), cx);

    cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            ..Default::default()
        },
        |_window, cx| cx.new(|_cx| Tatami::new(repo)),
    )
    .expect("Failed to open window");
}
