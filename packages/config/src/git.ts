// The git config service (P2.08, decision 0041): drafts over any git remote,
// with plain git commands. It keeps a bare clone of the remote as a cache and
// writes commits with plumbing (a temporary index, `commit-tree`, `push`), so
// it never needs a working tree. A draft is a branch made from production,
// one commit per saved file. Publishing writes the draft's files onto
// production as one commit, then copies the same files onto main: the bot of
// SYSTEM_DESIGN §4.4, which is a function here until phase 3.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ConfigAuthor,
  ConfigCheck,
  ConfigFileDiff,
  GitService,
  PublishResult,
} from "@workspace/actions";

import type { AnyConfigType } from "./config-type.ts";
import type { ConfigLoaderSource } from "./loader.ts";
import { validateConfig } from "./validate.ts";
import type { ConfigCatalog } from "./validate.ts";

export interface GitConfigOptions {
  /** The remote: a URL or a path to a repository, bare or not. */
  readonly remote: string;
  /** Where the bare clone lives, absolute; made on first use. */
  readonly cacheDir: string;
  /** The branch staff publish to and the instance runs. */
  readonly production?: string;
  /** The branch developers work on, which publishes are copied to. */
  readonly main?: string;
  /** The config folder in the repository. */
  readonly configPath?: string;
  readonly types: readonly AnyConfigType[];
  readonly catalog: () => ConfigCatalog;
  /** Called after each publish with production's new commit. */
  readonly onPublished?: (sha: string) => Promise<unknown>;
}

/** Who commits: the service, whoever the author is. */
const committer: ConfigAuthor = {
  name: "Factory config service",
  email: "config-service@factory.invalid",
};

/** Tries at a push before giving up on a branch that keeps moving. */
const attempts = 3;

const shaPattern = /^[0-9a-f]{40}$/u;

