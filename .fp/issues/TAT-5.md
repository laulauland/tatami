---
id: 164a234a-bf6f-43ca-b959-9634ddcd6ead
short_id: TAT-5
title: Working copy status view
status: done
parent: TAT-1
branch: ""
range:
  base:
    _tag: jj
    changeId: zzyqryzxvuxszunslpsulqwtsrowtvop
  tip:
    _tag: jj
    changeId: nnmuqvwvxypyqknoynwrwnttsmlwultl
created_at: 2025-12-12T22:56:37.954Z
updated_at: 2025-12-13T00:29:04.921Z
---

Display current working copy status and changed files.

What:
- Show current revision info
- List modified, added, deleted files
- Display file status icons
- Show tracked vs untracked files

Files:
- src/ui/status_view.rs (new)
- src/repo/status.rs (new)

Done:
- Current working copy info is displayed
- Changed files list shows correctly
- File status (M/A/D) is indicated visually