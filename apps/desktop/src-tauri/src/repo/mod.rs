pub mod diff;
pub mod jj;
pub mod log;
pub mod status;

use std::path::PathBuf;

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
