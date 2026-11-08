// The config loader (P2.05, SYSTEM_DESIGN §4.4): reads `config/`, validates
// it against the running code, and swaps an in-memory index in one go. A
// version that fails validation is refused and the last good one stays
// live. Each version it tries is recorded (config_versions). Locally it
// reads the working tree and, when watching, reloads on save; the sha is
// then a hash of the files. With a source (the git config service, P2.08)
// it reads production's head commit instead, and the sha is that commit's.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { watch } from "node:fs/promises";
import path from "node:path";

import type { ApprovalRule, ConfigService, Role } from "@workspace/actions";

import { approvalConfigType } from "./approvals.ts";
import { choiceConfigType, choiceLookup } from "./choices.ts";
import type { AnyConfigType, Keyed, ConfigType } from "./config-type.ts";
import { formatProblem } from "./read.ts";
import type { ConfigFile, ConfigProblem } from "./read.ts";
import { roleConfigType } from "./roles.ts";
import { validateConfig } from "./validate.ts";
import type { ConfigCatalog } from "./validate.ts";

/** One loaded version of config: everything a run reads, by type. */
export interface ConfigIndex {
  readonly sha: string;
  readonly files: readonly ConfigFile[];
  readonly values: <TValue extends Keyed>(type: ConfigType<TValue>) => TValue[];
}

export type LoadResult =
  | { readonly status: "loaded"; readonly sha: string }
  | { readonly status: "unchanged"; readonly sha: string }
  | {
      readonly status: "refused";
      readonly sha: string;
      readonly problems: readonly ConfigProblem[];
    };

/** Where config comes from when it isn't the working tree: a git remote. */
export interface ConfigLoaderSource {
  /** The commit config should be at now. */
  readonly head: () => Promise<string>;
  /** The config folder at `sha`, written to a folder of its own. */
  readonly checkout: (sha: string) => Promise<string>;
  /** Removes a folder `checkout` wrote, once nothing reads it. */
  readonly release?: (dir: string) => void;
}

export interface ConfigLoaderOptions {
  /**
   * The `config/` folder, read when there is no source. It may not exist:
   * then there is no config.
   */
  readonly dir: string;
  /** Reads config from here instead of `dir` (P2.08). */
  readonly source?: ConfigLoaderSource;
  readonly types: readonly AnyConfigType[];
  /** What the running code has; read on each load. */
  readonly catalog: () => ConfigCatalog;
  /** Records each version tried, in config_versions. */
  readonly record?: (version: {
    sha: string;
    status: "loaded" | "refused";
    errors: readonly ConfigProblem[] | null;
  }) => Promise<void>;
  /** Where load results are reported; the console by default. */
  readonly log?: (line: string) => void;
}

/** Every file under `dir`, relative and sorted. */
const listFiles = (dir: string, under = ""): string[] =>
  readdirSync(path.join(dir, under))
    .toSorted()
    .flatMap((name) => {
      if (name.startsWith(".")) {
        return [];
      }
      const relative = path.join(under, name);
      return statSync(path.join(dir, relative)).isDirectory()
        ? listFiles(dir, relative)
        : [relative];
    });

/**
 * A working tree's version: a hash of each file's path and contents, so the
 * same files always have the same sha. It's 40 hex characters, like a
 * commit's, but it isn't one.
 */
