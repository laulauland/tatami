import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import agentation from "vite-plugin-agentation";
import { consoleForwardPlugin } from "./dev/vite-plugin-console-forward";
import { devtools as tanstackDevtools } from "@tanstack/devtools-vite";

const host = process.env.TAURI_DEV_HOST;

const reactCompilerConfig = {};

export default defineConfig({
	plugins: [
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler", reactCompilerConfig]],
			},
		}),
		tanstackDevtools({
			consolePiping: { enabled: true },
		}),
		tailwindcss(),
		agentation(),
		// consoleForwardPlugin()
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	clearScreen: false,
	server: {
		port: 4545,
		strictPort: true,
		host: host || false,
		hmr: host
			? {
				protocol: "ws",
				host,
				port: 4545,
			}
			: undefined,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
});
