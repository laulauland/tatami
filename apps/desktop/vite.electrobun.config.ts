import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Vite-only Svelte shell for the Electrobun derisk slice.
// SvelteKit remains an open follow-up decision once routing/data needs are proven.
export default defineConfig({
	plugins: [svelte()],
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
		port: 5174,
		strictPort: true,
	},
});
