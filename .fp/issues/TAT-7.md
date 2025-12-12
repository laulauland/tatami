---
id: a812eb6c-9e32-4ae0-9bb9-c53c0259096c
short_id: TAT-7
title: Commit and describe operations
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:56:52.280Z
updated_at: 2025-12-12T22:56:52.280Z
---

Implement commit creation and description editing.

What:
- Create new commits from working copy
- Edit commit descriptions
- Support for jj new and jj describe operations
- Commit message editor with multiline support

Files:
- src/ui/commit_editor.rs (new)
- src/repo/operations.rs (new)

Done:
- Can create new empty commit
- Can edit commit description
- Changes saved to repository immediately
- UI updates after commit operations