# Data Architecture: Local-First with Batch RPC

## Principle

**All data reads are local. Backend/native calls are batched.**

```txt
Svelte components
  ↓ local reads via useLiveQuery
TanStack DB collections
  ↑ batch sync
Electrobun RPC client
  ↓ batched request
Bun backend services
  ↓ native boundary
Rust Node-API addon / jj-lib
```

## Rules

### 1. Components Never Call Native Operations Directly

```typescript
// ❌ WRONG: direct backend/native call in component code
const diff = await native.getRevisionDiff(repoPath, changeId);

// ✅ RIGHT: populate collections through data/sync helpers and read locally
const result = useLiveQuery((q) => q.from(revisionsCollection));
```

### 2. Use Unified Collections, Not Per-Entity

```typescript
// ❌ WRONG - creates N collections
function getRevisionDiffCollection(repoPath: string, changeId: string) {
  return createCollection({ id: `${repoPath}:${changeId}` });
}

// ✅ RIGHT - single collection, query locally
const revisionsCollection = createCollection({
  id: "revisions",
  getKey: (revision) => revision.change_id,
});
```

### 3. Batch RPC Calls

```typescript
// ❌ WRONG - N RPC calls
for (const id of changeIds) {
  await client.getRevisionDiff({ repoPath, changeId: id });
}

// ✅ RIGHT - one batched backend request
await client.getDiffsBatch({ repoPath, changeIds });
```

### 4. File Watcher Handles Invalidation

When a repository changes, backend watcher events trigger collection refreshes through `src/mainview/data/sync.ts`. Components should react to collection state rather than manually refetching.

## Files

- `src/mainview/data/` - TanStack DB collections, mutations, sync helpers
- `src/mainview/services/NativeClient.ts` - frontend Effect service for backend RPC
- `src/mainview/rpc.ts` - typed Electrobun view RPC binding
- `src-electrobun/bun/services/` - backend Effect services
- `src-electrobun/shared/rpc.ts` - shared RPC contract
- `native/tatami-jj-native/src/` - Rust Node-API addon and jj-lib integration
