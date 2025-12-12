---
id: 5fd3efc3-251a-4de7-98db-eac49cf54121
short_id: TAT-13
title: Undo/redo with operation log
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:38.428Z
updated_at: 2025-12-12T22:57:38.428Z
---

Implement undo functionality using jj operation log.

What:
- Display operation history
- Undo last operation
- Restore to any previous operation state
- Show what each operation changed

Files:
- src/ui/operation_log.rs (new)
- src/repo/undo.rs (new)

Done:
- Can view operation history
- Can undo last operation
- Can restore to arbitrary operation
- Confirmation before destructive undo