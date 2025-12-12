mod app;
mod repo;
mod ui;

use gpui::Application;

fn main() {
    let current_dir = std::env::current_dir().unwrap_or_default();
    let repo_state = repo::load_workspace(&current_dir);

    Application::new().run(|cx| {
        app::open_window(cx, repo_state);
    });
}
