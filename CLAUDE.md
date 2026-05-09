# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tatami is a desktop GUI client for Jujutsu (jj) version control. The active desktop app is Electrobun + Svelte 5, with Rust jj-lib integration exposed through a Rust Node-API addon loaded by Bun/Electrobun.

## Monorepo Structure

- `/apps/desktop` - Active Electrobun + Svelte desktop application
- `/apps/old-gui` - Legacy GPUI-based app (deprecated)

## Build Commands

```bash
# Development (from root)
bun run dev              # Build the Svelte view and run the Electrobun app

# Build
bun run build            # Package the Electrobun desktop app

# Frontend/app checks (from apps/desktop)
bun run typecheck        # TypeScript type checking (tsgo)
bun run lint             # Biome + ast-grep linting
bun run format           # Biome formatter

# Native addon (from apps/desktop/native/tatami-jj-native)
cargo build              # Build Rust Node-API addon
cargo test               # Run Rust tests, if present
cargo clippy             # Run Rust linter
cargo fmt                # Format Rust code
```

## Architecture

**Data Flow**:
```
Svelte WebView → Electrobun RPC → Bun backend services → Rust Node-API addon → jj-lib → Repository
                                      → Bun SQLite storage (projects, layout state)
                                      → file watchers
```

**Frontend Stack** (`apps/desktop/src/mainview/`):
- Svelte 5 runes/components for UI
- TanStack DB with `@tanstack/svelte-db` for live collections
- Effect for service/workflow boundaries
- `@pierre/diffs` and `@pierre/trees` for diff and file-tree UI

**Electrobun Backend** (`apps/desktop/src-electrobun/`):
- `bun/index.ts` - app/window/RPC entry point
- `bun/services/` - Effect services for desktop, repo, storage, watchers, native addon
- `shared/rpc.ts` - shared typed RPC contract

**Native Addon** (`apps/desktop/native/tatami-jj-native/`):
- Rust Node-API addon wrapping jj-lib operations
- `src/repo/` - jj-lib integration (log, status, diff, mutations)

@.fp/FP_CLAUDE.md
