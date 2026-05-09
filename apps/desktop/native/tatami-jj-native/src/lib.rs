use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde::Serialize;
use std::path::Path;
use tatami_desktop_lib::repo::diff;
use tatami_desktop_lib::repo::jj::{JjRepo, MutationResult};
use tatami_desktop_lib::repo::log::fetch_log;

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

/// Check if content appears to be binary (contains null bytes in first 8KB).
/// Binary and image diffs are intentionally deferred for the read-only diff panel.
fn is_binary_content(content: &[u8]) -> bool {
    let check_len = content.len().min(8192);
    content[..check_len].contains(&0)
}

fn to_napi_error(error: impl ToString) -> Error {
    Error::from_reason(error.to_string())
}

fn compute_revision_diff_inner(
    jj_repo: &JjRepo,
    change_id: &str,
) -> std::result::Result<String, String> {
    use futures::StreamExt;
    use jj_lib::backend::TreeValue;
    use jj_lib::matchers::EverythingMatcher;
    use rayon::prelude::*;

    let commit = jj_repo
        .get_commit(change_id)
        .map_err(|error| format!("Failed to get commit: {error}"))?;

    let parent_tree = {
        let parents = commit.parents();
        let parent = parents
            .into_iter()
            .next()
            .ok_or_else(|| "Commit has no parent".to_string())?;
        parent
            .map_err(|error| format!("Failed to get parent: {error}"))?
            .tree()
            .map_err(|error| format!("Failed to get parent tree: {error}"))?
    };

    let commit_tree = commit
        .tree()
        .map_err(|error| format!("Failed to get commit tree: {error}"))?;

    let matcher = EverythingMatcher;
    let mut diff_iter = parent_tree.diff_stream(&commit_tree, &matcher);

    let repo = jj_repo
        .repo_loader()
        .load_at_head()
        .map_err(|error| format!("Failed to load repo: {error}"))?;

    let mut file_contents: Vec<(String, Vec<u8>, Vec<u8>)> = Vec::new();

    pollster::block_on(async {
        while let Some(entry) = diff_iter.next().await {
            let path = entry.path;
            let path_str = path.as_internal_file_string();

            let diff_values = entry
                .values
                .map_err(|error| format!("Failed to get diff values: {error}"))?;
            let before = diff_values
                .before
                .removes()
                .next()
                .and_then(|value| value.as_ref());
            let after = diff_values
                .after
                .adds()
                .next()
                .and_then(|value| value.as_ref());

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

                    if is_binary_content(&old_content) || is_binary_content(&new_content) {
                        file_contents.push((
                            path_str.to_string(),
                            Vec::new(),
                            format!("Binary file changed: {path_str}\n").into_bytes(),
                        ));
                        continue;
                    }

                    file_contents.push((path_str.to_string(), old_content, new_content));
                }
                _ => continue,
            };
        }
        Ok::<(), String>(())
    })?;

    let unified_diffs: Vec<String> = file_contents
        .par_iter()
        .filter_map(|(path, old, new)| diff::compute_file_diff(old, new, path).ok())
        .filter(|diff| !diff.is_empty())
        .collect();

    Ok(unified_diffs.join("\n"))
}

