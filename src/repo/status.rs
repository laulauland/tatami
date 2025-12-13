use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug, PartialEq)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
}

#[derive(Clone, Debug)]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Clone, Debug)]
pub struct WorkingCopyStatus {
    pub change_id: String,
    pub commit_id: String,
    pub description: String,
    pub parent_description: String,
    pub files: Vec<ChangedFile>,
}

pub fn fetch_status(repo_path: &Path) -> Result<WorkingCopyStatus, String> {
    let output = Command::new("jj")
        .args(["status", "--no-pager"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run jj status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("jj status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();
    let mut change_id = String::new();
    let mut commit_id = String::new();
    let mut description = String::new();
    let mut parent_description = String::new();

    for line in stdout.lines() {
        if line.starts_with("Working copy") && line.contains("(@)") {
            if let Some(rest) = line.strip_prefix("Working copy  (@) :") {
                let parts: Vec<&str> = rest.trim().splitn(3, ' ').collect();
                if parts.len() >= 2 {
                    change_id = parts[0].to_string();
                    commit_id = parts[1].to_string();
                    if parts.len() >= 3 {
                        description = parts[2].to_string();
                    }
                }
            }
        } else if line.starts_with("Parent commit") {
            if let Some(rest) = line.strip_prefix("Parent commit (@-):") {
                let parts: Vec<&str> = rest.trim().splitn(3, ' ').collect();
                if parts.len() >= 3 {
                    parent_description = parts[2].to_string();
                }
            }
        } else if line.starts_with("A ") {
            files.push(ChangedFile {
                path: line[2..].to_string(),
                status: FileStatus::Added,
            });
        } else if line.starts_with("M ") {
            files.push(ChangedFile {
                path: line[2..].to_string(),
                status: FileStatus::Modified,
            });
        } else if line.starts_with("D ") {
            files.push(ChangedFile {
                path: line[2..].to_string(),
                status: FileStatus::Deleted,
            });
        }
    }

    Ok(WorkingCopyStatus {
        change_id,
        commit_id,
        description,
        parent_description,
        files,
    })
}
