// `pnpm db:migrate`: applies pending migrations to DATABASE_URL.
import { loadEnv, redactUrl, requireEnv } from "../env.ts";
import { runMigrations } from "../migrate.ts";

loadEnv();
const url = requireEnv("DATABASE_URL");
await runMigrations(url);
process.stdout.write(`Migrations applied to ${redactUrl(url)}\n`);
