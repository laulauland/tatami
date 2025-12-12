---
id: 426c0cce-6361-4505-9d3e-71792afc3ed9
short_id: TAT-15
title: Keyboard shortcuts and command palette
status: todo
parent: TAT-1
branch: ""
range: null
created_at: 2025-12-12T22:57:54.109Z
updated_at: 2025-12-12T22:57:54.109Z
---

Add keyboard navigation and command palette.

What:
- Global keyboard shortcuts for common actions
- Command palette (Cmd+P style)
- Vim-style navigation option
- Customizable keybindings

Files:
- src/ui/command_palette.rs (new)
- src/keybindings.rs (new)

Done:
- Common shortcuts work (Cmd+S, Cmd+Z, etc.)
- Command palette opens with Cmd+Shift+P
- Actions searchable by name
- Keyboard focus management works