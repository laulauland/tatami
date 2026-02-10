mod repo;
mod storage;
mod watcher;

/// Check if content appears to be binary (contains null bytes in first 8KB)
fn is_binary_content(content: &[u8]) -> bool {
    let check_len = content.len().min(8192);
    content[..check_len].contains(&0)
}

use repo::diff;
use repo::jj::{JjRepo, MutationResult, Operation};
use repo::log::{LineageResult, Revision, RevsetResult};
use repo::status::WorkingCopyStatus;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use storage::{AppLayout, Project, Storage, get_storage};
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use watcher::{WatcherManager, get_watcher_manager};

#[derive(Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct RevisionDiff {
    pub change_id: String,
    pub diff: String,
}

#[derive(Serialize)]
pub struct RevisionChanges {
    pub change_id: String,
    pub files: Vec<ChangedFile>,
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
async fn get_conflict_paths(repo_path: String, change_id: String) -> Result<Vec<String>, String> {
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .get_conflict_paths(&change_id)
        .map_err(|e| format!("Failed to get conflict paths: {}", e))
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

    // Load repo ONCE before the loop to avoid redundant load_at_head calls per file
    let repo = jj_repo
        .repo_loader()
        .load_at_head()
        .map_err(|e| format!("Failed to load repo: {}", e))?;

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
                        .get_parent_file_content_with_repo(repo.as_ref(), &commit, path_str)
                        .unwrap_or_default();

                    let new_content = jj_repo
                        .get_file_content_with_repo(repo.as_ref(), &commit, path_str)
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

/// Compute diff for a single revision (helper function for batch processing)
fn compute_revision_diff_inner(jj_repo: &JjRepo, change_id: &str) -> Result<String, String> {
    use jj_lib::backend::TreeValue;
    use jj_lib::matchers::EverythingMatcher;
    use rayon::prelude::*;
    use std::time::Instant;

    let total_start = Instant::now();

    let t0 = Instant::now();
    let commit = jj_repo
        .get_commit(change_id)
        .map_err(|e| format!("Failed to get commit: {}", e))?;
    let get_commit_ms = t0.elapsed().as_millis();

    let t0 = Instant::now();
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
    let parent_tree_ms = t0.elapsed().as_millis();

    let t0 = Instant::now();
    let commit_tree = commit
        .tree()
        .map_err(|e| format!("Failed to get commit tree: {}", e))?;
    let commit_tree_ms = t0.elapsed().as_millis();

    let matcher = EverythingMatcher;
    let mut diff_iter = parent_tree.diff_stream(&commit_tree, &matcher);

    let t0 = Instant::now();
    let repo = jj_repo
        .repo_loader()
        .load_at_head()
        .map_err(|e| format!("Failed to load repo: {}", e))?;
    let load_repo_ms = t0.elapsed().as_millis();

    // Phase 1: Collect file contents sequentially (requires JjRepo access)
    let mut file_contents: Vec<(String, Vec<u8>, Vec<u8>)> = Vec::new();
    let mut total_old_content_ms: u128 = 0;
    let mut total_new_content_ms: u128 = 0;
    let mut total_content_bytes: usize = 0;

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
                    let t0 = Instant::now();
                    let old_content = jj_repo
                        .get_parent_file_content_with_repo(repo.as_ref(), &commit, path_str)
                        .unwrap_or_default();
                    total_old_content_ms += t0.elapsed().as_millis();

                    let t0 = Instant::now();
                    let new_content = jj_repo
                        .get_file_content_with_repo(repo.as_ref(), &commit, path_str)
                        .unwrap_or_default();
                    total_new_content_ms += t0.elapsed().as_millis();

                    total_content_bytes += old_content.len() + new_content.len();

                    // Skip binary files
                    if is_binary_content(&old_content) || is_binary_content(&new_content) {
                        continue;
                    }

                    file_contents.push((path_str.to_string(), old_content, new_content));
                }
                _ => continue,
            };
        }
        Ok::<(), String>(())
    })?;

    let file_count = file_contents.len();

    // Phase 2: Compute diffs in parallel (pure computation, no JjRepo needed)
    let t0 = Instant::now();
    let unified_diffs: Vec<String> = file_contents
        .par_iter()
        .filter_map(|(path, old, new)| diff::compute_file_diff(old, new, path).ok())
        .filter(|d| !d.is_empty())
        .collect();
    let total_diff_compute_ms = t0.elapsed().as_millis();

    let total_ms = total_start.elapsed().as_millis();

    // Only log if total time is significant (>10ms)
    if total_ms > 10 {
        eprintln!(
            "[DIFF-TRACE] change={} total={}ms | get_commit={}ms parent_tree={}ms commit_tree={}ms load_repo={}ms | files={} old_content={}ms new_content={}ms diff_compute={}ms content_kb={}",
            &change_id[..8.min(change_id.len())],
            total_ms,
            get_commit_ms,
            parent_tree_ms,
            commit_tree_ms,
            load_repo_ms,
            file_count,
            total_old_content_ms,
            total_new_content_ms,
            total_diff_compute_ms,
            total_content_bytes / 1024
        );
    }

    Ok(unified_diffs.join("\n"))
}

