import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API server (examples/crm under `fx dev`). The web app reaches it only
// over HTTP (AGENTS.md rule 6), through this proxy, so the session cookie is
// same-origin (decision 0032).
const api = process.env.API_URL ?? "http://localhost:4000";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      "/api": { target: api, rewrite: (path) => path.replace(/^\/api/u, "") },
      "/auth": { target: api },
      // MCP clients (Claude Code) connect here, through My agents' command.
      "/mcp": { target: api },
    },
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
});

export default config;
