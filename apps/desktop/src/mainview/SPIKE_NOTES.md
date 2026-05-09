# Svelte `@pierre/diffs` spike notes

## Findings

- Text diffs are rendered through the vanilla `FileDiff` class from the `@pierre/diffs` root export. The Svelte wrapper does not import the package's React adapter.
- The package registers its scoped diff custom element from `@pierre/diffs/dist/components/web-components.js`; `FileDiff` is constructed with `isContainerManaged: true` and rendered with `containerWrapper`, not `fileContainer`, so the library creates a real `<diffs-container>` element and installs the scoped shadow-DOM styles.
- Unified and split display are controlled by the `diffStyle` option (`"unified" | "split"`). The spike keeps `lineDiffType: "word"` for intra-line highlighting in both modes.
- Syntax highlighting is attempted with `getOrCreateWorkerPoolSingleton()` and `new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" })`. `vite.electrobun.config.ts` emits the worker as an ES module, and the Svelte wrapper subscribes to `WorkerPoolManager` stats so the panel reports `initialized` versus `workersFailed`. If Electrobun blocks worker loading at runtime, the wrapper documents that in the visible status badge and keeps rendering without highlighting.
- Runtime check on 2026-05-09: `bun run electrobun:dev` built the Electrobun bundle, emitted `assets/worker-*.js`, launched the macOS dev app, and loaded the Bun native addon without process errors. The agent environment does not grant screenshot or assistive-access permissions, so visual verification is exposed in-app through the DiffView status badges rather than captured here.
- The large fixture is a generated 500+ line unified patch. It is selectable from the diff panel and reports synchronous render time in the panel; no startup freeze was observed when launching the Electrobun app with the diff panel present. Full human visual confirmation of scrolling/toggling remains a parity follow-up because this agent cannot interact with the macOS webview.

## Deferred

- Real `getRevisionDiff` RPC data is intentionally out of scope for this revision.
- `VirtualizedFileDiff` exists in `@pierre/diffs`, but requires a virtualizer instance and should be evaluated when the full diff panel renders multiple files.
- Theme integration is only minimally scoped with dark `pierre-dark`/`pierre-light` themes and local `unsafeCSS`; final Tatami theme mapping is deferred.
