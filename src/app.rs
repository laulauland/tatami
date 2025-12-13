use futures::StreamExt;
use gpui::{
    div, px, rgb, size, App, AppContext, Bounds, Context, IntoElement, ParentElement, Render,
    Styled, Window, WindowBounds, WindowOptions,
};
use std::path::PathBuf;

use crate::repo::RepoState;
use crate::ui::log_view::render_log_view;
use crate::ui::theme::{self, Colors, TextSize};
use crate::watcher::RepoWatcher;

pub struct Tatami {
    repo: RepoState,
    workspace_root: PathBuf,
    selected_revision: Option<usize>,
    _watcher: Option<RepoWatcher>,
}

impl Tatami {
    pub fn new(repo: RepoState, workspace_root: PathBuf) -> Self {
        Self {
            repo,
            workspace_root,
            selected_revision: Some(0),
            _watcher: None,
        }
    }

    pub fn set_watcher(&mut self, watcher: RepoWatcher) {
        self._watcher = Some(watcher);
    }

    pub fn reload_repo(&mut self) {
        self.repo = crate::repo::load_workspace(&self.workspace_root);
    }
}

impl Tatami {
    pub fn select_revision(&mut self, index: usize, cx: &mut Context<Self>) {
        if self.selected_revision == Some(index) {
            self.selected_revision = None;
        } else {
            self.selected_revision = Some(index);
        }
        cx.notify();
    }
}

impl Render for Tatami {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = match &self.repo {
            RepoState::NotFound { path } => div()
                .flex_1()
                .p_3()
                .child(format!("No jj repository at {}", path.display())),
            RepoState::Loaded { revisions, .. } => div()
                .flex_1()
                .child(render_log_view(revisions, self.selected_revision, cx)),
            RepoState::Error { message } => {
                div().flex_1().p_3().child(format!("Error: {}", message))
            }
        };

        let status_text = match &self.repo {
            RepoState::NotFound { .. } => "No repository".to_string(),
            RepoState::Loaded {
                workspace_root,
                revisions,
                ..
            } => {
                format!(
                    "{} · {} revisions",
                    workspace_root
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy(),
                    revisions.len(),
                )
            }
            RepoState::Error { .. } => "Error".to_string(),
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .font_family(theme::font_family())
            .text_size(TextSize::BASE)
            .bg(rgb(Colors::BG_BASE))
            .text_color(rgb(Colors::TEXT))
            .child(content)
            .child(
                div()
                    .h(px(22.0))
                    .w_full()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .px_3()
                    .bg(rgb(Colors::BG_SURFACE))
                    .border_t_1()
                    .border_color(rgb(Colors::BORDER_MUTED))
                    .text_size(TextSize::XS)
                    .text_color(rgb(Colors::TEXT_SUBTLE))
                    .child(status_text),
            )
    }
}

pub fn open_window(cx: &mut App, repo: RepoState, workspace_root: PathBuf) {
    let bounds = Bounds::centered(None, size(px(1200.0), px(800.0)), cx);

    cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            ..Default::default()
        },
        |_window, cx| {
            let entity = cx.new(|_cx| {
                let tatami = Tatami::new(repo.clone(), workspace_root.clone());
                tatami
            });

            if let RepoState::Loaded { .. } = &repo {
                let (watcher, mut receiver) = crate::watcher::watch_repo(workspace_root.clone());

                entity.update(cx, |tatami, cx| {
                    tatami.set_watcher(watcher);

                    cx.spawn(|weak_self: gpui::WeakEntity<Tatami>, async_cx: &mut gpui::AsyncApp| {
                        let mut async_cx = async_cx.clone();
                        async move {
                            while let Some(()) = receiver.next().await {
                                let Some(entity) = weak_self.upgrade() else {
                                    break;
                                };
                                if async_cx
                                    .update_entity(&entity, |tatami, ctx| {
                                        tatami.reload_repo();
                                        ctx.notify();
                                    })
                                    .is_err()
                                {
                                    break;
                                }
                            }
                        }
                    })
                    .detach();
                });
            }

            entity
        },
    )
    .expect("Failed to open window");
}
