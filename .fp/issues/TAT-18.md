---
id: 39700150-a875-4a9a-9a66-aa75ffa4a707
short_id: TAT-18
title: Fix timestamp formatting for old commits
status: todo
parent: null
branch: ""
range: null
created_at: 2025-12-13T01:08:16.337Z
updated_at: 2025-12-13T01:08:16.337Z
---

The root commit shows '55 years ago' which is incorrect - likely the epoch time (1970) being parsed wrong.

Investigation needed:
- Check how jj-lib returns timestamps for the root commit
- May need special handling for commits with no/invalid timestamp
- Consider using jj's built-in `author.timestamp().ago()` template function