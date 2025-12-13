---
name: gpui-async-windows
description: GPUI async patterns and multiple window management. Use when spawning background tasks, opening new windows, or managing window communication.
---

# GPUI Async and Windows

## Spawning Async Tasks

### From Context (main thread)

```rust
impl MyView {
    fn load_data(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // spawn_in - keeps window context, weak reference to self
        cx.spawn_in(window, async move |this, cx| {
            // this: WeakEntity<Self>
            // cx: AsyncWindowContext

            let data = fetch_data().await;

            // Update view back on main thread
            this.update(&mut cx, |view, window, cx| {
                view.data = Some(data);
                cx.notify();
            }).ok();
        }).detach();
    }
}
```

### Background Executor (off main thread)

```rust
// CPU-intensive work
let result = cx.background_executor().spawn(async move {
    expensive_computation()
}).await;

// With priority
cx.background_executor()
    .spawn_with_priority(Priority::Low, async move {
        background_work()
    })
    .detach();
```

### Foreground Executor (main thread)

```rust
cx.foreground_executor().spawn(async move {
    // Runs on main thread
}).detach();
```

## Task Management

```rust
struct MyView {
    loading_task: Option<Task<()>>,
}

impl MyView {
    fn start_loading(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Cancel previous task by dropping
        self.loading_task = None;

        self.loading_task = Some(cx.spawn_in(window, async move |this, cx| {
            let result = load_something().await;

            this.update(&mut cx, |view, window, cx| {
                view.data = result;
                view.loading_task = None;
                cx.notify();
            }).ok();
        }));
    }

    fn cancel_loading(&mut self) {
        // Dropping the task cancels it
        self.loading_task = None;
    }
}
```

## AsyncApp and AsyncWindowContext

For holding context across await points:

```rust
// AsyncApp - app-level async context
cx.spawn(async move |cx: AsyncApp| {
    // Read global state
    let value = cx.read_global::<MyGlobal, _>(|global, _| {
        global.some_value.clone()
    })?;

    // Update global state
    cx.update_global::<MyGlobal, _>(|global, _| {
        global.count += 1;
    })?;

    Ok(())
});

// AsyncWindowContext - window-scoped async context
cx.spawn_in(window, async move |this, cx: AsyncWindowContext| {
    // Update entity
    this.update(&mut cx, |view, window, cx| {
        view.do_something(window, cx);
    })?;

    Ok(())
});
```

## Creating Windows

### Basic Window

```rust
cx.open_window(
    WindowOptions {
        titlebar: Some(TitlebarOptions {
            title: Some("My Window".into()),
            ..Default::default()
        }),
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: point(px(100.0), px(100.0)),
            size: size(px(800.0), px(600.0)),
        })),
        ..Default::default()
    },
    |window, cx| {
        cx.new(|cx| MyView::new(cx))
    },
)?;
```

### Window Options

```rust
WindowOptions {
    // Title bar
    titlebar: Some(TitlebarOptions {
        title: Some("Title".into()),
        appears_transparent: false,
        traffic_light_position: None, // macOS traffic lights
    }),

    // Bounds
    window_bounds: Some(WindowBounds::Windowed(bounds)),
    // or WindowBounds::Maximized, WindowBounds::Fullscreen

    // Behavior
    focus: true,
    show: true,
    kind: WindowKind::Normal,  // or PopUp, Menu

    // Display
    display_id: None,  // Specific monitor

    // macOS specific
    app_id: None,
    window_background: WindowBackgroundAppearance::Opaque,

    ..Default::default()
}
```

### From Async Context

```rust
cx.spawn(async move |cx: AsyncApp| {
    cx.open_window(options, |window, cx| {
        cx.new(|cx| MyView::new(cx))
    })?;
    Ok(())
});
```

## Window Handles

### WindowHandle<V> (typed)

