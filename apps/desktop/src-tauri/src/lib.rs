mod repo;
mod storage;
mod watcher;

use repo::diff;
use repo::jj::JjRepo;
use repo::log::Revision;
use repo::status::WorkingCopyStatus;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use storage::{AppLayout, Project, Storage, get_storage};
use tauri::Manager;
use watcher::{WatcherManager, get_watcher_manager};

#[derive(Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct DiffLine {
    pub line_type: String,
    pub content: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
}

#[derive(Serialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
}

#[tauri::command]
fn find_repository(start_path: String) -> Option<String> {
    let path = PathBuf::from(&start_path);
    repo::find_jj_repo(&path).and_then(|p| p.to_str().map(String::from))
}

#[tauri::command]
async fn get_revisions(repo_path: String, limit: usize) -> Result<Vec<Revision>, String> {
    let path = Path::new(&repo_path);
    repo::log::fetch_log(path, limit).map_err(|e| format!("Failed to fetch log: {}", e))
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
) -> Result<FileDiff, String> {
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

    let file_diff = diff::compute_file_diff(&old_content, &new_content, file_path)
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    Ok(FileDiff {
        path: file_diff.path,
        hunks: file_diff
            .hunks
            .into_iter()
            .map(|h| DiffHunk {
                old_start: h.old_start,
                old_count: h.old_count,
                new_start: h.new_start,
                new_count: h.new_count,
                lines: h
                    .lines
                    .into_iter()
                    .map(|l| DiffLine {
                        line_type: l.line_type,
                        content: l.content,
                        old_line_number: l.old_line_number,
                        new_line_number: l.new_line_number,
                    })
                    .collect(),
            })
            .collect(),
    })
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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            find_repository,
            get_revisions,
            get_status,
            get_file_diff,
            get_projects,
            upsert_project,
            find_project_by_path,
            get_layout,
            update_layout,
            watch_repository,
            unwatch_repository,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