/// Compute changed files for a single revision (helper function for batch processing)
fn compute_revision_changes_inner(
    jj_repo: &JjRepo,
    change_id: &str,
) -> Result<Vec<ChangedFile>, String> {
    use jj_lib::backend::TreeValue;
    use jj_lib::matchers::EverythingMatcher;

    let commit = jj_repo
        .get_commit(change_id)
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
async fn get_diffs_batch(
    repo_path: String,
    change_ids: Vec<String>,
) -> Result<Vec<RevisionDiff>, String> {
    use std::time::Instant;

    let batch_start = Instant::now();
    let batch_size = change_ids.len();

    let t0 = Instant::now();
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    let open_repo_ms = t0.elapsed().as_millis();

    // Process sequentially since JjRepo is not Sync
    let results: Vec<RevisionDiff> = change_ids
        .iter()
        .filter_map(
            |change_id| match compute_revision_diff_inner(&jj_repo, change_id) {
                Ok(diff) => Some(RevisionDiff {
                    change_id: change_id.clone(),
                    diff,
                }),
                Err(_) => None,
            },
        )
        .collect();

    let total_ms = batch_start.elapsed().as_millis();

    // Log batch summary
    if total_ms > 10 {
        eprintln!(
            "[DIFF-BATCH] count={} total={}ms open_repo={}ms avg_per_diff={}ms",
            batch_size,
            total_ms,
            open_repo_ms,
            if batch_size > 0 {
                total_ms / batch_size as u128
            } else {
                0
            }
        );
    }

    Ok(results)
}

#[tauri::command]
async fn get_changes_batch(
    repo_path: String,
    change_ids: Vec<String>,
) -> Result<Vec<RevisionChanges>, String> {
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;

    // Process sequentially since JjRepo is not Sync
    let results: Vec<RevisionChanges> = change_ids
        .iter()
        .filter_map(
            |change_id| match compute_revision_changes_inner(&jj_repo, change_id) {
                Ok(files) => Some(RevisionChanges {
                    change_id: change_id.clone(),
                    files,
                }),
                Err(_) => None,
            },
        )
        .collect();

    Ok(results)
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
) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .new_revision(parent_change_ids, change_id)
        .map_err(|e| format!("Failed to create new revision: {}", e))
}

#[tauri::command]
async fn jj_edit(repo_path: String, change_id: String) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .edit_revision(change_id)
        .map_err(|e| format!("Failed to edit revision: {}", e))
}

#[tauri::command]
async fn jj_abandon(repo_path: String, change_id: String) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .abandon_revision(&change_id)
        .map_err(|e| format!("Failed to abandon revision: {}", e))
}

#[tauri::command]
async fn jj_describe(
    repo_path: String,
    change_id: String,
    description: String,
) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .describe_revision(&change_id, description)
        .map_err(|e| format!("Failed to describe revision: {}", e))
}

#[tauri::command]
async fn jj_squash(repo_path: String, change_id: String) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .squash_revision(&change_id)
        .map_err(|e| format!("Failed to squash revision: {}", e))
}

#[tauri::command]
async fn jj_rebase(
    repo_path: String,
    source_change_id: String,
    destination_change_id: String,
) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .rebase_revision(&source_change_id, &destination_change_id)
        .map_err(|e| format!("Failed to rebase revision: {}", e))
}

#[tauri::command]
async fn jj_git_fetch(repo_path: String, remote: Option<String>) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .git_fetch(remote)
        .map_err(|e| format!("Failed to fetch from git remote: {}", e))
}

#[tauri::command]
async fn jj_git_push(
    repo_path: String,
    remote: Option<String>,
    bookmark_names: Vec<String>,
) -> Result<MutationResult, String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .git_push(remote, bookmark_names)
        .map_err(|e| format!("Failed to push bookmarks to git remote: {}", e))
}

#[tauri::command]
async fn get_operations(repo_path: String, limit: usize) -> Result<Vec<Operation>, String> {
    let path = Path::new(&repo_path);
    let jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .list_operations(limit)
        .map_err(|e| format!("Failed to list operations: {}", e))
}

