import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig, type PluginOption } from "vite";
import agentation from "vite-plugin-agentation";

// Vite-only Svelte shell for the Electrobun derisk slice.
// SvelteKit remains an open follow-up decision once routing/data needs are proven.
export default defineConfig({
	plugins: [svelte(), agentation() as PluginOption],
	root: "src/mainview",
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	build: {
		outDir: "../../dist-electrobun",
		emptyOutDir: true,
	},
	worker: {
		format: "es",
	},
	server: {
		// Single source of truth for the dev-server port: the dev:hmr / dev:attach
		// scripts and the Electrobun backend probe all derive from DEV_SERVER_PORT.
		port: Number(process.env.DEV_SERVER_PORT) || 5174,
		strictPort: true,
	},
});
