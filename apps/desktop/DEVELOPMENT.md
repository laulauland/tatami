# Data Architecture: Local-First with Batch IPC

## Principle

**All data reads are local. All IPC calls are batched.**

```
┌────────────────────────────────────────────────────────────┐
│                        Components                          │
│                                                            │
│   useDiff(changeId)    useChanges(changeId)               │
│   usePrefetch()        (always instant from local DB)      │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                    TanStack DB                             │
│                                                            │
│   diffsCollection          changesCollection               │
│   (all diffs, keyed        (all file lists, keyed          │
│    by repoPath:changeId)    by repoPath:changeId)         │
└────────────────────────────────────────────────────────────┘
                            ▲
                            │ batch sync
                            │
┌────────────────────────────────────────────────────────────┐
│                    Batch Loader                            │
│                                                            │
│   - Queues IDs that need loading                          │
│   - Debounces (50ms) to collect multiple requests         │
│   - Batches into single IPC call                          │
│   - Syncs results → collections                           │
└────────────────────────────────────────────────────────────┘
                            │
                            │ single batched invoke()
                            ▼
┌────────────────────────────────────────────────────────────┐
│                    Tauri IPC (expensive!)                  │
│                                                            │
│   getDiffsBatch({ changeIds: string[] })                  │
│   getChangesBatch({ changeIds: string[] })                │
│                                                            │
│   ~50-200ms per call - minimize these!                    │
└────────────────────────────────────────────────────────────┘
```

## Rules

### 1. Components Never Call IPC Directly

```typescript
// ❌ WRONG
import { getRevisionDiff } from '@/tauri-commands';
const diff = await getRevisionDiff(repoPath, changeId);

// ✅ RIGHT  
import { useDiff } from '@/db';
const { data: diff } = useDiff(repoPath, changeId);
```

### 2. Use Unified Collections, Not Per-Entity

```typescript
// ❌ WRONG - creates N collections, causes GC issues
function getRevisionDiffCollection(repoPath, changeId) {
  return createCollection({
    queryKey: ["diff", repoPath, changeId],  // Per changeId!
    ...
  });
}

// ✅ RIGHT - single collection, query locally
const diffsCollection = createCollection({
  queryKey: ["diffs"],
  getKey: (d) => `${d.repoPath}:${d.changeId}`,
});

// Query with filter - instant local read
useLiveQuery(diffsCollection, q => 
  q.where('changeId', '==', selectedId)
);
```

### 3. Batch IPC Calls

```typescript
// ❌ WRONG - N IPC calls = N × 200ms
for (const id of changeIds) {
  await getRevisionDiff(repoPath, id);
}

// ✅ RIGHT - 1 IPC call = 200ms total
const diffs = await getDiffsBatch(repoPath, changeIds);

// ✅ EVEN BETTER - use batch loader with debounce
const { prefetchDiffs } = usePrefetch(repoPath);
prefetchDiffs(changeIds);  // Queued, debounced, batched
```

### 4. Prefetch Strategically

Prefetch data before user needs it:

```typescript
// Prefetch visible range
useEffect(() => {
  const visibleIds = visibleRevisions.map(r => r.change_id);
  prefetchDiffs(visibleIds);
}, [visibleRevisions]);

// Prefetch around selection for smooth navigation
useEffect(() => {
  const nearbyIds = getNearbyRevisionIds(selectedIndex, ±5);
  prefetchDiffs(nearbyIds);
}, [selectedIndex]);

// Prefetch search results
useEffect(() => {
  if (searchResults.length > 0) {
    prefetchDiffs(searchResults.slice(0, 20).map(r => r.change_id));
  }
}, [searchResults]);
```

### 5. File Watcher Handles Invalidation

```typescript
// When repo changes, clear and re-fetch
listen('repo-changed', (repoPath) => {
  // Clear affected data from collections
  clearCollectionsForRepo(repoPath);
  
  // Component effects will re-trigger prefetch
  // No manual refetch needed
});
```

## Why This Architecture?

| Problem | Old Approach | New Approach |
|---------|--------------|--------------|
| IPC latency | 1 call per selection (200ms wait) | Batched prefetch (instant reads) |
| GC issues | Per-entity collections get cleaned up | Unified collections persist |
| Prefetch broken | Collections GC'd before use | Data stays in collection |
| Search results | Fetch on select (slow) | Prefetch on search (instant) |

## Files

- `src/db.ts` - Collections, batch loaders, hooks
- `src/lib/batch-loader.ts` - BatchLoader class
- `src/tauri-commands.ts` - IPC wrappers (batch APIs)
- `src-tauri/src/lib.rs` - Rust batch commands
