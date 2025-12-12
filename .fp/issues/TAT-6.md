---
id: 21e2c547-f555-44cd-bcbe-0df1e6c0e908
short_id: TAT-6
title: File diff viewer
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:56:45.526Z
updated_at: 2025-12-12T22:56:45.526Z
---

Display file diffs with syntax highlighting.

What:
- Show unified diff for selected file
- Syntax highlighting for code
- Line-by-line diff with additions/deletions colored
- Support for viewing diffs between any two revisions

Files:
- src/ui/diff_view.rs (new)
- src/repo/diff.rs (new)

Done:
- Clicking a file shows its diff
- Additions highlighted in green, deletions in red
- Diff viewer scrolls for large files
- Can compare arbitrary revisions