export const workingTreeSha = (dir: string): string => {
  const hash = createHash("sha1");
  if (existsSync(dir)) {
    for (const file of listFiles(dir)) {
      hash.update(`${file}\0`);
      hash.update(readFileSync(path.join(dir, file)));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
};

const indexOf = (sha: string, files: readonly ConfigFile[]): ConfigIndex => ({
  sha,
  files,
  values: <TValue extends Keyed>(type: ConfigType<TValue>) =>
    files
      .filter((file) => file.type === type.type)
      .map((file) => file.value as TValue),
});

export const createConfigLoader = (options: ConfigLoaderOptions) => {
  const log = options.log ?? ((line: string) => console.info(line));
  let live: ConfigIndex | null = null;
  // The folder the live version was read from, for `validate`.
  let liveDir = options.dir;
  // Loads run one at a time, so the last save always wins.
  let queue: Promise<unknown> = Promise.resolve();

  /** The version to load: a commit from the source, or the working tree. */
  const versionToLoad = async () => {
    if (!options.source) {
      return { sha: workingTreeSha(options.dir), dir: options.dir };
    }
    const sha = await options.source.head();
    return {
      sha,
      dir: live?.sha === sha ? liveDir : await options.source.checkout(sha),
    };
  };

  /** Hands a folder the source wrote back to it, once nothing reads it. */
  const handBack = (dir: string) => {
    if (options.source?.release && dir !== liveDir && dir !== options.dir) {
      options.source.release(dir);
    }
  };

  const loadNow = async (): Promise<LoadResult> => {
    const { sha, dir } = await versionToLoad();
    if (live?.sha === sha) {
      return { status: "unchanged", sha };
    }
    const { files, problems } = validateConfig(
      dir,
      options.types,
      options.catalog()
    );
    if (problems.length > 0) {
      handBack(dir);
      await options.record?.({ sha, status: "refused", errors: problems });
      log(
        `config ${sha.slice(0, 8)} refused; ${live ? `${live.sha.slice(0, 8)} stays live` : "nothing is live"}:\n${problems.map((problem) => `  ${formatProblem(problem)}`).join("\n")}`
      );
      return { status: "refused", sha, problems };
    }
    await options.record?.({ sha, status: "loaded", errors: null });
    live = indexOf(sha, files);
    const previous = liveDir;
    liveDir = dir;
    handBack(previous);
    log(`config ${sha.slice(0, 8)} loaded: ${files.length} file(s).`);
    return { status: "loaded", sha };
  };

  /** Reads, validates and, if it's valid and new, swaps in `config/`. */
  const load = (): Promise<LoadResult> => {
    const next = queue.then(loadNow);
    queue = next.catch(() => null);
    return next;
  };

  /** `load`, for the watcher: a load that throws is logged, not thrown. */
  const reload = async () => {
    try {
      await load();
    } catch (error) {
      log(`config reload failed: ${String(error)}`);
    }
  };

  /** The live version, or null before the first good load. */
  const current = (): ConfigIndex | null => live;

  /**
   * What actions read as `ctx.config`: the live version's sha and roles.
   * The pipeline reads both once per run, so a run sees one version.
   */
  const service: ConfigService = {
    get sha() {
      return live?.sha ?? null;
    },
    get roles(): readonly Role[] {
      return live?.values(roleConfigType) ?? [];
    },
    get approvals(): readonly ApprovalRule[] {
      return live?.values(approvalConfigType) ?? [];
    },
    // Reading `choices` captures the live version, so a run that pinned it
    // keeps its options when a newer version goes live.
    get choices() {
      return choiceLookup(live?.values(choiceConfigType) ?? []);
    },
    validate: () => {
      const { files, problems } = validateConfig(
        liveDir,
        options.types,
        options.catalog()
      );
      return { files: files.length, problems };
    },
  };

  /**
   * Reloads on every save under `config/` until the returned function is
   * called. Saves within `debounceMs` of each other load once.
   */
  const watchDir = (debounceMs = 100): (() => void) => {
    const stop = new AbortController();
    if (!existsSync(options.dir)) {
      return () => stop.abort();
    }
    let timer: NodeJS.Timeout | undefined;
    const follow = async () => {
      try {
        for await (const _change of watch(options.dir, {
          recursive: true,
          signal: stop.signal,
        })) {
          clearTimeout(timer);
          timer = setTimeout(reload, debounceMs);
        }
      } catch (error) {
        if (!stop.signal.aborted) {
          log(`config watching stopped: ${String(error)}`);
        }
      }
    };
    void follow();
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  };

  /**
   * Loads every `intervalMs` until the returned function is called: how an
   * instance on a git remote sees new commits.
   */
  const poll = (intervalMs: number): (() => void) => {
    const timer = setInterval(reload, intervalMs);
    return () => clearInterval(timer);
  };

  return { load, current, service, watch: watchDir, poll };
};

export type ConfigLoader = ReturnType<typeof createConfigLoader>;
