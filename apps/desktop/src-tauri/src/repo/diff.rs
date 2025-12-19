use anyhow::Result;
use similar::{ChangeTag, TextDiff};

#[derive(Clone, Debug, serde::Serialize)]
pub struct FileDiff {
    pub path: String,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct DiffLine {
    pub line_type: String,
    pub content: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
}

pub fn compute_file_diff(old_content: &[u8], new_content: &[u8], path: String) -> Result<FileDiff> {
    let old_text = String::from_utf8_lossy(old_content);
    let new_text = String::from_utf8_lossy(new_content);

    let diff = TextDiff::from_lines(&old_text, &new_text);
    let mut lines = Vec::new();
    let mut old_line_num = 1u32;
    let mut new_line_num = 1u32;

    for change in diff.iter_all_changes() {
        let content = change.to_string().trim_end_matches('\n').to_string();
        let diff_line = match change.tag() {
            ChangeTag::Delete => {
                let line = DiffLine {
                    line_type: "remove".to_string(),
                    content,
                    old_line_number: Some(old_line_num),
                    new_line_number: None,
                };
                old_line_num += 1;
                line
            }
            ChangeTag::Insert => {
                let line = DiffLine {
                    line_type: "add".to_string(),
                    content,
                    old_line_number: None,
                    new_line_number: Some(new_line_num),
                };
                new_line_num += 1;
                line
            }
            ChangeTag::Equal => {
                let line = DiffLine {
                    line_type: "context".to_string(),
                    content,
                    old_line_number: Some(old_line_num),
                    new_line_number: Some(new_line_num),
                };
                old_line_num += 1;
                new_line_num += 1;
                line
            }
        };
        lines.push(diff_line);
    }

    let hunk = DiffHunk {
        old_start: 1,
        old_count: old_line_num - 1,
        new_start: 1,
        new_count: new_line_num - 1,
        lines,
    };

    Ok(FileDiff {
        path,
        hunks: vec![hunk],
    })
}
