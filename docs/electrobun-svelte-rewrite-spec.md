# Electrobun + Svelte 5 Rewrite Spec

## Summary

Rewrite Tatami's desktop frontend from React/Tauri to Svelte 5/Electrobun while preserving the Rust `jj-lib` integration. The new app keeps `jj-lib` in native Rust, exposes command-shaped operations through a Rust Node-API addon, calls those operations from the Electrobun Bun backend, and renders the UI with Svelte 5.

The migration should be staged in parallel with the current Tauri app until feature parity is reached.

## Goals

- Replace React UI with Svelte 5 components.
- Replace Tauri shell with Electrobun.
- Keep using `jj-lib`; do not reimplement Jujutsu in Zig/TypeScript.
- Avoid subprocess-per-call overhead.
- Use Rust Node-API (`napi-rs`) as the in-process native boundary.
- Keep using Effect as the service/workflow layer.
- Keep using TanStack DB, with `@tanstack/svelte-db` in Svelte components.
- Preserve current behavior: project storage, revision graph, diffs, mutations, watchers, operation log, deep links where supported.

## Non-goals

- Full `jj-lib` browser WASM port.
- Raw Bun FFI as the default native boundary.
- Rewriting all data/state logic at once.
- Shipping two frameworks permanently. Transitional islands are acceptable only as short-lived migration tools.

## Reference snapshots

Local source references are intentionally ignored by version control and are available in two local reference directories:

- `.references/svelte` — Svelte source snapshot.
- `.references/effect-smol` — Effect v4 / effect-smol source snapshot.
- `.references/electrobun` — Electrobun source snapshot. Useful entry points:
  - `.references/electrobun/package/src/bun/index.ts`
  - `.references/electrobun/package/src/shared/rpc.ts`
  - `.references/electrobun/package/src/bun/ElectrobunConfig.ts`
  - `.references/electrobun/templates/svelte/electrobun.config.ts`
- `.references/tanstack-db` — TanStack DB source snapshot. Useful entry points:
  - `.references/tanstack-db/packages/db/src/index.ts`
  - `.references/tanstack-db/packages/db/src/collection/index.ts`
  - `.references/tanstack-db/packages/query-db-collection/src/index.ts`
  - `.references/tanstack-db/packages/svelte-db/src/useLiveQuery.svelte.ts`

The `.references/README.md` file records the source repository URLs and approximate cloned HEADs for all reference snapshots.

## Target architecture

```txt
Svelte 5 WebView
  ├─ UI components
  ├─ TanStack DB / Query adapters
  ├─ Effect frontend services
  └─ typed Electrobun RPC client
        ⇅
Electrobun Bun backend
  ├─ BrowserWindow / BrowserView
  ├─ ApplicationMenu / dialogs / paths / deep links
  ├─ Effect backend services
  └─ Node-API native addon loader
        ⇅
Rust Node-API addon
  ├─ command-shaped exports
  ├─ existing repo/** jj integration
  └─ jj-lib
        ⇅
Repository filesystem
```

Proposed filesystem layout:

```txt
apps/desktop/
  src/                         Svelte 5 app
    components/
    data/
    effects/
    routes/                    or SvelteKit file routes
    native-client.ts           typed RPC client
  src-electrobun/
    bun/index.ts               Electrobun main process
    bun/native.ts              loads Node-API addon
    shared/rpc.ts              shared RPC types
  native/tatami-jj-native/
    Cargo.toml
    build.rs
    src/lib.rs                 napi exports
    src/repo/                  moved from src-tauri/src/repo
```

## Technology choices

### Svelte 5

Use Svelte 5 runes and `.svelte.ts` modules for shared reactive UI state. Avoid legacy store patterns unless integrating with external asynchronous streams.

### SvelteKit vs Vite-only Svelte

Preferred: SvelteKit static SPA.

Required SvelteKit/Tauri-like desktop settings:

- `@sveltejs/adapter-static`
- `fallback: 'index.html'`
- root layout exports `ssr = false`