```rust
let handle: WindowHandle<MyView> = cx.open_window(options, build)?;

// Read root view
let value = handle.read(cx)?.some_field;

// Update root view
handle.update(cx, |view, window, cx| {
    view.do_something(window, cx);
})?;

// Read with callback
handle.read_with(cx, |view, cx| {
    view.get_value()
})?;
```

### AnyWindowHandle (untyped)

```rust
let any_handle: AnyWindowHandle = handle.into();

// Downcast back to typed
if let Some(typed) = any_handle.downcast::<MyView>() {
    typed.update(cx, |view, window, cx| { /* ... */ })?;
}

// Update without type
any_handle.update(cx, |any_view, window, cx| {
    // any_view: AnyView
})?;
```

## Window-to-Window Communication

### Via Global State

```rust
// Global event bus
struct AppEvents {
    listeners: Vec<Box<dyn Fn(&AppEvent, &mut App)>>,
}
impl Global for AppEvents {}

// Window 1: emit event
cx.update_global::<AppEvents, _>(|events, cx| {
    for listener in &events.listeners {
        listener(&AppEvent::DataChanged, cx);
    }
});

// Window 2: subscribe to events
let subscription = cx.observe_global::<AppEvents>(|view, cx| {
    view.refresh(cx);
});
```

### Via Entity

```rust
// Shared model between windows
let shared_model: Entity<SharedData> = cx.new(|_| SharedData::new());

// Window 1: updates model
shared_model.update(cx, |model, cx| {
    model.value = 42;
    cx.notify();
});

// Window 2: observes model
cx.observe(&shared_model, |view, model, cx| {
    view.sync_from_model(model.read(cx), cx);
});
```

### Via Window Handle

```rust
// Store handle to other window
struct Window1 {
    window2_handle: Option<WindowHandle<Window2>>,
}

// Communicate
if let Some(handle) = &self.window2_handle {
    handle.update(cx, |window2, window, cx| {
        window2.receive_message(message, window, cx);
    }).ok();
}
```

## Modal Windows

Pattern for modal dialogs:

```rust
struct ModalLayer {
    active_modal: Option<ActiveModal>,
}

struct ActiveModal {
    view: AnyView,
    previous_focus: Option<FocusHandle>,
    subscriptions: Vec<Subscription>,
}

impl ModalLayer {
    fn show_modal<V: ModalView>(
        &mut self,
        build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let previous_focus = window.focused(cx);
        let modal = cx.new(|cx| build(window, cx));

        // Subscribe to dismiss
        let subscription = cx.subscribe(&modal, |this, _, _: &DismissEvent, window, cx| {
            this.hide_modal(window, cx);
        });

        self.active_modal = Some(ActiveModal {
            view: modal.into(),
            previous_focus,
            subscriptions: vec![subscription],
        });

        // Focus modal
        cx.defer_in(window, |this, window, cx| {
            if let Some(modal) = &this.active_modal {
                window.focus(&modal.focus_handle);
            }
        });
    }

    fn hide_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(modal) = self.active_modal.take() {
            // Restore previous focus
            if let Some(handle) = modal.previous_focus {
                window.focus(&handle);
            }
        }
        cx.notify();
    }
}
```

## Timeouts and Intervals

```rust
// One-shot timer
cx.spawn_in(window, async move |this, cx| {
    cx.background_executor().timer(Duration::from_secs(1)).await;
    this.update(&mut cx, |view, _, cx| {
        view.on_timeout(cx);
    }).ok();
}).detach();

// Repeating interval
cx.spawn_in(window, async move |this, cx| {
    loop {
        cx.background_executor().timer(Duration::from_millis(100)).await;
        if this.update(&mut cx, |view, _, cx| {
            view.tick(cx)  // returns false to stop
        }).unwrap_or(false) == false {
            break;
        }
    }
}).detach();
```

## Task Priority

```rust
pub enum Priority {
    Realtime,  // Immediate, blocks UI
    High,      // Important background work
    Medium,    // Default
    Low,       // Can wait
}

cx.spawn_in_with_priority(Priority::Low, window, async move |this, cx| {
    // Low priority background work
});
```
