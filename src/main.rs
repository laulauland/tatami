mod app;
mod repo;
mod ui;
mod watcher;

use gpui::Application;

fn main() {
    let current_dir = std::env::current_dir().unwrap_or_default();
    let repo_state = repo::load_workspace(&current_dir);
    let workspace_root = current_dir.clone();

    Application::new().run(|cx| {
        app::open_window(cx, repo_state, workspace_root);
    });
}
