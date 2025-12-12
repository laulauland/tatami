---
id: fa8ec4f2-22a0-4eb4-bdd9-59ab3ec86ebc
short_id: TAT-11
title: Bookmark and branch management
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:24.495Z
updated_at: 2025-12-12T22:57:24.495Z
---

Implement bookmark/branch operations.

What:
- List all bookmarks
- Create new bookmarks
- Move bookmarks to different revisions
- Delete bookmarks
- Track remote bookmarks

Files:
- src/ui/bookmark_panel.rs (new)
- src/repo/bookmarks.rs (new)

Done:
- Bookmarks visible in sidebar
- Can create bookmark at current revision
- Can move bookmark via context menu
- Can delete bookmarks
- Remote tracking status shown