mod repo;
mod storage;
mod watcher;

use repo::diff;
use repo::jj::JjRepo;
use repo::log::{Revision, RevsetResult};
use repo::status::WorkingCopyStatus;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use storage::{AppLayout, Project, Storage, get_storage};
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use watcher::{WatcherManager, get_watcher_manager};

#[derive(Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

#[tauri::command]
fn find_repository(start_path: String) -> Option<String> {
    let path = PathBuf::from(&start_path);
    repo::find_jj_repo(&path).and_then(|p| p.to_str().map(String::from))
}

#[tauri::command]
async fn get_revisions(
    repo_path: String,
    limit: usize,
    revset: Option<String>,
    preset: Option<String>,
) -> Result<Vec<Revision>, String> {
    let path = Path::new(&repo_path);
    repo::log::fetch_log(path, limit, revset.as_deref(), preset.as_deref())
        .map_err(|e| format!("Failed to fetch log: {}", e))
}

#[tauri::command]
async fn get_status(repo_path: String) -> Result<WorkingCopyStatus, String> {
    let path = Path::new(&repo_path);
    repo::status::fetch_status(path).map_err(|e| format!("Failed to fetch status: {}", e))
}

#[tauri::command]
async fn get_file_diff(
    repo_path: String,
    change_id: String,
    file_path: String,
) -> Result<String, String> {
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let commit = jj_repo
        .get_commit(&change_id)
        .map_err(|e| format!("Failed to get commit: {}", e))?;

    let old_content = jj_repo
        .get_parent_file_content(&commit, &file_path)
        .unwrap_or_default();

    let new_content = jj_repo
        .get_file_content(&commit, &file_path)
        .unwrap_or_default();

    diff::compute_file_diff(&old_content, &new_content, &file_path)
        .map_err(|e| format!("Failed to compute diff: {}", e))
}

#[tauri::command]
async fn get_revision_diff(repo_path: String, change_id: String) -> Result<String, String> {
    use jj_lib::backend::TreeValue;
    use jj_lib::matchers::EverythingMatcher;

    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let commit = jj_repo
        .get_commit(&change_id)
        .map_err(|e| format!("Failed to get commit: {}", e))?;

    let parent_tree = {
        let parents = commit.parents();
        let parent = parents
            .into_iter()
            .next()
            .ok_or_else(|| "Commit has no parent".to_string())?;
        parent
            .map_err(|e| format!("Failed to get parent: {}", e))?
            .tree()
            .map_err(|e| format!("Failed to get parent tree: {}", e))?
    };

    let commit_tree = commit
        .tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;

    let matcher = EverythingMatcher;
    let mut diff_iter = parent_tree.diff_stream(&commit_tree, &matcher);

    let mut unified_diffs = Vec::new();

    pollster::block_on(async {
        use futures::StreamExt;
        while let Some(entry) = diff_iter.next().await {
            let path = entry.path;
            let path_str = path.as_internal_file_string();

            let diff_values = entry
                .values
                .map_err(|e| format!("Failed to get diff values: {}", e))?;
            let before = diff_values.before.removes().next().and_then(|v| v.as_ref());
            let after = diff_values.after.adds().next().and_then(|v| v.as_ref());

            match (before, after) {
                (Some(TreeValue::File { .. }), Some(TreeValue::File { .. }))
                | (None, Some(TreeValue::File { .. }))
                | (Some(TreeValue::File { .. }), None) => {
                    let old_content = jj_repo
                        .get_parent_file_content(&commit, path_str)
                        .unwrap_or_default();

                    let new_content = jj_repo
                        .get_file_content(&commit, path_str)
                        .unwrap_or_default();

                    let file_diff = diff::compute_file_diff(&old_content, &new_content, path_str)
                        .map_err(|e| format!("Failed to compute diff: {}", e))?;

                    if !file_diff.is_empty() {
                        unified_diffs.push(file_diff);
                    }
                }
                _ => continue,
            };
        }
        Ok::<(), String>(())
    })?;

    Ok(unified_diffs.join("\n"))
}

#[tauri::command]
async fn get_revision_changes(
    repo_path: String,
    change_id: String,
) -> Result<Vec<ChangedFile>, String> {
    use jj_lib::backend::TreeValue;
    use jj_lib::matchers::EverythingMatcher;

    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let commit = jj_repo
        .get_commit(&change_id)
        .map_err(|e| format!("Failed to get commit: {}", e))?;

    let parent_tree = {
        let parents = commit.parents();
        let parent = parents
            .into_iter()
            .next()
            .ok_or_else(|| "Commit has no parent".to_string())?;
        parent
            .map_err(|e| format!("Failed to get parent: {}", e))?
            .tree()
            .map_err(|e| format!("Failed to get parent tree: {}", e))?
    };

    let commit_tree = commit
        .tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;

    let matcher = EverythingMatcher;
    let mut diff_iter = parent_tree.diff_stream(&commit_tree, &matcher);

    let mut files = Vec::new();

    pollster::block_on(async {
        use futures::StreamExt;
        while let Some(entry) = diff_iter.next().await {
            let path = entry.path;
            let path_str = path.as_internal_file_string();

            let diff_values = entry
                .values
                .map_err(|e| format!("Failed to get diff values: {}", e))?;
            let before = diff_values.before.removes().next().and_then(|v| v.as_ref());
            let after = diff_values.after.adds().next().and_then(|v| v.as_ref());

            let status = match (before, after) {
                (Some(TreeValue::File { .. }), Some(TreeValue::File { .. })) => "modified",
                (None, Some(_)) => "added",
                (Some(_), None) => "deleted",
                _ => continue,
            };

            files.push(ChangedFile {
                path: path_str.to_string(),
                status: status.to_string(),
            });
        }
        Ok::<(), String>(())
    })?;

    Ok(files)
}

