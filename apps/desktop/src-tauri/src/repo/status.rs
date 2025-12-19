use anyhow::{Context, Result};
use jj_lib::backend::TreeValue;
use jj_lib::matchers::EverythingMatcher;
use jj_lib::object_id::ObjectId;
use jj_lib::repo::Repo;
use std::path::Path;

use super::jj::JjRepo;

#[derive(Clone, Debug, serde::Serialize)]
pub struct WorkingCopyStatus {
    pub change_id: String,
    pub commit_id: String,
    pub description: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
}

pub fn fetch_status(repo_path: &Path) -> Result<WorkingCopyStatus> {
    let jj_repo = JjRepo::open(repo_path)?;
    let repo = jj_repo.repo_loader().load_at_head()?;

    let wc_commit_id = repo
        .view()
        .wc_commit_ids()
        .iter()
        .next()
        .context("No working copy commit")?
        .1;

    let wc_commit = repo.store().get_commit(wc_commit_id)?;
    let change_id = wc_commit.change_id();
    let description = wc_commit.description().to_string();
    let first_line = description
        .lines()
        .next()
        .unwrap_or("(no description)")
        .to_string();

    let parent_tree = {
        let parents = wc_commit.parents();
        let parent = parents.into_iter().next().context("Commit has no parent")?;
        parent?.tree()?
    };

    let wc_tree = wc_commit.tree()?;

    let matcher = EverythingMatcher;
    let mut diff_iter = parent_tree.diff_stream(&wc_tree, &matcher);

    let mut files = Vec::new();

    pollster::block_on(async {
        use futures::StreamExt;
        while let Some(entry) = diff_iter.next().await {
            let path = entry.path;
            let path_str = path.as_internal_file_string();

            let diff_values = entry.values?;
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
        Ok::<(), anyhow::Error>(())
    })?;

    Ok(WorkingCopyStatus {
        change_id: format_change_id(change_id),
        commit_id: hex::encode(&wc_commit_id.to_bytes()[..6]),
        description: first_line,
        files,
    })
}

fn format_change_id(change_id: &jj_lib::backend::ChangeId) -> String {
    let bytes = change_id.to_bytes();
    let mut result = String::with_capacity(12);
    for &byte in &bytes[..6] {
        let c1 = (byte >> 4) as char;
        let c2 = (byte & 0x0f) as char;
        result.push(char::from_u32(b'z' as u32 - c1 as u32).unwrap());
        result.push(char::from_u32(b'z' as u32 - c2 as u32).unwrap());
    }
    result
}
