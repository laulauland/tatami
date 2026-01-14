import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface AnnotatorOptions {
  /**
   * Keyboard shortcut to toggle annotator
   * @default "Escape" to deactivate when active
   */
  shortcut?: string;
}

const CLIENT_ID = "/@annotator-client";

export function annotator(options: AnnotatorOptions = {}): Plugin {
  let isDev = false;
  let clientCode: string | null = null;

  return {
    name: "vite-plugin-annotator",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    configureServer(server) {
      // Serve the client bundle at a known URL
      server.middlewares.use((req, res, next) => {
        if (req.url === CLIENT_ID) {
          if (!clientCode) {
            const clientPath = resolve(__dirname, "client.js");
            try {
              clientCode = readFileSync(clientPath, "utf-8");
            } catch (e) {
              console.error("[annotator] Failed to load client:", e);
              clientCode = "console.error('[annotator] Client bundle not found');";
            }
          }
          res.setHeader("Content-Type", "application/javascript");
          res.end(clientCode);
          return;
        }
        next();
      });
    },

    transformIndexHtml(html) {
      if (!isDev) return html;

      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: { type: "module", src: CLIENT_ID },
            injectTo: "body",
          },
        ],
      };
    },
  };
}

export default annotator;
