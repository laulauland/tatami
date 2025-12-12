---
id: 9fea07bc-dbc7-4e2f-a3dd-025bd7aa011b
short_id: TAT-12
title: Remote operations (push/fetch)
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:31.701Z
updated_at: 2025-12-12T22:57:31.701Z
---

Implement git remote integration.

What:
- Fetch from remotes
- Push bookmarks to remotes
- Show ahead/behind status
- Handle authentication (SSH keys, credentials)

Files:
- src/repo/remote.rs (new)
- src/ui/remote_dialog.rs (new)

Done:
- Can fetch from configured remotes
- Can push bookmarks to remotes
- Progress indicator during operations
- Auth errors handled gracefully