If SvelteKit creates friction with Electrobun bundling, fall back to Vite + Svelte and a minimal route store.

### Electrobun

Electrobun owns app shell concerns:

- window creation
- local `views://` asset loading
- typed BrowserView RPC
- application menu
- file dialogs/message boxes
- app data paths
- open-url deep links where supported
- browser-to-backend event/message forwarding

### Rust Node-API addon

Use `napi-rs` rather than raw `bun:ffi`.

Reasons:

- in-process, no subprocess overhead
- safer than raw pointer-based FFI
- Bun supports Node-API
- async-friendly
- lower memory-management risk

Known spike result:

- Bun successfully loaded a `napi-rs` addon linked to `jj-lib = 0.35.0`.
- `getRevisionsJson` using current `repo::log::fetch_log` worked.
- Warm timings in this repo were roughly 3–13ms depending on revset/limit.

### Effect

Use Effect at service boundaries and for workflows, not as a replacement for Svelte's rendering/reactivity.

Use Effect for:

- typed errors
- service dependency injection via Layers
- RPC/native client abstraction
- mutation workflows
- retries/timeouts/concurrency
- watcher lifecycle
- logging/tracing
- resource cleanup

Use Svelte for:

- component-local state
- DOM events/actions
- rendering
- URL/search param reading and writing

Use TanStack for:

- live collections
- cache invalidation
- optimistic entity state
- large async payload caching

## Native API design

### Boundary shape

Expose coarse app operations matching today's `tauri-commands.ts`, not raw `jj-lib` objects.

Initial implementation can return JSON strings to minimize N-API type binding complexity:

```ts
getRevisionsJson(params...) => string
getRevisionDiff(...) => string
getRevisionChangesJson(...) => string
getDiffsBatchJson(...) => string
```

The TypeScript side parses and validates/normalizes results. Later, individual functions can return JS objects directly if useful.

### Example Rust export

```rust
#[napi]
pub fn get_revisions_json(
    repo_path: String,
    limit: u32,
    revset: Option<String>,
    preset: Option<String>,
) -> napi::Result<String> {
    let revisions = repo::log::fetch_log(
        Path::new(&repo_path),
        limit as usize,
        revset.as_deref(),
        preset.as_deref(),
    ).map_err(to_napi_error)?;

    serde_json::to_string(&revisions).map_err(to_napi_error)
}
```

### Build requirements

The native crate needs:

```toml
[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "3", default-features = false, features = ["napi4"] }
napi-derive = "3"

[build-dependencies]
napi-build = "2"
```

And:

```rust
// build.rs
fn main() {
    napi_build::setup();
}
```

Without `napi_build::setup()` macOS linking can fail with unresolved `_napi_*` symbols.

### Native operation list

Port these Tauri commands to Node-API exports:

```txt
find_repository
get_revisions
get_status
get_conflict_paths
get_file_diff
get_revision_diff
get_revision_changes
get_diffs_batch
get_changes_batch
get_commit_recency
resolve_revset
get_lineage_batch
get_file_content_base64
generate_change_ids
jj_new
jj_edit
jj_abandon
jj_describe
jj_squash
jj_rebase
jj_git_fetch
jj_git_push
get_operations
undo_operation
```

Storage commands may move to Bun/SQLite rather than Rust:

```txt
get_projects
upsert_project
find_project_by_path
remove_project
get_layout
update_layout
```

Decision: prefer Bun-side SQLite/storage unless keeping the existing Rust SQLx storage is faster.

### Async/blocking policy

Repository reads and mutations may block. For Node-API exports, prefer async functions with blocking work moved to a native thread pool or `tokio::task::spawn_blocking` where appropriate.

Do not block Electrobun's main backend workflow for long-running diff batches or mutation operations.

## Electrobun RPC design

Define one shared RPC schema:

```ts
export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      getRevisions: { params: GetRevisionsParams; response: Revision[] }
      getRevisionDiff: { params: DiffParams; response: string }
      jjDescribe: { params: DescribeParams; response: MutationResult }
      openRepositoryDialog: { params: {}; response: string[] | null }
    }
    messages: {
      logToBun: { msg: string }
    }
  }>
  webview: RPCSchema<{
    requests: {}
    messages: {
      repoChanged: { repoPath: string }
      openProject: { projectId: string }
      deepLink: { url: string }
    }
  }>
}
```

Backend handlers run Effect programs:

```ts
const rpc = BrowserView.defineRPC<AppRPC>({
  maxRequestTime: 30_000,
  handlers: {
    requests: {
      getRevisions: (params) => Runtime.runPromise(BackendRuntime)(
        RepoService.getRevisions(params)
      ),
    },
    messages: {}
  }
})
```

Frontend code calls a typed client service rather than importing Electrobun globals directly throughout the app.

## Effect service plan

### Frontend services

```txt
NativeClient
  getRevisions
  getRevisionDiff
  getRevisionChanges
  mutateRevision
  openRepositoryDialog

RepositoryActions
  addRepository
  switchRepository
  syncRepository
  invalidateRepository

ToastService
  success/error/action toasts
```

### Backend services

```txt
JjNativeAddon
  low-level wrapper around require("tatami_jj_native.node")

RepoService
  command-shaped repo operations

StorageService
  projects/layout persistence

WatcherService
  repo watch/unwatch and repoChanged messages

DesktopService
  dialogs, menus, paths, notifications
```

### Svelte usage pattern

Svelte components should not become Effect-heavy. Use Effect at event/action boundaries:

```ts
async function handleDescribe() {
  await appRuntime.runPromise(
    RepositoryActions.describe({ repoPath, changeId, description })
  )
}
```

TanStack DB/Query invalidation should be part of the action workflow.

## Frontend migration mapping

```txt
React / Tauri today                   Svelte / Electrobun target
--------------------------------------------------------------------------
React components                       Svelte 5 components
TanStack Router                        SvelteKit routes or route store
@tanstack/react-db useLiveQuery         @tanstack/svelte-db useLiveQuery
@tanstack/react-query                   @tanstack/svelte-query
@tanstack/react-virtual                 @tanstack/svelte-virtual
effect-atom                            .svelte.ts state + Effect services
Tauri invoke                           Electrobun RPC client
Tauri listen/emit                       Electrobun RPC messages
Tauri dialog plugin                     Electrobun Utils.openFileDialog/showMessageBox
Tauri shell plugin                      Electrobun Utils.openExternal/openPath
Tauri app path                          Electrobun Utils.paths.userData
Tauri menu                              Electrobun ApplicationMenu
Tauri deep-link                         Electrobun urlSchemes/open-url where supported
```

## TanStack DB plan

Keep the current core collection model where possible:

```txt
src/data/collections/repositories.ts
src/data/collections/revisions.ts
src/data/collections/operations.ts
src/data/collections/commit-recency.ts
```

In components, use `@tanstack/svelte-db`:

```svelte
<script lang="ts">
  import { useLiveQuery } from "@tanstack/svelte-db"
  import { repositoriesCollection } from "$lib/data"

  const repositoriesQuery = useLiveQuery(repositoriesCollection)
</script>

{#each repositoriesQuery.data as repository (repository.id)}
  <RepositoryRow {repository} />
{/each}
```

Important: `useLiveQuery` returns Svelte 5 reactive getters. Do not directly destructure unless wrapping with `$derived`.

## UI state plan

Replace `atoms.ts` with Svelte state modules:

```ts
// state/ui.svelte.ts
export const uiState = $state({
  shortcutsHelpOpen: false,
  searchOpen: false,
  aceJumpQuery: null as string | null,
  debouncedChangeId: null as string | null,
  debugOverlayEnabled: false,
})

export const revisionGraphState = $state({
  expandedStacks: new Set<string>(),
  hoveredStackId: null as string | null,
  scrollTop: 0,
  draggingBookmark: null as DraggingBookmark,
})
```

