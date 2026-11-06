import { existsSync } from "node:fs";
import path from "node:path";

/** The `.env` at the root of the repo or worktree this package sits in. */
export const rootEnvFile = path.resolve(import.meta.dirname, "../../../.env");

/**
 * Loads `.env` into `process.env` if the file exists. Values already in the
 * environment win, so CI and `fx` can override the file.
 */
export const loadEnv = (file: string = rootEnvFile): void => {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
};

/** Reads a required environment variable, or throws saying how to set it. */
export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env at the repo root, or set ${name} in the environment.`
    );
  }
  return value;
};

/** A database URL with the password removed, safe to print. */
export const redactUrl = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.password) {
    parsed.password = "***";
  }
  return parsed.toString();
};
