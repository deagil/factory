import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, watch } from "node:fs";
import path from "node:path";

import {
  createDatabase,
  databaseUrl,
  dropDatabase,
  withAdmin,
} from "@workspace/testing/databases";

import { describeDatabase, requireAdminUrl } from "../admin.ts";
import { dbPackageDir, renameQuestion, wantedToAsk } from "../drizzle.ts";
import { FxError } from "../errors.ts";
import { findRepo } from "../git.ts";
import { capture, errorLine, plainText } from "../process.ts";
import { changeForPath, listChanges } from "../state.ts";

/** The Drizzle schema folder in a worktree. `fx dev` watches it. */
export const schemaDir = (worktree: string): string =>
  path.join(worktree, "packages", "db", "src", "schema");

/** Pushes can hang on a prompt drizzle-kit can't show; give up after this. */
const pushTimeoutMs = 60_000;

export type PushResult =
  | { readonly ok: true; readonly ms: number }
  | { readonly ok: false; readonly ms: number; readonly error: FxError };

const resetHint =
  "Restart with `pnpm fx dev --reset` to rebuild the change's database from the schema. Its data is lost.";

/**
 * Reads drizzle-kit's push output. drizzle-kit exits 0 even when a push
 * fails, so success is the message it prints, not the exit code.
 */
export const pushFailure = (output: string): FxError | undefined => {
  const text = plainText(output);
  if (
    text.includes("Changes applied") ||
    text.includes("No changes detected")
  ) {
    return undefined;
  }
  if (wantedToAsk(text)) {
    return new FxError("schema_push_failed", renameQuestion, resetHint);
  }
  return new FxError(
    "schema_push_failed",
    `drizzle-kit push failed: ${errorLine(text)}`,
    `Fix the schema and save it again; fx dev pushes on every save. ${resetHint}`
  );
};

/**
 * Pushes the worktree's Drizzle schema to the database at `url` with
 * `drizzle-kit push`. It changes the database to match the schema and
 * writes no migration files.
 */
export const pushSchema = async (
  worktree: string,
  url: string
): Promise<PushResult> => {
  const started = performance.now();
  let error: FxError | undefined;
  try {
    const { stdout, stderr } = await capture(
      "pnpm",
      ["exec", "drizzle-kit", "push", "--force"],
      {
        cwd: dbPackageDir(worktree),
        env: { ...process.env, DATABASE_URL: url },
        timeoutMs: pushTimeoutMs,
      }
    );
    error = pushFailure(`${stdout}${stderr}`);
  } catch (error_) {
    error =
      error_ instanceof Error && error_.name === "AbortError"
        ? new FxError(
            "schema_push_failed",
            `drizzle-kit push took longer than ${pushTimeoutMs / 1000}s.`,
            resetHint
          )
        : new FxError(
            "schema_push_failed",
            `Couldn't run drizzle-kit: ${String(error_)}`
          );
  }
  const ms = Math.round(performance.now() - started);
  return error ? { ok: false, ms, error } : { ok: true, ms };
};

/**
 * Runs `push` one at a time. Requests made while a push runs are folded
 * into one more push after it. `push` must not throw.
 */
export const createPushQueue = (push: () => Promise<void>) => {
  let running: Promise<void> | undefined;
  let again = false;
  const drain = async (): Promise<void> => {
    again = false;
    await push();
    if (again) {
      await drain();
    }
  };
  return {
    request: (): void => {
      if (running) {
        again = true;
        return;
      }
      running = drain().finally(() => {
        running = undefined;
      });
    },
    /** Resolves once no push is running or queued. */
    idle: (): Promise<void> => running ?? Promise.resolve(),
  };
};

/**
 * Calls `onChange` with the file name once edits to `.ts` files under `dir`
 * have settled for `debounceMs`. Test files are ignored. Returns a function
 * that stops watching.
 */
export const watchSchema = (
  dir: string,
  onChange: (file: string) => void,
  debounceMs = 200
): (() => void) => {
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(dir, { recursive: true }, (_event, file) => {
    if (!file?.endsWith(".ts") || file.endsWith(".test.ts")) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => onChange(file), debounceMs);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
};

export type DevEvent =
  | {
      readonly ok: true;
      readonly event: "started";
      readonly change: string;
      readonly database: string;
      readonly server: string;
      readonly reset: boolean;
    }
  | {
      readonly ok: true;
      readonly event: "schema_pushed";
      readonly trigger: string;
      readonly ms: number;
    }
  | {
      readonly ok: false;
      readonly event: "schema_push_failed";
      readonly trigger: string;
      readonly ms: number;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly hint: string | null;
      };
    }
  | {
      readonly ok: boolean;
      readonly event: "stopped";
      readonly exitCode: number;
    };

/** The human-readable form of one `fx dev` event. */
export const formatDevEvent = (event: DevEvent): string => {
  switch (event.event) {
    case "started": {
      return [
        `fx dev: "${event.change}" is using database ${event.server}.`,
        `fx dev: ${event.reset ? "Rebuilt it from the schema. " : ""}Schema edits are pushed to it as you save; no migration files are written.`,
      ].join("\n");
    }
    case "schema_pushed": {
      return `fx dev: pushed the schema (${event.trigger}) in ${(event.ms / 1000).toFixed(1)}s.`;
    }
    case "schema_push_failed": {
      return `fx dev: schema push failed (${event.trigger}). ${event.error.message}${event.error.hint ? `\nfx dev: ${event.error.hint}` : ""}`;
    }
    case "stopped": {
      return `fx dev: the dev servers stopped (exit ${event.exitCode}).`;
    }
    default: {
      const unreachable: never = event;
      return String(unreachable);
    }
  }
};

