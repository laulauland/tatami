use futures::StreamExt;
use gpui::{
    div, px, rgb, size, App, AppContext, Bounds, Context, Entity, IntoElement, ParentElement,
    Render, Styled, Window, WindowBounds, WindowOptions,
};
use std::path::PathBuf;

use crate::repo::diff::FileDiff;
use crate::repo::RepoState;
use crate::ui::diff_view::DiffView;
use crate::ui::log_view::render_log_view;
use crate::ui::theme::{self, Colors, TextSize};
use crate::watcher::RepoWatcher;

pub struct Tatami {
    repo: RepoState,
    workspace_root: PathBuf,
    selected_revision: Option<usize>,
    selected_file: Option<(String, String)>,
    diff_view: Option<Entity<DiffView>>,
    _watcher: Option<RepoWatcher>,
}

impl Tatami {
    pub fn new(repo: RepoState, workspace_root: PathBuf) -> Self {
        Self {
            repo,
            workspace_root,
            selected_revision: Some(0),
            selected_file: None,
            diff_view: None,
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
        self.selected_file = None;
        self.diff_view = None;
        cx.notify();
    }

    pub fn select_file(&mut self, change_id: String, file_path: String, cx: &mut Context<Self>) {
        if self.selected_file == Some((change_id.clone(), file_path.clone())) {
            self.selected_file = None;
            self.diff_view = None;
        } else {
            self.selected_file = Some((change_id.clone(), file_path.clone()));
            self.load_file_diff(change_id, file_path, cx);
        }
        cx.notify();
    }

    fn load_file_diff(&mut self, change_id: String, file_path: String, cx: &mut Context<Self>) {
        use crate::repo::diff::compute_file_diff;
        use crate::repo::jj::JjRepo;

        let file_path_for_closure = file_path.clone();
        let result = (|| -> anyhow::Result<FileDiff> {
            let jj_repo = JjRepo::open(&self.workspace_root)?;
            let commit = jj_repo.get_commit(&change_id)?;
            let new_content = jj_repo.get_file_content(&commit, &file_path_for_closure)?;
            let old_content = jj_repo.get_parent_file_content(&commit, &file_path_for_closure)?;
            Ok(compute_file_diff(
                &old_content,
                &new_content,
                file_path_for_closure.clone(),
            ))
        })();

        match result {
            Ok(diff) => {
                let diff_view = cx.new(|cx| DiffView::new(&diff, Some(&file_path), cx));
                self.diff_view = Some(diff_view);
            }
            Err(_) => self.diff_view = None,
        }
    }

    pub fn diff_view(&self) -> Option<&Entity<DiffView>> {
        self.diff_view.as_ref()
    }
}

impl Render for Tatami {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = match &self.repo {
            RepoState::NotFound { path } => div()
                .flex_1()
                .p_3()
                .child(format!("No jj repository at {}", path.display())),
            RepoState::Loaded { revisions, .. } => div().flex_1().child(render_log_view(
                revisions,
                self.selected_revision,
                &self.selected_file,
                self.diff_view.clone(),
                cx,
            )),
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
