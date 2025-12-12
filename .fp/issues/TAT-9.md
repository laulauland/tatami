---
id: 458e1438-253b-4422-a61e-4bb573430cd7
short_id: TAT-9
title: Rebase operations
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:09.175Z
updated_at: 2025-12-12T22:57:09.175Z
---

Implement revision rebasing functionality.

What:
- Rebase revision onto different parent
- Drag-and-drop rebase in log view
- Rebase entire branch/subtree
- Handle rebase conflicts gracefully

Files:
- src/repo/rebase.rs (new)
- src/ui/rebase_dialog.rs (new)

Done:
- Can rebase single revision
- Can rebase subtree of revisions
- UI indicates when rebase causes conflicts
- Log view updates after rebase