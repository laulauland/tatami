use similar::{ChangeTag, TextDiff};

#[derive(Clone, Debug)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffDisplayHunk>,
}

#[derive(Clone, Debug)]
pub struct DiffDisplayHunk {
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Deleted(String),
}

pub fn compute_file_diff(old_content: &[u8], new_content: &[u8], path: String) -> FileDiff {
    let old_text = String::from_utf8_lossy(old_content);
    let new_text = String::from_utf8_lossy(new_content);

    let diff = TextDiff::from_lines(&old_text, &new_text);
    let mut lines = Vec::new();

    for change in diff.iter_all_changes() {
        let line = change.to_string();
        let diff_line = match change.tag() {
            ChangeTag::Delete => DiffLine::Deleted(line),
            ChangeTag::Insert => DiffLine::Added(line),
            ChangeTag::Equal => DiffLine::Context(line),
        };
        lines.push(diff_line);
    }

    let hunk = DiffDisplayHunk { lines };

    FileDiff {
        path,
        hunks: vec![hunk],
    }
}
