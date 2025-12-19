# Tatami Desktop

Tauri v2 desktop application for Tatami - a Jujutsu GUI client.

## Tech Stack

- **Frontend**: React + TypeScript
- **Bundler**: Vite
- **Backend**: Tauri v2
- **Package Manager**: Bun

## Development

```bash
# Install dependencies (from repository root)
bun install

# Run development server
cd apps/desktop
bun run dev

# In a separate terminal, start Tauri
bun run tauri dev
```

## Build

```bash
# Build frontend
bun run build

# Build desktop app
bun run tauri build

# Debug build
bun run tauri build --debug
```

## Project Structure

```
apps/desktop/
├── src-tauri/          # Rust backend
│   ├── src/
│   │   ├── main.rs     # Entry point
│   │   └── lib.rs      # Tauri commands
│   ├── Cargo.toml
│   ├── tauri.conf.json # Tauri configuration
│   └── capabilities/   # Permissions
├── src/                # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   └── styles/
├── index.html
├── vite.config.ts
└── package.json
```

## Notes

- The app window displays "Tatami" as the title
- Default window size: 1200x800
- Icon generated at `src-tauri/icons/icon.png`