Use Svelte reactive `Set`/`Map` carefully. If mutation does not trigger expected updates, reassign new instances.

## Component port order

1. Bootstrap shell
   - Svelte app mounts in Electrobun window.
   - Theme/global CSS works.
   - RPC smoke call works.

2. Project picker and repository list
   - Storage available.
   - Add/select/remove repository.

3. Read-only revision graph
   - `getRevisions` through Node-API.
   - TanStack DB collection updates.
   - Existing graph utility functions reused.
   - Svelte virtualizer wired.

4. Read-only diff panel
   - `getRevisionDiff`, `getRevisionChanges`, batch prefetch.
   - Decide `@pierre/diffs` strategy.

5. Mutations
   - new/edit/describe/squash/rebase/abandon/fetch/push.
   - Optimistic updates preserved.
   - Undo operation works.

6. Search, command palette, keyboard shortcuts
   - Svelte actions for keyboard handling.
   - URL search params remain source of selection/focus truth.

7. Operations log, settings, repositories screens

8. Watchers and event forwarding
   - Repo changes invalidate queries.
   - Avoid duplicate watchers.

9. Packaging and removal of Tauri/React

## `@pierre/diffs` plan

Current app uses `@pierre/diffs/react`. For Svelte we need one of:

1. Use non-React/core exports from `@pierre/diffs` and wrap with a Svelte component.
2. Use the package's web component/custom element path if stable.
3. Keep a temporary React island only for `DiffPanel` while porting.
4. Replace diff renderer if required.

This is one of the highest-risk UI migration items and should be spiked before removing React.

## Watcher plan

Current Tauri watcher flow:

```txt
frontend setupRepoWatcher(repoPath)
  -> Tauri command watch_repository
  -> Rust WatcherManager
  -> emit repo-changed
  -> frontend invalidates TanStack Query
```

Target flow:

```txt
frontend requests watch(repoPath)
  -> Electrobun RPC
  -> WatcherService
  -> native/Bun watcher
  -> webview.rpc.send.repoChanged({ repoPath })
  -> frontend invalidates TanStack Query / DB collections
```

Implementation options:

- Keep watcher in Rust native addon if easiest to reuse existing `notify` code.
- Implement watcher in Bun if adequate and cross-platform behavior is acceptable.

Revision 13 implements the initial Electrobun watcher in Bun with `fs.watch` on `<repo>/.jj/repo`, normalized-path deduplication, and a 500ms debounce. This avoids adding a native-addon callback bridge before parity is proven. Revisit Rust `notify` if Bun watcher behavior is inadequate on supported platforms.

## Storage plan

Current storage uses Rust SQLx SQLite. Electrobun offers app paths and Bun has SQLite options.

Preferred target:

```txt
StorageService in Bun
  ├─ Utils.paths.userData
  └─ SQLite database for projects/layout
```

Keep schema compatible with current app where practical to enable migration.

Required storage data:

```txt
projects/repositories
layout active_project_id
layout selected_change_id
layout sidebar_width
```

## Deep links

Current app supports `tatami://project/{projectId}/revision/{revisionId}` through Tauri deep-link plugin.

Electrobun supports `urlSchemes` and `open-url`, but docs indicate macOS support only currently.

Plan:

- Preserve deep-link parsing in shared TypeScript.
- Wire macOS Electrobun `open-url` first.
- Document Windows/Linux gap before Tauri removal.

Revision 13 registers the `tatami` scheme with Electrobun and forwards supported `tatami://` URLs to the webview. Electrobun deep-link delivery is treated as macOS-only for now; Windows/Linux parity remains a documented platform gap before Tauri removal.

## Build/package plan

Electrobun config should include:

```ts
export default {
  app: {
    name: "Tatami",
    identifier: "...",
    version,
    urlSchemes: ["tatami"]
  },
  runtime: {
    exitOnLastWindowClosed: true
  },
  build: {
    bun: { entrypoint: "src-electrobun/bun/index.ts" },
    views: {
      mainview: { entrypoint: "src/main.ts" }
    },
    copy: {
      // html/css/assets/native addon as needed
    },
    asarUnpack: ["*.node", "*.dylib", "*.so", "*.dll"]
  }
}
```

