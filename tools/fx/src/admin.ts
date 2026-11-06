import { FxError } from "./errors.ts";

/** The Postgres admin URL from the main checkout's `.env`. */
export const requireAdminUrl = (): string => {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) {
    throw new FxError(
      "command_failed",
      "DATABASE_ADMIN_URL is not set.",
      "Copy .env.example to .env at the repo root and run `pnpm db:up`."
    );
  }
  return url;
};

/** `name on host:port`, for messages: never the full URL, which may hold a password. */
export const describeDatabase = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname.slice(1)} on ${parsed.hostname}:${parsed.port || "5432"}`;
};
