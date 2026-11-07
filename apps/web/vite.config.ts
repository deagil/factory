import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The API server (examples/crm under `fx dev`). The web app reaches it only
// over HTTP (AGENTS.md rule 6), through this proxy, so the session cookie is
// same-origin (decision 0032).
const api = process.env.API_URL ?? "http://localhost:4000";

// Which change the dev server runs on, for the dev bar's Factory menu.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const git = (args: string) => {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
};
const factoryChange = () => {
  const branch = git("rev-parse --abbrev-ref HEAD");
  const { DATABASE_URL: databaseUrl = "" } = loadEnv(
    "development",
    repoRoot,
    "DATABASE_URL"
  );
  return {
    branch,
    change: branch.startsWith("change/") ? branch.slice("change/".length) : "",
    database: databaseUrl ? new URL(databaseUrl).pathname.slice(1) : "",
  };
};

const config = defineConfig(({ command }) => ({
  // Only the dev server knows which change it runs on; builds leave it out.
  define:
    command === "serve"
      ? { __FACTORY_CHANGE__: JSON.stringify(factoryChange()) }
      : {},
  resolve: { tsconfigPaths: true },
  server: {
    proxy: {
      "/api": { target: api, rewrite: (path) => path.replace(/^\/api/u, "") },
      "/auth": { target: api },
      // MCP clients (Claude Code) connect here, through My agents' command.
      "/mcp": { target: api },
      // The dev bar's Session menu; the server serves it only under pnpm dev.
      "/dev": { target: api },
    },
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
}));

export default config;