Before committing fully, verify:

- native addon can be loaded in Electrobun dev build
- native addon can be loaded in packaged build
- macOS signing includes the `.node`/dynamic library artifacts

## Migration milestones

### M1: Electrobun native read spike in repo

- Add real `native/tatami-jj-native` crate.
- Add Electrobun shell.
- Svelte page calls `getRevisions` through RPC.
- No Tauri removal yet.

Acceptance:

- App window opens.
- Current repo revisions render as JSON or simple list.
- Packaged/dev addon loading path is understood.

### M2: Read-only app shell

- Project picker works.
- Revision graph read-only works.
- Selection stored in URL.

Acceptance:

- Can open a repository and navigate revisions.

### M3: Diff panel

- Changed file list and diff view work.
- Batch prefetch works.
- Image diff path decided.

Acceptance:

- Selecting revisions shows diffs without React dependency, or with explicit temporary island.

### M4: Mutations

- Edit/new/describe/squash/rebase/abandon work.
- Optimistic DB behavior works.
- Operation log and undo work.

Acceptance:

- Core jj workflows match current Tauri app.

### M5: Desktop parity

- Menus.
- Dialogs.
- Watchers.
- Storage migration.
- Deep links on supported platforms.
- Settings/repositories screens.

Acceptance:

- Daily usage possible without Tauri app.

### M6: Cleanup

- Remove React dependencies.
- Remove Tauri dependencies and `src-tauri` once no longer needed.
- Update docs/build scripts/CI.

## Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Electrobun packaged addon loading fails | High | Spike before broader rewrite |
| `@pierre/diffs/react` has no clean Svelte replacement | High | Spike early; allow temporary island |
| Deep links not cross-platform | Medium | Document gap; keep parser platform-agnostic |
| Watcher behavior regresses | Medium | Initially reuse Rust notify watcher |
| Node-API long calls block Bun backend | Medium | Use async exports / blocking pool |
| Storage migration loses user projects/layout | Medium | Preserve schema or write migration |
| Svelte rewrite scope expands | High | Port vertical slices, keep pure utilities |

## Open decisions

- SvelteKit static SPA vs Vite-only Svelte.
- Bun-side SQLite vs keep Rust SQLx storage.
- Rust watcher reuse vs Bun watcher.
- `@pierre/diffs` Svelte wrapping strategy.
- Native addon packaging path and naming per platform.
- Whether Node-API returns JSON strings permanently or moves to typed JS objects.

## Revision journey plan

The rewrite should land as a stack of small jj revisions. Each revision has a goal, explicit acceptance criteria, and a narrative explaining why that step exists. The stack is intentionally front-loaded with derisking revisions, because the highest-risk unknowns are Electrobun/Svelte viability, typed RPC, native addon loading, TanStack DB/Svelte integration, and non-React UI primitives for trees/diffs.

### Planning alternatives considered

- **Native first**: start with the `napi-rs` addon, then add Electrobun. This was rejected as the first step because the UI shell is the broadest dependency. If Electrobun + Svelte does not work smoothly in this repo, native work cannot be exercised from the target app anyway.
- **One large M1 revision**: add Electrobun, Svelte, RPC, and native reads together. This was rejected because it would obscure which boundary failed.
- **Port app screens before UI primitive spikes**: begin with project picker/graph and solve trees/diffs later. This was rejected for diff/file-tree surfaces because `@pierre/diffs/react` and custom React tree behavior are known migration risks.
- **Custom Svelte file tree**: build our own file tree. This was rejected in favor of `@pierre/trees` from <https://trees.software/> so the rewrite does not invent another tree implementation.

### Planned jj revision stack

#### 1. `feat(desktop): add electrobun svelte shell`