class GitError extends Error {
  readonly stderr: string;
  constructor(args: readonly string[], code: number | null, stderr: string) {
    super(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
    this.name = "GitError";
    this.stderr = stderr;
  }
}

interface RunOptions {
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly input?: string;
}

const git = async (args: readonly string[], options: RunOptions = {}) => {
  const child = spawn("git", args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      // No prompts, and no one's own git config deciding what we write.
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...options.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdin.end(options.input ?? "");
  const [code] = (await once(child, "close")) as [number | null];
  if (code !== 0) {
    throw new GitError(args, code, stderr);
  }
  return stdout;
};

const authorEnv = (author: ConfigAuthor) => ({
  GIT_AUTHOR_NAME: author.name,
  GIT_AUTHOR_EMAIL: author.email,
  GIT_COMMITTER_NAME: committer.name,
  GIT_COMMITTER_EMAIL: committer.email,
});

/** A change to one path: its new blob, or null to remove it. */
interface PathChange {
  readonly path: string;
  readonly blob: string | null;
}

/** A folder of its own, removed when `work` finishes. */
const withTempDir = async <T>(
  prefix: string,
  work: (dir: string) => Promise<T>
) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return await work(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** A temporary index, for building trees without a work tree. */
const withIndex = <T>(work: (env: Record<string, string>) => Promise<T>) =>
  withTempDir("factory-index-", (dir) =>
    work({ GIT_INDEX_FILE: path.join(dir, "index") })
  );

/** `git update-index --index-info` lines; a zero mode removes the path. */
const indexInfo = (changes: readonly PathChange[]) =>
  changes
    .map((change) =>
      change.blob
        ? `100644 ${change.blob}\t${change.path}\n`
        : `0 ${"0".repeat(40)}\t${change.path}\n`
    )
    .join("");

export const createGitConfigService = (options: GitConfigOptions) => {
  const production = options.production ?? "production";
  const main = options.main ?? "main";
  const configPath = options.configPath ?? "config";
  const repo = path.resolve(options.cacheDir);
  const checkouts = `${repo}-checkouts`;
  const inRepo = (args: readonly string[], run: RunOptions = {}) =>
    git(args, { ...run, cwd: repo });
  const trimmed = async (args: readonly string[], run: RunOptions = {}) => {
    const output = await inRepo(args, run);
    return output.trim();
  };

  // One git operation at a time, so two saves never race on the cache.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => null);
    return next;
  };

  let cloned: Promise<void> | undefined;
  /** Brings every branch in the cache up to the remote's. */
  const fetch = async () => {
    cloned ??= (async () => {
      if (!existsSync(path.join(repo, "HEAD"))) {
        mkdirSync(path.dirname(repo), { recursive: true });
        await git(["clone", "--bare", "--quiet", options.remote, repo]);
      }
    })();
    await cloned;
    await inRepo([
      "fetch",
      "--quiet",
      "--prune",
      "--force",
      "origin",
      "+refs/heads/*:refs/heads/*",
    ]);
  };

  const headOf = (branch: string) =>
    trimmed(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);

  /** Pushes `sha` to `branch`; false when the branch moved meanwhile. */
  const push = async (sha: string, branch: string): Promise<boolean> => {
    try {
      await inRepo([
        "push",
        "--quiet",
        "origin",
        `${sha}:refs/heads/${branch}`,
      ]);
    } catch (error) {
      if (
        error instanceof GitError &&
        /rejected|fetch first|non-fast-forward/u.test(error.stderr)
      ) {
        return false;
      }
      throw error;
    }
    await inRepo(["update-ref", `refs/heads/${branch}`, sha]);
    return true;
  };

  /** The paths under the config folder that differ between two commits. */
  const changedPaths = async (from: string, to: string) => {
    const output = await inRepo([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      from,
      to,
      "--",
      configPath,
    ]);
    return output.split("\0").filter((each) => each.length > 0);
  };

  /** The object at `ref:file`, or null where there is none. */
  const objectAt = async (ref: string, file: string) => {
    try {
      return await trimmed([
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}:${file}`,
      ]);
    } catch {
      return null;
    }
  };

  const contentAt = async (ref: string, file: string) => {
    const blob = await objectAt(ref, file);
    return blob ? await inRepo(["cat-file", "blob", blob]) : null;
  };

  /** The tree of `base` with `changes` applied. */
  const treeWith = (base: string, changes: readonly PathChange[]) =>
    withIndex(async (env) => {
      await inRepo(["read-tree", base], { env });
      await inRepo(["update-index", "--index-info"], {
        env,
        input: indexInfo(changes),
      });
      return trimmed(["write-tree"], { env });
    });

  const commitTree = (input: {
    tree: string;
    parent: string;
    message: string;
    author: ConfigAuthor;
  }) =>
    trimmed(
      [
        "commit-tree",
        "--no-gpg-sign",
        input.tree,
        "-p",
        input.parent,
        "-F",
        "-",
      ],
      { env: authorEnv(input.author), input: input.message }
    );

  /** Writes the config folder at `ref` (a commit or a tree) to `target`. */
  const materialise = (ref: string, target: string) =>
    withIndex(async (env) => {
      mkdirSync(target, { recursive: true });
      const tree = await objectAt(ref, configPath);
      if (!tree) {
        return;
      }
      // A bare repository has no work tree, so it borrows `target` as one.
      const lent = { ...env, GIT_WORK_TREE: target };
      await inRepo(["read-tree", tree], { env: lent });
      await inRepo(["checkout-index", "--all", "--force"], { env: lent });
    });

  /** Validates the config at `ref` against the running code. */
  const checkRef = (ref: string): Promise<ConfigCheck> =>
    withTempDir("factory-config-", async (dir) => {
      const configDir = path.join(dir, configPath);
      await materialise(ref, configDir);
      const { files, problems } = validateConfig(
        configDir,
        options.types,
        options.catalog()
      );
      return { files: files.length, problems };
    });

  const changesFrom = (ref: string, files: readonly string[]) =>
    Promise.all(
      files.map(async (file) => ({
        path: file,
        blob: await objectAt(ref, file),
      }))
    );

  /* oxlint-disable eslint/no-await-in-loop -- each attempt follows the last,
     after a fetch, when the branch moved under it. */
  /**
   * Copies a publish's files onto main: the bot. A file main has changed
   * since production had it is a conflict, and then nothing is copied.
   */
  const copyToMain = async (input: {
    files: readonly string[];
    before: string;
    published: string;
    message: string;
    author: ConfigAuthor;
  }): Promise<
    { status: "copied"; sha: string } | { status: "conflict"; files: string[] }
  > => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const head = await headOf(main);
      const changed = await Promise.all(
        input.files.map(
          async (file) =>
            (await objectAt(head, file)) !==
            (await objectAt(input.before, file))
        )
      );
      const diverged = input.files.filter((_file, index) => changed[index]);
      if (diverged.length > 0) {
        return { status: "conflict", files: diverged };
      }
      const tree = await treeWith(
        head,
        await changesFrom(input.published, input.files)
      );
      const sha = await commitTree({
        tree,
        parent: head,
        message: `${input.message}\n\nProduction-Commit: ${input.published}\n`,
        author: input.author,
      });
      if (await push(sha, main)) {
        return { status: "copied", sha };
      }
      await fetch();
    }
    throw new Error(
      `Couldn't copy ${input.published} to ${main}: it kept moving.`
    );
  };

  /** Writes a draft onto production as one commit, retrying if it moves. */
  const publishNow = async (input: {
    branch: string;
    base: string;
    message: string;
    author: ConfigAuthor;
  }): Promise<PublishResult> => {
    await fetch();
    const draft = await headOf(input.branch);
    const files = await changedPaths(input.base, draft);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const before = await headOf(production);
      const moved = new Set(await changedPaths(input.base, before));
      const conflicts = files.filter((file) => moved.has(file));
      if (conflicts.length > 0) {
        return { status: "conflict", files: conflicts };
      }
      const tree = await treeWith(before, await changesFrom(draft, files));
      const { problems } = await checkRef(tree);
      if (problems.length > 0) {
        return { status: "invalid", problems };
      }
      const sha = await commitTree({
        tree,
        parent: before,
        message: input.message,
        author: input.author,
      });
      if (await push(sha, production)) {
        // The draft branch has done its job: production has its changes.
        await inRepo([
          "push",
          "--quiet",
          "origin",
          `:refs/heads/${input.branch}`,
        ]);
        await inRepo(["update-ref", "-d", `refs/heads/${input.branch}`]);
        const synced = await copyToMain({
          files,
          before,
          published: sha,
          message: input.message,
          author: input.author,
        });
        return { status: "published", sha, synced };
      }
      await fetch();
    }
    throw new Error(`Couldn't publish to ${production}: it kept moving.`);
  };
  /* oxlint-enable eslint/no-await-in-loop */

  const service: GitService = {
    production,

    head: (branch) =>
      serial(async () => {
        await fetch();
        return headOf(branch);
      }),

    branch: (name) =>
      serial(async () => {
        await fetch();
        const base = await headOf(production);
        if (!(await push(base, name))) {
          throw new Error(`The branch ${name} already exists.`);
        }
        return base;
      }),

    commit: (input) =>
      serial(async () => {
        await fetch();
        const parent = await headOf(input.branch);
        const blob =
          input.content === null
            ? null
            : await trimmed(["hash-object", "-w", "--stdin"], {
                input: input.content,
              });
        const tree = await treeWith(parent, [{ path: input.path, blob }]);
        if (tree === (await trimmed(["rev-parse", `${parent}^{tree}`]))) {
          return { status: "committed", sha: parent };
        }
        const sha = await commitTree({
          tree,
          parent,
          message: input.message,
          author: input.author,
        });
        return (await push(sha, input.branch))
          ? { status: "committed", sha }
          : { status: "conflict" };
      }),

    diff: (from, to) =>
      serial(async () => {
        await fetch();
        const files = await changedPaths(from, to);
        return Promise.all(
          files.map(async (file): Promise<ConfigFileDiff> => ({
            path: file,
            before: await contentAt(from, file),
            after: await contentAt(to, file),
          }))
        );
      }),

    check: (ref) =>
      serial(async () => {
        await fetch();
        return checkRef(ref);
      }),

    publish: async (input) => {
      const result = await serial(() => publishNow(input));
      if (result.status === "published") {
        await options.onPublished?.(result.sha);
      }
      return result;
    },
  };

  /**
   * The loader's source: production's head, with its config folder written
   * to `<cacheDir>-checkouts/<sha>/`.
   */
  const source: ConfigLoaderSource = {
    head: () => service.head(production),
    checkout: (sha) =>
      serial(async () => {
        if (!shaPattern.test(sha)) {
          throw new Error(`"${sha}" isn't a commit sha.`);
        }
        const dir = path.join(checkouts, sha, configPath);
        if (!existsSync(dir)) {
          await fetch();
          await materialise(sha, dir);
        }
        return dir;
      }),
    release: (dir) => {
      // Only ever a version folder this source wrote.
      const relative = path.relative(checkouts, path.resolve(dir));
      const [sha] = relative.split(path.sep);
      if (sha && shaPattern.test(sha) && !relative.startsWith("..")) {
        rmSync(path.join(checkouts, sha), { recursive: true, force: true });
      }
    },
  };

  return { ...service, source };
};

export type GitConfigService = ReturnType<typeof createGitConfigService>;