#[tauri::command]
async fn undo_operation(repo_path: String, operation_id: String) -> Result<(), String> {
    let path = Path::new(&repo_path);
    let mut jj_repo = JjRepo::open(path).map_err(|e| format!("Failed to open repo: {}", e))?;
    jj_repo
        .undo_operation(&operation_id)
        .map_err(|e| format!("Failed to undo operation: {}", e))
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

/// Get lineage (ancestors and descendants) for multiple revisions in a batch.
#[tauri::command]
async fn get_lineage_batch(
    repo_path: String,
    change_ids: Vec<String>,
) -> Result<Vec<LineageResult>, String> {
    let path = Path::new(&repo_path);

    let results: Vec<LineageResult> = change_ids
        .iter()
        .filter_map(|change_id| repo::log::get_lineage(path, change_id).ok())
        .collect();

    Ok(results)
}

#[derive(Serialize)]
struct FileContentResult {
    base64: String,
    size: usize,
}

/// Get file content as base64 for a specific revision version (current or parent).
/// Used for displaying binary files like images in the diff view.
#[tauri::command]
async fn get_file_content_base64(
    repo_path: String,
    change_id: String,
    file_path: String,
    version: String,
) -> Result<FileContentResult, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let path = Path::new(&repo_path);
    let jj = JjRepo::open(path).map_err(|e| e.to_string())?;
    let commit = jj.get_commit(&change_id).map_err(|e| e.to_string())?;

    let content = match version.as_str() {
        "current" => jj.get_file_content(&commit, &file_path).unwrap_or_default(),
        "parent" => jj
            .get_parent_file_content(&commit, &file_path)
            .unwrap_or_default(),
        _ => return Err("Invalid version: use 'current' or 'parent'".to_string()),
    };

    Ok(FileContentResult {
        base64: STANDARD.encode(&content),
        size: content.len(),
    })
}

