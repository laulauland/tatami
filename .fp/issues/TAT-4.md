---
id: 99b069df-7306-4e79-8316-335ff4852d0b
short_id: TAT-4
title: Revision log display
status: done
parent: TAT-1
branch: ""
range:
  base:
    _tag: jj
    changeId: zzyqryzxvuxszunslpsulqwtsrowtvop
  tip:
    _tag: jj
    changeId: zzyqryzxvuxszunslpsulqwtsrowtvop
created_at: 2025-12-12T22:56:30.055Z
updated_at: 2025-12-13T00:00:03.308Z
---

Display the revision history graph in the UI.

What:
- Fetch revision log from repository
- Render revision graph (similar to jj log output)
- Show commit ID, description, author, timestamp
- Display branch/bookmark indicators
- Handle large histories with virtualized scrolling

Files:
- src/ui/log_view.rs (new)
- src/repo/log.rs (new)

Done:
- Revision graph renders correctly
- Can scroll through history
- Selected revision is highlighted
- Branches/bookmarks are visible