#[tauri::command]
async fn get_projects(app: tauri::AppHandle) -> Result<Vec<Project>, String> {
    let storage = get_storage(&app);
    storage
        .get_projects()
        .await
        .map_err(|e| format!("Failed to get projects: {}", e))
}

#[tauri::command]
async fn upsert_project(app: tauri::AppHandle, project: Project) -> Result<(), String> {
    let storage = get_storage(&app);
    storage
        .upsert_project(&project)
        .await
        .map_err(|e| format!("Failed to upsert project: {}", e))
}

#[tauri::command]
async fn find_project_by_path(
    app: tauri::AppHandle,
    path: String,
) -> Result<Option<Project>, String> {
    let storage = get_storage(&app);
    storage
        .find_project_by_path(&path)
        .await
        .map_err(|e| format!("Failed to find project: {}", e))
}

#[tauri::command]
async fn remove_project(app: tauri::AppHandle, project_id: String) -> Result<(), String> {
    let storage = get_storage(&app);
    storage
        .delete_project(&project_id)
        .await
        .map_err(|e| format!("Failed to remove project: {}", e))
}

#[tauri::command]
async fn get_layout(app: tauri::AppHandle) -> AppLayout {
    let storage = get_storage(&app);
    storage.get_layout().await
}

#[tauri::command]
async fn update_layout(app: tauri::AppHandle, layout: AppLayout) -> Result<(), String> {
    let storage = get_storage(&app);
    storage
        .update_layout(layout)
        .await
        .map_err(|e| format!("Failed to update layout: {}", e))
}

#[tauri::command]
fn watch_repository(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    let watcher_manager = get_watcher_manager(&app);
    watcher_manager.watch(&app, PathBuf::from(repo_path))
}

#[tauri::command]
fn unwatch_repository(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    let watcher_manager = get_watcher_manager(&app);
    watcher_manager.unwatch(&PathBuf::from(repo_path))
}

/// Generate change IDs for optimistic UI updates
#[tauri::command]
async fn generate_change_ids(repo_path: String, count: usize) -> Result<Vec<String>, String> {
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .generate_change_ids(count)
        .map_err(|e| format!("Failed to generate change IDs: {}", e))
}

#[tauri::command]
async fn jj_new(
    repo_path: String,
    parent_change_ids: Vec<String>,
    change_id: Option<String>,
) -> Result<String, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .new_revision(parent_change_ids, change_id)
        .map_err(|e| format!("Failed to create new revision: {}", e))
}

#[tauri::command]
async fn jj_edit(repo_path: String, change_id: String) -> Result<(), String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .edit_revision(change_id)
        .map_err(|e| format!("Failed to edit revision: {}", e))
}

#[tauri::command]
async fn jj_abandon(repo_path: String, change_id: String) -> Result<(), String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .abandon_revision(&change_id)
        .map_err(|e| format!("Failed to abandon revision: {}", e))
}

/// Get recency data for commits by walking the operation log.
/// Returns a map of commit_id (hex) -> timestamp_millis (when it was last the working copy).
#[tauri::command]
async fn get_commit_recency(
    repo_path: String,
    limit: usize,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .get_commit_recency(limit)
        .map_err(|e| format!("Failed to get commit recency: {}", e))
}

/// Resolve a revset expression and return matching change IDs.
/// Uses jj-lib's full revset parser.
#[tauri::command]
async fn resolve_revset(repo_path: String, revset: String) -> Result<RevsetResult, String> {
    let path = Path::new(&repo_path);
    repo::log::resolve_revset(path, &revset).map_err(|e| format!("Failed to resolve revset: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let storage = Storage::new(app_data_dir)
                    .await
                    .expect("Failed to initialize storage");
                handle.manage(Arc::new(storage));
            });

            app.handle().manage(WatcherManager::new());

            // Add Debug menu for development
            #[cfg(debug_assertions)]
            {
                let debug_menu = SubmenuBuilder::new(app, "Debug")
                    .text("reload", "Reload")
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .copy()
                    .paste()
                    .undo()
                    .redo()
                    .separator()
                    .item(&debug_menu)
                    .build()?;

                app.set_menu(menu)?;

                app.on_menu_event(|app_handle, event| {
                    if event.id().0.as_str() == "reload" {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval("window.location.reload()");
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            find_repository,
            get_revisions,
            get_status,
            get_file_diff,
            get_revision_diff,
            get_revision_changes,
            get_commit_recency,
            resolve_revset,
            get_projects,
            upsert_project,
            find_project_by_path,
            remove_project,
            get_layout,
            update_layout,
            watch_repository,
            unwatch_repository,
            generate_change_ids,
            jj_new,
            jj_edit,
            jj_abandon,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
