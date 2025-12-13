pub mod diff;
pub mod jj;
pub mod log;
pub mod status;

use std::path::PathBuf;

use crate::repo::log::Revision;
use crate::repo::status::WorkingCopyStatus;

#[derive(Clone)]
pub enum RepoState {
    NotFound { path: PathBuf },
    Loaded {
        workspace_root: PathBuf,
        revisions: Vec<Revision>,
        status: Option<WorkingCopyStatus>,
    },
    Error { message: String },
}

pub fn find_jj_repo(start_path: &std::path::Path) -> Option<PathBuf> {
    let mut current = start_path.to_path_buf();

    loop {
        let jj_dir = current.join(".jj");
        if jj_dir.is_dir() {
            return Some(current);
        }

        if !current.pop() {
            return None;
        }
    }
}

pub fn load_workspace(path: &std::path::Path) -> RepoState {
    match find_jj_repo(path) {
        Some(workspace_root) => {
            let revisions = log::fetch_log(&workspace_root, 50).unwrap_or_default();
            let status = status::fetch_status(&workspace_root).ok();
            RepoState::Loaded {
                workspace_root,
                revisions,
                status,
            }
        }
        None => RepoState::NotFound {
            path: path.to_path_buf(),
        },
    }
}