export interface DevOptions {
  /** Drop the change's database and rebuild it, empty, from the schema. */
  readonly reset?: boolean;
  /** One JSON object per line on stdout; the dev servers' output goes to stderr. */
  readonly json?: boolean;
  /** Where fx dev's own lines go; stdout by default. */
  readonly write?: (line: string) => void;
  /** The dev servers' command, run in the worktree: `turbo dev` by default. */
  readonly command?: readonly [string, ...string[]];
  /** Pushes the schema; tests replace it. */
  readonly push?: (worktree: string, url: string) => Promise<PushResult>;
  readonly debounceMs?: number;
  /** Stops fx dev when aborted, as SIGTERM does. */
  readonly signal?: AbortSignal;
}

const stopSignals = ["SIGINT", "SIGTERM"] as const;

/** How long the dev servers get to stop before fx dev kills them. */
const stopGraceMs = 10_000;

/**
 * The worktree's own `turbo dev`, run directly rather than through
 * `pnpm dev`: pnpm's launcher adds processes that don't always pass
 * signals on.
 */
const devServersCommand = (worktree: string): [string, ...string[]] => {
  const turbo = path.join(worktree, "node_modules", ".bin", "turbo");
  if (!existsSync(turbo)) {
    throw new FxError(
      "command_failed",
      `${turbo} doesn't exist.`,
      "Run `pnpm install` in the worktree."
    );
  }
  return [turbo, "dev", "--ui=stream"];
};

/**
 * `fx dev`: pushes the schema to the change's database, runs the dev servers
 * with `DATABASE_URL` pointed at it, and pushes again whenever the schema
 * changes. Resolves with the exit code once the dev servers stop.
 */
export const dev = async (
  cwd: string,
  options: DevOptions = {}
): Promise<number> => {
  const write =
    options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const emit = (event: DevEvent) =>
    write(options.json ? JSON.stringify(event) : formatDevEvent(event));

  const repo = await findRepo(cwd);
  const change = changeForPath(
    await listChanges(repo.stateDir),
    repo.worktreeRoot
  );
  if (!change) {
    throw new FxError(
      "change_not_found",
      `${repo.worktreeRoot} isn't a change's worktree, so fx dev has no database to use.`,
      'Start a change with `pnpm fx start "<name>"`, or cd into one; `pnpm fx status` lists them.'
    );
  }
  if (!existsSync(schemaDir(change.worktree))) {
    throw new FxError(
      "command_failed",
      `${schemaDir(change.worktree)} doesn't exist, so there is no schema to push.`
    );
  }
  const [command, ...args] =
    options.command ?? devServersCommand(change.worktree);
  const adminUrl = requireAdminUrl();
  const url = databaseUrl(adminUrl, change.database);

  if (options.reset) {
    await withAdmin(async (client) => {
      await dropDatabase(client, change.database);
      await createDatabase(client, change.database);
    }, adminUrl);
  }
  emit({
    ok: true,
    event: "started",
    change: change.name,
    database: change.database,
    server: describeDatabase(url),
    reset: options.reset === true,
  });

  const push = options.push ?? pushSchema;
  let trigger = "start";
  const queue = createPushQueue(async () => {
    const reason = trigger;
    const result = await push(change.worktree, url);
    emit(
      result.ok
        ? { ok: true, event: "schema_pushed", trigger: reason, ms: result.ms }
        : {
            ok: false,
            event: "schema_push_failed",
            trigger: reason,
            ms: result.ms,
            error: {
              code: result.error.code,
              message: result.error.message,
              hint: result.error.hint ?? null,
            },
          }
    );
  });
  queue.request();
  await queue.idle();

  const stopWatching = watchSchema(
    schemaDir(change.worktree),
    (file) => {
      trigger = file;
      queue.request();
    },
    options.debounceMs
  );
  // The dev servers get their own process group and no stdin, so only fx dev
  // signals them, and only once: turbo stops its tasks cleanly on one
  // signal, but on a second it exits at once and leaves them running. A
  // terminal's Ctrl-C and pnpm's signal forwarding reach fx dev, which
  // always passes on SIGTERM. Turbo runs each task through pnpm, which
  // ignores SIGINT that doesn't come from a terminal.
  const output = options.json ? 2 : "inherit";
  const child = spawn(command, args, {
    cwd: change.worktree,
    env: { ...process.env, DATABASE_URL: url },
    stdio: ["ignore", output, output],
    detached: true,
  });
  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) {
      return;
    }
    try {
      process.kill(-child.pid, signal);
    } catch {
      // The group has already exited.
    }
  };
  let stopping = false;
  let killTimer: NodeJS.Timeout | undefined;
  const stop = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => signalGroup("SIGKILL"), stopGraceMs);
  };
  for (const signal of stopSignals) {
    process.on(signal, stop);
  }
  options.signal?.addEventListener("abort", stop, { once: true });

  let exitCode: number;
  try {
    const [code] = (await once(child, "exit")) as [number | null];
    exitCode = stopping ? 0 : (code ?? 1);
  } finally {
    clearTimeout(killTimer);
    for (const signal of stopSignals) {
      process.off(signal, stop);
    }
    options.signal?.removeEventListener("abort", stop);
    // Anything the dev servers left behind in their group.
    signalGroup("SIGTERM");
    stopWatching();
    await queue.idle();
  }
  emit({ ok: exitCode === 0, event: "stopped", exitCode });
  return exitCode;
};