Goal: create the smallest Electrobun + Svelte 5 app shell that opens a Tatami window and proves Svelte reactivity/HMR in this repository.

Acceptance:

- Electrobun config and package scripts exist.
- Svelte app renders in an Electrobun window.
- A tiny Svelte 5 rune interaction works.
- Existing Tauri app/scripts remain intact.

Narrative: this is first because every later UI slice depends on Electrobun and Svelte working locally.

#### 2. `feat(desktop): add typed electrobun rpc stubs`

Goal: prove typed webview-to-Bun RPC before adding native code.

Acceptance:

- Shared RPC schema exists.
- Svelte frontend calls a stub `getRevisions` request through Electrobun RPC.
- Bun backend returns fixture revision data through typed handlers.
- A Bun-to-webview message path is demonstrated or explicitly deferred.

Narrative: this isolates Electrobun RPC and browser import/bundling issues from native addon issues.

#### 3. `feat(native): add jj Node-API addon skeleton`

Goal: add a real `napi-rs` native addon crate that can be loaded from Bun and exposes `getRevisionsJson` backed by existing `jj-lib` log code.

Acceptance:

- Native addon crate exists under `apps/desktop/native/tatami-jj-native` or a documented equivalent.
- `build.rs` calls `napi_build::setup()`.
- Bun can load the produced `.node` addon.
- `getRevisionsJson` returns valid revision JSON for this repo.
- Native dependency/linkage risk is checked with a platform command such as `otool -L` on macOS.

Narrative: this makes the earlier native spike real inside the repo while still keeping it independent from the Electrobun UI.

#### 4. `feat(desktop): wire electrobun rpc to native addon`

Goal: connect the typed RPC path to the native addon and render real revision data in Svelte.

Acceptance:

- Bun backend loads the native addon through one boundary module.
- Svelte frontend calls `getRevisions` through RPC, not direct native imports.
- Real revisions from a local jj repo render in the Svelte window.
- Errors are surfaced visibly or logged clearly.

Narrative: this is the first end-to-end milestone: Svelte WebView → Electrobun Bun backend → Rust Node-API addon → `jj-lib`.

#### 5. `feat(desktop): spike tanstack db and effect boundaries`

Goal: prove the Svelte 5 + `@tanstack/svelte-db` usage pattern and establish Effect service boundaries.

Acceptance:

- Frontend `NativeClient` service exists or a spike module demonstrates the approved shape.
- Backend `JjNativeAddon` and `RepoService` service shape is established.
- `@tanstack/svelte-db` `useLiveQuery` works from Svelte without unsafe destructuring.
- Svelte reactive getters are wrapped with `$derived` where needed.
- JSON parsing/validation is centralized at a boundary.

Narrative: this prevents the graph/project-picker work from embedding ad hoc data access patterns.

#### 6. `feat(desktop): add pierre trees file tree integration`

Goal: introduce `@pierre/trees` for file tree UI through its vanilla runtime wrapped in Svelte lifecycle.

Acceptance:

- `@pierre/trees` is used for file tree rendering; no custom tree component is invented.
- Svelte wrapper/action creates and disposes `FileTree` correctly.
- Tree selection events integrate with app state.
- Fixture tree renders independently of repo/RPC data.
- Styling/theming hooks are documented near the wrapper.

Narrative: file trees are a standalone UI risk and can be derisked before the full diff panel.

#### 7. `feat(desktop): spike svelte diff renderer`

Goal: prove the non-React `@pierre/diffs` strategy in Svelte/Electrobun.

Acceptance:

- Text diffs render without importing `@pierre/diffs/react`.
- Worker/highlighter loading works in the Electrobun webview or the limitation is documented.
- Large static diff fixture does not freeze the UI.
- Unified/split or equivalent display choice is documented.

Narrative: the current diff renderer is one of the highest-risk React dependencies, so it gets a dedicated spike before the app diff panel is ported.

#### 8. `feat(desktop): add project storage and picker`

Goal: add project/repository persistence, repository picker UI, and open repository dialog in the Electrobun/Svelte app.

