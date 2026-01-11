use anyhow::Result;
use similar::TextDiff;

pub fn compute_file_diff(old_content: &[u8], new_content: &[u8], path: &str) -> Result<String> {
    let old_text = String::from_utf8_lossy(old_content);
    let new_text = String::from_utf8_lossy(new_content);

    let diff = TextDiff::from_lines(&old_text, &new_text);
    let unified = diff
        .unified_diff()
        .header(&format!("a/{}", path), &format!("b/{}", path))
        .context_radius(3)
        .to_string();

    Ok(unified)
}
