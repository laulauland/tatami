# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tatami is a desktop GUI client for Jujutsu (jj) version control. It's a Tauri v2 + React application with a Rust backend integrating jj-lib.

## Monorepo Structure

- `/apps/desktop` - Active Tauri + React application
- `/apps/old-gui` - Legacy GPUI-based app (deprecated)

## Build Commands

```bash
# Development (from root)
bun run dev              # Start Vite dev server (frontend only)
bun run tauri dev        # Run full Tauri app in dev mode

# Build
bun run build            # Build frontend
bun run tauri build      # Build desktop app

# Frontend (from apps/desktop)
bun run typecheck        # TypeScript type checking (tsgo)
bun run lint             # Biome linter
bun run format           # Biome formatter

# Rust (from apps/desktop/src-tauri or root)
cargo build              # Build Rust backend
cargo test               # Run tests
cargo clippy             # Run linter
cargo fmt                # Format code
```

## Architecture

**Data Flow**:
```
React Frontend → Tauri IPC Commands → Rust Backend → jj-lib → Repository
                                                   → SQLite (projects, layout state)
```

**Frontend Stack** (`apps/desktop/src/`):
- TanStack Router for routing
- TanStack Query + TanStack DB for state management
- effect-atom for reactive global state
- shadcn/ui + Tailwind CSS v4 for styling

**Backend** (`apps/desktop/src-tauri/src/`):
- `lib.rs` - Tauri command definitions
- `repo/` - jj-lib integration (jj.rs, log.rs, status.rs, diff.rs)
- `storage.rs` - SQLite persistence layer
- `watcher.rs` - File system watching for repo changes

**Key Frontend Files**:
- `components/RevisionGraph.tsx` - DAG visualization with lane allocation
- `hooks/useKeyboard.ts` - Vim-style keyboard navigation
- `db.ts` - TanStack DB collections with file watcher integration
- `tauri-commands.ts` - Type-safe Tauri command wrappers

## Browser-Only Development

The frontend supports running without Tauri via mocks in `src/mocks/`. Vite aliases Tauri imports when `TAURI_DEV_HOST` is not set, enabling UI development in a regular browser.

## Dependencies

- **jj-lib** (0.35.0) - Jujutsu version control library
- **Tauri** (2.1) - Desktop application framework
- **SQLx** - SQLite database access
- **notify** - File system watching
