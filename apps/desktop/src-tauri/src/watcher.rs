use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherManager {
    watchers: Mutex<HashMap<PathBuf, Debouncer<RecommendedWatcher>>>,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn watch(&self, app: &AppHandle, repo_path: PathBuf) -> Result<(), String> {
        let mut watchers = self.watchers.lock().map_err(|e| e.to_string())?;

        if watchers.contains_key(&repo_path) {
            return Ok(());
        }

        let jj_repo_path = repo_path.join(".jj").join("repo");

        if !jj_repo_path.exists() {
            return Err(format!("Not a jj repository: {}", repo_path.display()));
        }

        let app_handle = app.clone();
        let repo_path_clone = repo_path.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: DebounceEventResult| {
                if result.is_ok() {
                    let _ = app_handle.emit(
                        "repo-changed",
                        repo_path_clone.to_string_lossy().to_string(),
                    );
                }
            },
        )
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

        debouncer
            .watcher()
            .watch(&jj_repo_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {}", e))?;

        watchers.insert(repo_path, debouncer);

        Ok(())
    }

    pub fn unwatch(&self, repo_path: &PathBuf) -> Result<(), String> {
        let mut watchers = self.watchers.lock().map_err(|e| e.to_string())?;
        watchers.remove(repo_path);
        Ok(())
    }
}

pub fn get_watcher_manager(app: &AppHandle) -> &WatcherManager {
    app.state::<WatcherManager>().inner()
}
