# Agent Instructions

## Project Context

Tatami is a desktop GUI client for Jujutsu (jj) version control. Tauri v2 + React frontend with Rust backend.

## Key Documentation

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Data architecture and patterns (MUST READ before modifying data layer)
- **[../../CLAUDE.md](../../CLAUDE.md)** - Build commands and project structure

## Linting

### Biome
Standard linting via `biome.jsonc`. Run with `bun run lint`.

### ast-grep
Architecture rules in `rules/`. Run with:

```bash
# Scan all rules
sg scan

# Scan single rule
sg scan --rule rules/no-direct-ipc-data-fetch.yml
```

## Data Flow (Critical)

```
Components → useLiveQuery (instant) → TanStack DB Collections
                                            ↑
                                     Batch Loader (debounced)
                                            ↑
                                     Tauri IPC (batched, expensive!)
```

**Principle: All reads are local. All IPC calls are batched.**

See [DEVELOPMENT.md](./DEVELOPMENT.md) for details.

## Working with Issues

This project uses `fp` for issue tracking:

```bash
fp tree                    # View issue hierarchy
fp issue show <id>         # View issue details
fp issue list --status todo # List open issues
```
