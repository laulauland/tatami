---
id: 9a4eb0c1-f56e-4539-a445-4322e5477734
short_id: TAT-8
title: Squash and amend operations
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:01.422Z
updated_at: 2025-12-12T22:57:01.422Z
---

Implement squash and amend functionality.

What:
- Squash changes into parent revision
- Amend current revision with working copy changes
- Interactive squash with commit selection
- Preview squash result before applying

Files:
- src/repo/squash.rs (new)
- src/ui/squash_dialog.rs (new)

Done:
- Can squash current into parent
- Can amend revision with new changes
- Confirmation dialog before destructive operations
- Log view updates after squash/amend