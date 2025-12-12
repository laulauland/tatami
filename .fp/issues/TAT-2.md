---
id: edcea01b-5a44-4d58-a25b-d956e33c0ee4
short_id: TAT-2
title: GPUI app foundation and window setup
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
created_at: 2025-12-12T22:56:15.001Z
updated_at: 2025-12-12T23:50:42.132Z
---

Set up the GPUI application structure with main window.

What:
- Initialize GPUI application
- Create main window with basic layout structure
- Set up app state management pattern
- Configure window title, size, and basic styling

Files:
- src/main.rs (modify)
- src/app.rs (new)
- src/ui/mod.rs (new)

Done:
- App launches with a window
- Window has placeholder panels for sidebar, main content, and toolbar