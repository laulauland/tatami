use std::path::Path;
use std::process::Command;

#[derive(Clone, Debug)]
pub struct Revision {
    pub commit_id: String,
    pub change_id: String,
    pub description: String,
    pub author: String,
    pub timestamp: String,
    pub is_working_copy: bool,
    pub is_immutable: bool,
    pub bookmarks: Vec<String>,
}

pub fn fetch_log(repo_path: &Path, limit: usize) -> Result<Vec<Revision>, String> {
    let template = r#"commit_id.short() ++ "\x00" ++ change_id.short() ++ "\x00" ++ if(description, description.first_line(), "(no description)") ++ "\x00" ++ author.name() ++ "\x00" ++ author.timestamp().ago() ++ "\x00" ++ if(immutable, "immutable", "mutable") ++ "\x00" ++ bookmarks.map(|b| b.name()).join(",") ++ "\x1e""#;

    let output = Command::new("jj")
        .args([
            "log",
            "--no-pager",
            "-T",
            template,
            "--limit",
            &limit.to_string(),
        ])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to run jj log: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("jj log failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut revisions = Vec::new();

    for (idx, record) in stdout.split('\x1e').enumerate() {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }

        let line = record.trim_start_matches(['@', '│', '├', '└', '◆', '○', '◉', ' ', '─']);
        let parts: Vec<&str> = line.split('\x00').collect();

        if parts.len() >= 6 {
            let bookmarks: Vec<String> = if parts.len() > 6 && !parts[6].is_empty() {
                parts[6].split(',').map(|s| s.to_string()).collect()
            } else {
                Vec::new()
            };

            revisions.push(Revision {
                commit_id: parts[0].to_string(),
                change_id: parts[1].to_string(),
                description: parts[2].to_string(),
                author: parts[3].to_string(),
                timestamp: parts[4].to_string(),
                is_working_copy: idx == 0,
                is_immutable: parts[5] == "immutable",
                bookmarks,
            });
        }
    }

    Ok(revisions)
}
