use futures::channel::mpsc;
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::path::PathBuf;
use std::time::Duration;

pub struct RepoWatcher {
    _debouncer: Debouncer<RecommendedWatcher>,
}

pub fn watch_repo(workspace_root: PathBuf) -> (RepoWatcher, mpsc::UnboundedReceiver<()>) {
    let (tx, rx) = mpsc::unbounded();
    let jj_repo_path = workspace_root.join(".jj").join("repo");

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: DebounceEventResult| {
            if let Ok(_events) = result {
                let _ = tx.unbounded_send(());
            }
        },
    )
    .expect("Failed to create filesystem watcher");

    debouncer
        .watcher()
        .watch(&jj_repo_path, RecursiveMode::Recursive)
        .expect("Failed to watch .jj/repo directory");

    (
        RepoWatcher {
            _debouncer: debouncer,
        },
        rx,
    )
}