/// Handle "Open Project" menu action: show folder picker, find jj repo, save project, emit event
fn handle_open_project(app_handle: &AppHandle) {
    let handle = app_handle.clone();

    app_handle.dialog().file().pick_folder(move |folder_path| {
        let Some(folder) = folder_path else { return };
        let path_str = folder.to_string();

        // Find jj repo root
        let Some(repo_path) = repo::find_jj_repo(&PathBuf::from(&path_str)) else {
            // TODO: Could show an error dialog here
            return;
        };
        let repo_path_str = repo_path.to_string_lossy().to_string();

        // Save project and emit event for frontend navigation
        let handle_clone = handle.clone();
        tauri::async_runtime::spawn(async move {
            let storage = get_storage(&handle_clone);

            // Check if project already exists
            let existing = storage
                .find_project_by_path(&repo_path_str)
                .await
                .ok()
                .flatten();
            let project_id = existing
                .as_ref()
                .map(|p| p.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            let name = repo_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();

            let project = Project {
                id: project_id.clone(),
                path: repo_path_str,
                name,
                last_opened_at: chrono::Utc::now().timestamp_millis(),
                revset_preset: None,
            };

            if let Err(e) = storage.upsert_project(&project).await {
                eprintln!("Failed to save project: {}", e);
                return;
            }

            // Emit event for frontend to navigate
            let _ = handle_clone.emit("open-project", project_id);
        });
    });
}

fn build_app_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_project = MenuItem::with_id(
        app,
        "open-project",
        "Open Project...",
        true,
        Some("Ctrl+Cmd+O"),
    )?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_project)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    #[cfg(debug_assertions)]
    let reload_item = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;

    #[cfg(debug_assertions)]
    let debug_menu = SubmenuBuilder::new(app, "Debug")
        .item(&reload_item)
        .build()?;

    let mut menu_builder = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu);

    #[cfg(debug_assertions)]
    {
        menu_builder = menu_builder.item(&debug_menu);
    }

    let menu = menu_builder.build()?;
    app.set_menu(menu)?;

    Ok(())
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

            // Build application menu
            if let Err(e) = build_app_menu(app) {
                eprintln!("Failed to build menu: {}", e);
            }

            // Handle menu events
            app.on_menu_event(|app_handle, event| match event.id().0.as_str() {
                "open-project" => handle_open_project(app_handle),
                #[cfg(debug_assertions)]
                "reload" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.eval("window.location.reload()");
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            find_repository,
            get_revisions,
            get_status,
            get_conflict_paths,
            get_file_diff,
            get_revision_diff,
            get_revision_changes,
            get_diffs_batch,
            get_changes_batch,
            get_commit_recency,
            resolve_revset,
            get_lineage_batch,
            get_file_content_base64,
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
            jj_describe,
            jj_squash,
            jj_rebase,
            jj_git_fetch,
            jj_git_push,
            get_operations,
            undo_operation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use jj_lib::repo::Repo;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    /// Creates a test jj repository using the jj CLI.
    /// Returns the temp directory (which must be kept alive) and the repo path.
    fn create_test_repo() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("Failed to create temp directory");
        let repo_path = temp_dir.path().to_path_buf();

        // Initialize jj repo using CLI with git backend (most reliable method)
        let status = Command::new("jj")
            .args(["git", "init"])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to run jj git init - is jj installed?");

        assert!(status.success(), "jj git init failed");

        (temp_dir, repo_path)
    }

    /// Snapshot the working copy to capture file changes using jj CLI.
    fn snapshot_working_copy(repo_path: &Path) {
        // jj status triggers a snapshot
        let status = Command::new("jj")
            .args(["status"])
            .current_dir(repo_path)
            .status()
            .expect("Failed to run jj status");

        assert!(status.success(), "jj status failed");
    }

    /// Get the working copy change ID.
    fn get_wc_change_id(repo_path: &Path) -> String {
        let jj_repo = JjRepo::open(repo_path).expect("Failed to open repo");
        let repo = jj_repo
            .repo_loader()
            .load_at_head()
            .expect("Failed to load repo");
        let wc_commit_id = repo
            .view()
            .get_wc_commit_id(jj_repo.workspace_name())
            .expect("No working copy");
        let wc_commit = repo
            .store()
            .get_commit(wc_commit_id)
            .expect("Failed to get commit");
        wc_commit.change_id().reverse_hex()
    }

    fn create_conflicted_working_copy(repo_path: &Path) -> String {
        fs::write(repo_path.join("f.txt"), "base\n").expect("Failed to write base file");
        snapshot_working_copy(repo_path);
        let base_change_id = get_wc_change_id(repo_path);

        let left_new = Command::new("jj")
            .args(["new", "-r", "@"])
            .current_dir(repo_path)
            .status()
            .expect("Failed to create left branch");
        assert!(left_new.success(), "jj new for left branch failed");

        fs::write(repo_path.join("f.txt"), "left\n").expect("Failed to write left file");
        snapshot_working_copy(repo_path);
        let left_change_id = get_wc_change_id(repo_path);

        let edit_base = Command::new("jj")
            .args(["edit", &base_change_id])
            .current_dir(repo_path)
            .status()
            .expect("Failed to return to base");
        assert!(edit_base.success(), "jj edit base failed");

        let right_new = Command::new("jj")
            .args(["new", "-r", "@"])
            .current_dir(repo_path)
            .status()
            .expect("Failed to create right branch");
        assert!(right_new.success(), "jj new for right branch failed");

        fs::write(repo_path.join("f.txt"), "right\n").expect("Failed to write right file");
        snapshot_working_copy(repo_path);
        let right_change_id = get_wc_change_id(repo_path);

        let merge = Command::new("jj")
            .args(["new", &left_change_id, &right_change_id])
            .current_dir(repo_path)
            .status()
            .expect("Failed to create merge conflict");
        assert!(merge.success(), "jj new merge failed");

        get_wc_change_id(repo_path)
    }

    #[test]
    fn test_get_conflict_paths() {
        let (_temp_dir, repo_path) = create_test_repo();
        let conflicted_change_id = create_conflicted_working_copy(&repo_path);

        let jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");
        let conflict_paths = jj_repo
            .get_conflict_paths(&conflicted_change_id)
            .expect("Failed to get conflict paths");

        assert_eq!(conflict_paths, vec!["f.txt".to_string()]);
    }

    #[test]
    fn test_working_copy_status_has_conflict() {
        let (_temp_dir, repo_path) = create_test_repo();
        create_conflicted_working_copy(&repo_path);

        let status = repo::status::fetch_status(&repo_path).expect("Failed to fetch status");
        assert!(
            status.has_conflict,
            "Working copy status should report conflict"
        );
    }

    #[test]
    fn test_compute_revision_diff_inner_with_changes() {
        let (temp_dir, repo_path) = create_test_repo();

        // Create a file in the working copy
        let file_path = repo_path.join("test.txt");
        fs::write(&file_path, "Hello, world!\n").expect("Failed to write file");

        // Snapshot to capture the change
        snapshot_working_copy(&repo_path);

        // Open repo and get the working copy change ID
        let change_id = get_wc_change_id(&repo_path);
        let jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        // Compute diff
        let result = compute_revision_diff_inner(&jj_repo, &change_id);
        assert!(result.is_ok(), "compute_revision_diff_inner should succeed");

        let diff = result.unwrap();
        // The diff should show the new file
        assert!(
            diff.contains("test.txt"),
            "Diff should contain the filename"
        );
        assert!(
            diff.contains("Hello, world!"),
            "Diff should contain the file content"
        );

        drop(temp_dir); // Cleanup
    }

    #[test]
    fn test_compute_revision_diff_inner_empty_commit() {
        let (temp_dir, repo_path) = create_test_repo();

        // Open repo and get the working copy change ID (no changes yet)
        let change_id = get_wc_change_id(&repo_path);
        let jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        // Compute diff for empty commit
        let result = compute_revision_diff_inner(&jj_repo, &change_id);
        assert!(
            result.is_ok(),
            "compute_revision_diff_inner should succeed for empty commit"
        );

        let diff = result.unwrap();
        assert!(
            diff.is_empty(),
            "Diff should be empty for commit with no changes"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_compute_revision_changes_inner_with_added_file() {
        let (temp_dir, repo_path) = create_test_repo();

        // Create a file
        let file_path = repo_path.join("added.txt");
        fs::write(&file_path, "New file content\n").expect("Failed to write file");

        // Snapshot to capture the change
        snapshot_working_copy(&repo_path);

        // Open repo and get the working copy change ID
        let change_id = get_wc_change_id(&repo_path);
        let jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        // Compute changes
        let result = compute_revision_changes_inner(&jj_repo, &change_id);
        assert!(
            result.is_ok(),
            "compute_revision_changes_inner should succeed"
        );

        let files = result.unwrap();
        assert_eq!(files.len(), 1, "Should have exactly one changed file");
        assert_eq!(files[0].path, "added.txt");
        assert_eq!(files[0].status, "added");

        drop(temp_dir);
    }

    #[test]
    fn test_compute_revision_changes_inner_empty_commit() {
        let (temp_dir, repo_path) = create_test_repo();

        // Open repo and get the working copy change ID (no changes)
        let change_id = get_wc_change_id(&repo_path);
        let jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        // Compute changes for empty commit
        let result = compute_revision_changes_inner(&jj_repo, &change_id);
        assert!(
            result.is_ok(),
            "compute_revision_changes_inner should succeed for empty commit"
        );

        let files = result.unwrap();
        assert!(
            files.is_empty(),
            "Should have no changed files for empty commit"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_batch_chunking_multiple_revisions() {
        let (temp_dir, repo_path) = create_test_repo();

        // Create multiple files to have changes in the working copy
        for i in 0..5 {
            let file_path = repo_path.join(format!("file{}.txt", i));
            fs::write(&file_path, format!("Content {}\n", i)).expect("Failed to write file");
        }

        // Snapshot to capture the changes
        snapshot_working_copy(&repo_path);

        // Get the working copy change ID
        let change_id = get_wc_change_id(&repo_path);

        // Test batch processing with the single valid change_id
        let change_ids: Vec<String> = vec![change_id.clone()];

        // Test get_diffs_batch logic using rayon parallel processing
        use rayon::prelude::*;
        let repo_path_ref = &repo_path;
        let results: Vec<RevisionDiff> = change_ids
            .par_iter()
            .filter_map(|cid| {
                let path = Path::new(repo_path_ref);
                let jj = JjRepo::open(path).ok()?;
                match compute_revision_diff_inner(&jj, cid) {
                    Ok(diff) => Some(RevisionDiff {
                        change_id: cid.clone(),
                        diff,
                    }),
                    Err(_) => None,
                }
            })
            .collect();

        assert_eq!(results.len(), 1, "Should have one result");
        assert_eq!(results[0].change_id, change_id);
        // Diff should contain all the files
        for i in 0..5 {
            assert!(
                results[0].diff.contains(&format!("file{}.txt", i)),
                "Diff should contain file{}.txt",
                i
            );
        }

        drop(temp_dir);
    }

    #[test]
    fn test_batch_with_invalid_change_id() {
        let (temp_dir, repo_path) = create_test_repo();

        // Get the working copy change ID
        let valid_change_id = get_wc_change_id(&repo_path);

        // Mix valid and invalid change IDs
        let change_ids: Vec<String> = vec![
            valid_change_id.clone(),
            "invalid_change_id_12345".to_string(),
            "zzzzzzzz".to_string(), // Another invalid one
        ];

        // Test batch processing - invalid IDs should be filtered out
        use rayon::prelude::*;
        let repo_path_ref = &repo_path;
        let results: Vec<RevisionDiff> = change_ids
            .par_iter()
            .filter_map(|cid| {
                let path = Path::new(repo_path_ref);
                let jj = JjRepo::open(path).ok()?;
                match compute_revision_diff_inner(&jj, cid) {
                    Ok(diff) => Some(RevisionDiff {
                        change_id: cid.clone(),
                        diff,
                    }),
                    Err(_) => None,
                }
            })
            .collect();

        // Only the valid change ID should produce a result
        assert_eq!(results.len(), 1, "Should have only one valid result");
        assert_eq!(results[0].change_id, valid_change_id);

        drop(temp_dir);
    }

    #[test]
    fn test_batch_changes_parallel_processing() {
        let (temp_dir, repo_path) = create_test_repo();

        // Create a file
        let file_path = repo_path.join("parallel_test.txt");
        fs::write(&file_path, "Parallel test content\n").expect("Failed to write file");

        // Snapshot to capture the change
        snapshot_working_copy(&repo_path);

        // Get the working copy change ID
        let change_id = get_wc_change_id(&repo_path);

        // Test get_changes_batch logic with parallel processing
        let change_ids: Vec<String> = vec![change_id.clone()];

        use rayon::prelude::*;
        let repo_path_ref = &repo_path;
        let results: Vec<RevisionChanges> = change_ids
            .par_iter()
            .filter_map(|cid| {
                let path = Path::new(repo_path_ref);
                let jj = JjRepo::open(path).ok()?;
                match compute_revision_changes_inner(&jj, cid) {
                    Ok(files) => Some(RevisionChanges {
                        change_id: cid.clone(),
                        files,
                    }),
                    Err(_) => None,
                }
            })
            .collect();

        assert_eq!(results.len(), 1, "Should have one result");
        assert_eq!(results[0].change_id, change_id);
        assert_eq!(results[0].files.len(), 1);
        assert_eq!(results[0].files[0].path, "parallel_test.txt");
        assert_eq!(results[0].files[0].status, "added");

        drop(temp_dir);
    }

    fn get_root_change_id(repo_path: &Path) -> String {
        let jj_repo = JjRepo::open(repo_path).expect("Failed to open repo");
        let repo = jj_repo
            .repo_loader()
            .load_at_head()
            .expect("Failed to load repo");
        let root_commit = repo
            .store()
            .get_commit(repo.store().root_commit_id())
            .expect("Failed to get root commit");
        root_commit.change_id().reverse_hex()
    }

    fn setup_git_remote_with_main_branch() -> (TempDir, PathBuf) {
        let temp_dir = TempDir::new().expect("Failed to create temp directory for git remote");
        let remote_path = temp_dir.path().join("remote.git");
        let seed_path = temp_dir.path().join("seed");

        let init_remote = Command::new("git")
            .args([
                "init",
                "--bare",
                remote_path.to_str().expect("Invalid remote path"),
            ])
            .status()
            .expect("Failed to initialize bare git remote");
        assert!(init_remote.success(), "git init --bare failed");

        fs::create_dir_all(&seed_path).expect("Failed to create seed repo dir");

        let init_seed = Command::new("git")
            .args(["init"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to initialize seed git repo");
        assert!(init_seed.success(), "git init failed for seed repo");

        let config_name = Command::new("git")
            .args(["config", "user.name", "Tatami Test"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to configure git user.name");
        assert!(config_name.success(), "git config user.name failed");

        let config_email = Command::new("git")
            .args(["config", "user.email", "tatami-tests@example.com"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to configure git user.email");
        assert!(config_email.success(), "git config user.email failed");

        fs::write(seed_path.join("README.md"), "seed\n").expect("Failed to write seed file");

        let add = Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to git add seed file");
        assert!(add.success(), "git add failed");

        let commit = Command::new("git")
            .args(["commit", "-m", "seed commit"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to create seed commit");
        assert!(commit.success(), "git commit failed");

        let rename_branch = Command::new("git")
            .args(["branch", "-M", "main"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to rename seed branch to main");
        assert!(rename_branch.success(), "git branch -M main failed");

        let add_remote = Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                remote_path.to_str().expect("Invalid remote path"),
            ])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to add origin remote in seed repo");
        assert!(add_remote.success(), "git remote add origin failed");

        let push_main = Command::new("git")
            .args(["push", "-u", "origin", "main"])
            .current_dir(&seed_path)
            .status()
            .expect("Failed to push seed main branch");
        assert!(push_main.success(), "git push origin main failed");

        (temp_dir, remote_path)
    }

    #[test]
    fn test_describe_revision() {
        let (temp_dir, repo_path) = create_test_repo();

        // Create a file so we have a non-root working-copy commit to describe
        let file_path = repo_path.join("describe.txt");
        fs::write(&file_path, "describe me\n").expect("Failed to write file");
        snapshot_working_copy(&repo_path);

        let change_id = get_wc_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let result = jj_repo
            .describe_revision(&change_id, "New description".to_string())
            .expect("describe_revision should succeed");

        assert!(
            !result.operation_id.is_empty(),
            "Mutation result should include operation_id"
        );

        // Change ID should stay the same after describe rewrite
        assert_eq!(get_wc_change_id(&repo_path), change_id);

        let described_commit = jj_repo
            .get_commit(&change_id)
            .expect("Failed to load described commit");
        assert_eq!(described_commit.description(), "New description");

        let operations = jj_repo
            .list_operations(20)
            .expect("Failed to list operations");
        assert!(
            operations.iter().any(|op| op.id == result.operation_id),
            "Describe operation should appear in operation log"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_describe_immutable_rejected() {
        let (temp_dir, repo_path) = create_test_repo();

        let root_change_id = get_root_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let error = jj_repo
            .describe_revision(&root_change_id, "should fail".to_string())
            .expect_err("Describing immutable root commit should fail");

        assert!(
            error.to_string().contains("immutable"),
            "Error should mention immutable"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_describe_empty_message() {
        let (temp_dir, repo_path) = create_test_repo();

        // Create a file so we have a mutable commit to describe
        let file_path = repo_path.join("empty-message.txt");
        fs::write(&file_path, "empty\n").expect("Failed to write file");
        snapshot_working_copy(&repo_path);

        let change_id = get_wc_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        jj_repo
            .describe_revision(&change_id, "".to_string())
            .expect("Empty description should be allowed");

        let described_commit = jj_repo
            .get_commit(&change_id)
            .expect("Failed to load described commit");
        assert_eq!(described_commit.description(), "");

        drop(temp_dir);
    }

    #[test]
    fn test_squash_revision_into_parent() {
        let (temp_dir, repo_path) = create_test_repo();

        let file_path = repo_path.join("squash.txt");
        fs::write(&file_path, "base\n").expect("Failed to write base file");
        snapshot_working_copy(&repo_path);

        let parent_change_id = get_wc_change_id(&repo_path);

        let new_status = Command::new("jj")
            .args(["new"])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to create child revision for squash");
        assert!(new_status.success(), "jj new failed for squash setup");

        fs::write(&file_path, "base\nchild\n").expect("Failed to update squash file");
        snapshot_working_copy(&repo_path);

        let source_change_id = get_wc_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let result = jj_repo
            .squash_revision(&source_change_id)
            .expect("squash_revision should succeed");

        assert!(
            !result.operation_id.is_empty(),
            "squash should return operation_id"
        );
        let current_wc_change_id = get_wc_change_id(&repo_path);
        assert_ne!(
            current_wc_change_id, source_change_id,
            "source revision should no longer be the working copy after squash"
        );

        let source_lookup = jj_repo.get_commit(&source_change_id);
        assert!(
            source_lookup.is_err(),
            "squashed source revision should no longer be directly addressable"
        );

        let squashed_parent = jj_repo
            .get_commit(&parent_change_id)
            .expect("Failed to load squashed parent commit");
        let content = jj_repo
            .get_file_content(&squashed_parent, "squash.txt")
            .expect("Failed to load squashed file content");
        assert_eq!(
            String::from_utf8(content).expect("File content should be utf-8"),
            "base\nchild\n"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_squash_root_rejected() {
        let (temp_dir, repo_path) = create_test_repo();

        let root_change_id = get_root_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let error = jj_repo
            .squash_revision(&root_change_id)
            .expect_err("Squashing root commit should fail");
        assert!(
            error.to_string().contains("no parent"),
            "Error should mention missing parent"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_rebase_revision_onto_target() {
        let (temp_dir, repo_path) = create_test_repo();

        let file_path = repo_path.join("rebase.txt");
        fs::write(&file_path, "base\n").expect("Failed to write base file");
        snapshot_working_copy(&repo_path);

        let base_change_id = get_wc_change_id(&repo_path);

        let new_source = Command::new("jj")
            .args(["new"])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to create source revision");
        assert!(new_source.success(), "jj new failed for source");

        fs::write(&file_path, "base\nsource\n").expect("Failed to write source file");
        snapshot_working_copy(&repo_path);
        let source_change_id = get_wc_change_id(&repo_path);

        let edit_base = Command::new("jj")
            .args(["edit", &base_change_id])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to edit base revision");
        assert!(edit_base.success(), "jj edit base failed");

        let new_target = Command::new("jj")
            .args(["new"])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to create destination revision");
        assert!(new_target.success(), "jj new failed for destination");

        fs::write(repo_path.join("target.txt"), "target\n").expect("Failed to write target file");
        snapshot_working_copy(&repo_path);
        let destination_change_id = get_wc_change_id(&repo_path);

        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");
        let source_before = jj_repo
            .get_commit(&source_change_id)
            .expect("Failed to load source before rebase");
        let old_parent_id = source_before
            .parent_ids()
            .first()
            .cloned()
            .expect("Source should have a parent");
        let destination_commit = jj_repo
            .get_commit(&destination_change_id)
            .expect("Failed to load destination commit");

        let result = jj_repo
            .rebase_revision(&source_change_id, &destination_change_id)
            .expect("rebase_revision should succeed");

        assert!(
            !result.operation_id.is_empty(),
            "rebase should return operation_id"
        );

        let rebased_source = jj_repo
            .get_commit(&source_change_id)
            .expect("Failed to load rebased source commit");
        let new_parent_id = rebased_source
            .parent_ids()
            .first()
            .expect("Rebased source should have a parent");

        assert_eq!(
            new_parent_id,
            destination_commit.id(),
            "source commit should now have destination as parent"
        );
        assert_ne!(
            new_parent_id, &old_parent_id,
            "source commit should have a different parent after rebase"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_rebase_immutable_rejected() {
        let (temp_dir, repo_path) = create_test_repo();

        let root_change_id = get_root_change_id(&repo_path);
        let destination_change_id = get_wc_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let error = jj_repo
            .rebase_revision(&root_change_id, &destination_change_id)
            .expect_err("Rebasing immutable commit should fail");

        assert!(
            error.to_string().contains("immutable"),
            "Error should mention immutable"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_rebase_invalid_target_rejected() {
        let (temp_dir, repo_path) = create_test_repo();

        let source_change_id = get_wc_change_id(&repo_path);
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let error = jj_repo
            .rebase_revision(&source_change_id, &source_change_id)
            .expect_err("Rebasing onto itself should fail");

        assert!(
            error.to_string().contains("itself"),
            "Error should mention invalid target"
        );

        drop(temp_dir);
    }

    #[test]
    fn test_git_fetch_no_remote() {
        let (_temp_dir, repo_path) = create_test_repo();
        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");

        let err = jj_repo
            .git_fetch(None)
            .expect_err("git_fetch should fail when no remotes are configured");
        assert!(
            err.to_string().contains("No git remotes configured"),
            "Error should mention missing remotes"
        );
    }

    #[test]
    fn test_git_fetch_with_remote() {
        let (_temp_dir, repo_path) = create_test_repo();
        let (_remote_temp_dir, remote_path) = setup_git_remote_with_main_branch();

        let add_remote = Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                remote_path.to_str().expect("Invalid remote path"),
            ])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to add origin remote to jj repo");
        assert!(add_remote.success(), "git remote add origin failed");

        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");
        let result = jj_repo
            .git_fetch(None)
            .expect("git_fetch should succeed with a configured remote");

        assert!(
            !result.operation_id.is_empty(),
            "git_fetch should return an operation id"
        );

        let repo = jj_repo
            .repo_loader()
            .load_at_head()
            .expect("Failed to reload repo after fetch");
        assert!(
            repo.view().all_remote_bookmarks().any(|(symbol, _)| {
                symbol.remote.as_str() == "origin" && symbol.name.as_str() == "main"
            }),
            "Expected fetched main@origin remote bookmark to exist after fetch"
        );
    }

    #[test]
    fn test_git_push_bookmark() {
        let (_temp_dir, repo_path) = create_test_repo();
        let (_remote_temp_dir, remote_path) = setup_git_remote_with_main_branch();

        let add_remote = Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                remote_path.to_str().expect("Invalid remote path"),
            ])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to add origin remote to jj repo");
        assert!(add_remote.success(), "git remote add origin failed");

        let set_bookmark = Command::new("jj")
            .args(["bookmark", "set", "feature", "-r", "@"])
            .current_dir(&repo_path)
            .status()
            .expect("Failed to create feature bookmark");
        assert!(set_bookmark.success(), "jj bookmark set failed");

        let mut jj_repo = JjRepo::open(&repo_path).expect("Failed to open repo");
        let result = jj_repo
            .git_push(None, vec!["feature".to_string()])
            .expect("git_push should succeed for existing bookmark");

        assert!(
            !result.operation_id.is_empty(),
            "git_push should return an operation id"
        );

        let remote_ref = Command::new("git")
            .args([
                "--git-dir",
                remote_path.to_str().expect("Invalid remote path"),
                "rev-parse",
                "--verify",
                "refs/heads/feature",
            ])
            .status()
            .expect("Failed to verify feature branch on remote");
        assert!(
            remote_ref.success(),
            "Expected pushed feature branch to exist on remote"
        );
    }
}
