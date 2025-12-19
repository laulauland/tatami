mod repo;

use repo::diff;
use repo::jj::JjRepo;
use repo::log::Revision;
use repo::status::WorkingCopyStatus;
use serde::Serialize;
use std::path::{Path, PathBuf};

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
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Tatami.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            find_repository,
            get_revisions,
            get_status,
            get_file_diff
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
