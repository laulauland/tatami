import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;
const isTauri = !!process.env.TAURI_ENV_DEBUG;

const tauriMocks = isTauri
	? {}
	: {
			"@tauri-apps/api/core": path.resolve(__dirname, "./src/mocks/tauri-core.ts"),
			"@tauri-apps/api/path": path.resolve(__dirname, "./src/mocks/tauri-path.ts"),
			"@tauri-apps/api/event": path.resolve(__dirname, "./src/mocks/tauri-event.ts"),
			"@tauri-apps/plugin-dialog": path.resolve(__dirname, "./src/mocks/tauri-dialog.ts"),
		};

const reactCompilerConfig = {};

export default defineConfig({
	plugins: [
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler", reactCompilerConfig]],
			},
		}),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			...tauriMocks,
		},
	},
	clearScreen: false,
	server: {
		port: 5173,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
					protocol: "ws",
					host,
					port: 5173,
				}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
});
