---
id: fb2fc8bb-b8a1-4678-a3bd-e86ae5885bef
short_id: TAT-16
title: Live repository updates via filesystem watching
status: in-progress
parent: TAT-1
branch: ""
range:
  base: &a1
    _tag: jj
    changeId: nnmuqvwvxypyqknoynwrwnttsmlwultl
  tip: *a1
created_at: 2025-12-13T00:28:52.099Z
updated_at: 2025-12-13T00:28:57.848Z
---

## Problem
The revision view and working copy status are only loaded once at startup. If the underlying repository state changes (new commits, file modifications, etc.), the UI does not update.

## Solution
Use the notify crate to watch the .jj directory for changes and trigger UI refresh.

## Implementation
1. Add notify dependency (with debouncer to handle rapid changes)
2. Create a file watcher that monitors .jj/repo directory
3. On change detection, reload repository state via repo::load_workspace()
4. Update the GPUI model to trigger re-render

## Technical Notes
- notify is the standard Rust filesystem watching crate (62M+ downloads)
- Used by rust-analyzer, deno, watchexec, mdBook
- Need to integrate with GPUI async runtime
- Consider using notify-debouncer-mini to batch rapid file changes