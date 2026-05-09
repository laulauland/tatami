# Tatami Desktop

Electrobun + Svelte 5 desktop application for Tatami, a Jujutsu GUI client.

## Tech Stack

- **Frontend**: Svelte 5 + TypeScript
- **App shell**: Electrobun
- **Backend**: Bun services with Effect
- **Native VCS layer**: Rust Node-API addon wrapping `jj-lib`
- **Package Manager**: Bun

## Development

```bash
# Install dependencies (from repository root)
bun install

# Run the desktop app
cd apps/desktop
bun run dev

# Optional HMR workflow
bun run dev:hmr
```

## Build

```bash
# Package the desktop app
bun run build

# Compatibility alias
bun run electrobun:build
```

Artifacts are written to `apps/desktop/artifacts/` by Electrobun.

## Project Structure

```txt
apps/desktop/
├── src/mainview/              # Svelte WebView UI
│   ├── components/            # Svelte components
│   ├── data/                  # TanStack DB collections and sync helpers
│   ├── graph/                 # Revision graph layout utilities
│   └── main.ts                # Svelte entry point
├── src-electrobun/            # Bun/Electrobun backend
│   ├── bun/                   # Window, RPC, services, native loader
│   └── shared/                # Shared RPC/schema types
├── native/tatami-jj-native/   # Rust Node-API addon for jj-lib
├── electrobun.config.ts
├── vite.electrobun.config.ts
└── package.json
```

## Notes

- The app window displays "Tatami" as the title.
- Default window size is configured in `electrobun.config.ts`.
- The native addon is loaded by `src-electrobun/bun/native.ts`.