Acceptance:

- Repositories can be added, selected, and removed.
- Active repository persists across restart.
- Storage location uses Electrobun/Bun-side app data path or a documented alternative.
- Existing Tauri storage remains untouched unless intentionally migrated.

Narrative: this is the first durable app-state feature after the core shell and data boundaries are proven.

#### 9. `feat(desktop): port read-only revision graph to svelte`

Goal: port the read-only revision graph using Svelte 5, TanStack DB, and existing graph utilities where possible.

Acceptance:

- Revision collection is backed by TanStack DB / `@tanstack/svelte-db`.
- Graph renders and supports selection/navigation.
- URL or route state owns selected revision where practical.
- Large repos remain responsive enough for daily use.

Narrative: the revision graph becomes the main read-only daily-use surface once project selection and revision loading are stable.

#### 10. `feat(desktop): port read-only diff panel`

Goal: port changed-file list and read-only diff rendering using the proven `@pierre/trees` and diff-renderer approaches.

Acceptance:

- `getRevisionDiff`/`getRevisionChanges` and batch reads are exposed through native/RPC/services.
- Selecting a revision shows changed files and diff content.
- `@pierre/trees` drives the changed-file tree/list where appropriate.
- Image/binary diff limitations are documented if deferred.

Narrative: this composes earlier tree/diff spikes into the real app surface.

#### 11. `feat(desktop): wire core jj mutations`

Goal: wire new/edit/describe/squash/rebase/abandon mutations with invalidation, user feedback, and safe error handling.

Acceptance:

- Core local jj mutations work from Svelte UI.
- TanStack DB/query invalidation updates graph after mutations.
- Mutation errors are visible and typed at service boundaries.
- Optimistic behavior is implemented or explicitly deferred.

Narrative: mutations come after read-only graph/diff parity so state invalidation can be reviewed against visible UI.

#### 12. `feat(desktop): add operations log and sync actions`

Goal: add operation log, undo, fetch, and push flows.

Acceptance:

- Operations are visible for the active repository.
- Undo operation works or fails clearly.
- Fetch/push commands are wired through native/RPC/services.
- Sync state and errors are visible.

Narrative: this restores higher-level version-control workflows beyond local graph mutations.

#### 13. `feat(desktop): add repo watcher and desktop shell integrations`

Goal: add repo watcher events plus desktop integrations: menus, dialogs, paths, external opens, and supported deep links.

Acceptance:

- External repo changes invalidate Svelte/TanStack state.
- Duplicate watchers are avoided.
- Menus/dialogs/path helpers use Electrobun boundaries.
- Deep-link support and platform gaps are documented.

Narrative: desktop integration is deferred until core app data flows are stable.

#### 14. `feat(desktop): port keyboard search and app polish`

Goal: port keyboard shortcuts, search/command palette, settings/repository screens, and layout polish needed for daily use.

Acceptance:

- Keyboard workflows match the current app where practical.
- Search/command palette works.
- Settings/repositories screens are ported or explicitly deferred.
- Layout state behaves consistently.

Narrative: polish comes after functional parity to avoid coupling navigation/search work to unstable screen structure.

#### 15. `chore(desktop): package electrobun app and remove old frontend shell`

Goal: verify dev and packaged Electrobun builds, update scripts/docs/CI, and remove old React/Tauri shell only after parity is proven.

Acceptance:

- Electrobun dev and packaged builds work.
- Native addon loading works in the packaged app.
- Scripts/docs/CI point at the new app.
- React/Tauri dependencies and code are removed only intentionally.

Narrative: cleanup is last so the old app remains available while the replacement reaches parity.

## Immediate next steps

1. Run the Mill orchestrator workflow starting at `electrobun-svelte-shell`.
2. Let the orchestrator refine each revision's plan, run implementer/reviewer loops, and write the final jj description for the landed changes.
3. Escalate if a revision fails review after the configured iteration cap; that indicates scope or design uncertainty rather than a need for more blind retries.
