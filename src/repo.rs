pub mod log;

use std::path::PathBuf;

use crate::repo::log::Revision;

#[derive(Clone)]
pub enum RepoState {
    NotFound { path: PathBuf },
    Loaded {
        workspace_root: PathBuf,
        revisions: Vec<Revision>,
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
            RepoState::Loaded {
                workspace_root,
                revisions,
            }
        }
        None => RepoState::NotFound {
            path: path.to_path_buf(),
        },
    }
}
