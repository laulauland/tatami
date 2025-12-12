---
id: 2a3bd3ee-fc29-4f9e-95f0-804df9df910e
short_id: TAT-1
title: Tatami MVP - Jujutsu GUI Client
status: todo
parent: null
branch: ""
range: null
created_at: 2025-12-12T22:56:07.256Z
updated_at: 2025-12-12T22:56:07.256Z
---

Build a GPU-accelerated desktop GUI client for Jujutsu (jj) version control using GPUI.

Goals:
- Provide a visual interface for all common jj operations
- Display repository state clearly (log, status, diffs)
- Support complete jj workflow: commit, amend, squash, rebase, conflict resolution
- Native macOS app with fast, responsive UI

Technical stack:
- GPUI for GPU-accelerated UI rendering
- jj-lib for direct Jujutsu integration
- Rust for performance and safety

Success criteria:
- Can open any jj repository
- Display revision graph and file changes
- Perform all basic jj operations through UI
- Handle conflicts visually