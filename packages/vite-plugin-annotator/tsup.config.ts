import { defineConfig } from "tsup";
import * as solidPlugin from "esbuild-plugin-solid";

export default defineConfig([
  // Plugin entry (for Node.js/Vite)
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    external: ["vite"],
  },
  // Client bundle (for browser, self-contained)
  {
    entry: { client: "src/client/index.tsx" },
    format: ["esm"],
    platform: "browser",
    clean: false,
    noExternal: ["solid-js", "bippy"],
    esbuildPlugins: [solidPlugin.solidPlugin({ solid: { generate: "dom" } })],
    esbuildOptions(options) {
      options.conditions = ["browser", "solid"];
    },
  },
]);
