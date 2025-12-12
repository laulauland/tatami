---
id: 8bf102bd-bab1-412e-b653-6195cba4c48e
short_id: TAT-10
title: Conflict resolution UI
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:17.107Z
updated_at: 2025-12-12T22:57:17.107Z
---

Build UI for resolving merge conflicts.

What:
- Detect and display conflicted files
- Three-way merge view (base, left, right)
- Allow manual conflict resolution
- Mark files as resolved
- Support jj resolve workflow

Files:
- src/ui/conflict_view.rs (new)
- src/repo/conflicts.rs (new)

Done:
- Conflicted files highlighted in status
- Can view three-way diff
- Can edit and save resolved file
- Can mark conflict as resolved
- Repository state updates correctly