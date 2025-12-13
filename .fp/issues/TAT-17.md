---
id: 0a5afd78-0d56-4713-a89b-645b1d4e712a
short_id: TAT-17
title: Fetch file changes for revisions
status: todo
parent: null
branch: ""
range: null
created_at: 2025-12-13T01:08:07.508Z
updated_at: 2025-12-13T01:08:07.508Z
---

The expanded revision view needs to show file changes (added/modified/deleted files).

Implementation:
- Add a `files: Vec<ChangedFile>` field to the Revision struct (or load lazily on selection)
- Run `jj diff --stat -r <revision>` to get file changes
- Parse the output and display in the expanded detail view

This data is needed to show what files changed in each revision.