import { defineConfig } from "drizzle-kit";

import config from "./drizzle.config.ts";

// Drizzle Studio shows the core tables as well as the CRM's.
export default defineConfig({
  ...config,
  schema: ["../../packages/db/src/schema/core.ts", "./src/objects.ts"],
  schemaFilter: ["public", "auth"],
  tablesFilter: undefined,
});