fn compute_revision_changes_inner(
    jj_repo: &JjRepo,
    change_id: &str,
) -> std::result::Result<Vec<ChangedFile>, String> {
    use futures::StreamExt;
    use jj_lib::backend::TreeValue;
    use jj_lib::matchers::EverythingMatcher;

    let commit = jj_repo
        .get_commit(change_id)
        .map_err(|error| format!("Failed to get commit: {error}"))?;

    let parent_tree = {
        let parents = commit.parents();
        let parent = parents
            .into_iter()
            .next()
            .ok_or_else(|| "Commit has no parent".to_string())?;
        parent
            .map_err(|error| format!("Failed to get parent: {error}"))?
            .tree()
            .map_err(|error| format!("Failed to get parent tree: {error}"))?
    };

    let commit_tree = commit
        .tree()
        .map_err(|error| format!("Failed to get commit tree: {error}"))?;

    let matcher = EverythingMatcher;
    let mut diff_iter = parent_tree.diff_stream(&commit_tree, &matcher);
    let mut files = Vec::new();

    pollster::block_on(async {
        while let Some(entry) = diff_iter.next().await {
            let path = entry.path;
            let path_str = path.as_internal_file_string();

            let diff_values = entry
                .values
                .map_err(|error| format!("Failed to get diff values: {error}"))?;
            let before = diff_values
                .before
                .removes()
                .next()
                .and_then(|value| value.as_ref());
            let after = diff_values
                .after
                .adds()
                .next()
                .and_then(|value| value.as_ref());

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

#[napi]
pub fn get_revisions_json(
    repo_path: String,
    limit: u32,
    revset: Option<String>,
    preset: Option<String>,
) -> Result<String> {
    let revisions = fetch_log(
        Path::new(&repo_path),
        limit as usize,
        revset.as_deref(),
        preset.as_deref(),
    )
    .map_err(to_napi_error)?;

    serde_json::to_string(&revisions).map_err(to_napi_error)
}

#[napi]
pub fn get_revision_changes_json(repo_path: String, change_id: String) -> Result<String> {
    let jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let changes = compute_revision_changes_inner(&jj_repo, &change_id).map_err(to_napi_error)?;
    serde_json::to_string(&changes).map_err(to_napi_error)
}

#[napi]
pub fn get_revision_diff_json(repo_path: String, change_id: String) -> Result<String> {
    let jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    compute_revision_diff_inner(&jj_repo, &change_id).map_err(to_napi_error)
}

#[napi]
pub fn get_changes_batch_json(repo_path: String, change_ids: Vec<String>) -> Result<String> {
    let jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let changes: Vec<RevisionChanges> = change_ids
        .iter()
        .filter_map(|change_id| {
            compute_revision_changes_inner(&jj_repo, change_id)
                .ok()
                .map(|files| RevisionChanges {
                    change_id: change_id.clone(),
                    files,
                })
        })
        .collect();

    serde_json::to_string(&changes).map_err(to_napi_error)
}

#[napi]
pub fn get_diffs_batch_json(repo_path: String, change_ids: Vec<String>) -> Result<String> {
    let jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let diffs: Vec<RevisionDiff> = change_ids
        .iter()
        .filter_map(|change_id| {
            compute_revision_diff_inner(&jj_repo, change_id)
                .ok()
                .map(|diff| RevisionDiff {
                    change_id: change_id.clone(),
                    diff,
                })
        })
        .collect();

    serde_json::to_string(&diffs).map_err(to_napi_error)
}

fn mutation_result_to_json(result: MutationResult) -> Result<String> {
    serde_json::to_string(&result).map_err(to_napi_error)
}

#[napi]
pub fn generate_change_ids(repo_path: String, count: u32) -> Result<Vec<String>> {
    let jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    jj_repo
        .generate_change_ids(count as usize)
        .map_err(to_napi_error)
}

#[napi]
pub fn jj_new(
    repo_path: String,
    parent_change_ids: Vec<String>,
    change_id: Option<String>,
) -> Result<String> {
    let mut jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let result = jj_repo
        .new_revision(parent_change_ids, change_id)
        .map_err(to_napi_error)?;
    mutation_result_to_json(result)
}

#[napi]
pub fn jj_edit(repo_path: String, change_id: String) -> Result<String> {
    let mut jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let result = jj_repo.edit_revision(change_id).map_err(to_napi_error)?;
    mutation_result_to_json(result)
}

#[napi]
pub fn jj_abandon(repo_path: String, change_id: String) -> Result<String> {
    let mut jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let result = jj_repo
        .abandon_revision(&change_id)
        .map_err(to_napi_error)?;
    mutation_result_to_json(result)
}

#[napi]
pub fn jj_describe(repo_path: String, change_id: String, description: String) -> Result<String> {
    let mut jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let result = jj_repo
        .describe_revision(&change_id, description)
        .map_err(to_napi_error)?;
    mutation_result_to_json(result)
}

#[napi]
pub fn jj_squash(repo_path: String, change_id: String) -> Result<String> {
    let mut jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let result = jj_repo
        .squash_revision(&change_id)
        .map_err(to_napi_error)?;
    mutation_result_to_json(result)
}

#[napi]
pub fn jj_rebase(
    repo_path: String,
    source_change_id: String,
    destination_change_id: String,
) -> Result<String> {
    let mut jj_repo = JjRepo::open(Path::new(&repo_path)).map_err(to_napi_error)?;
    let result = jj_repo
        .rebase_revision(&source_change_id, &destination_change_id)
        .map_err(to_napi_error)?;
    mutation_result_to_json(result)
}
