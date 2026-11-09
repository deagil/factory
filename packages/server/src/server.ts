// `createServer` (P1.18, decision 0031): runs a system. It checks the
// database matches the code (decision 0016), loads the system's config
// (P2.05) from its working tree or a config remote (P2.08), then serves the
// HTTP API, sign-in and MCP (decisions 0027 and 0028).
import { promisify } from "node:util";

import { serve } from "@hono/node-server";
import { createPipeline, rolePermissions } from "@workspace/actions";
import { createAuth, createDevOutbox } from "@workspace/auth";
import type { SendCode } from "@workspace/auth";
import {
  ConfigError,
  createConfigLoader,
  createGitConfigService,
} from "@workspace/config";
import {
  activeUsers,
  assertSchema,
  closeDb,
  coreTables,
  createDb,
  recordConfigVersion,
} from "@workspace/db";
import type { Db } from "@workspace/db";

import { createApi } from "./api.ts";
import type { System } from "./system.ts";
import { createWorkflowCalls } from "./workflow-calls.ts";

export interface ServerOptions {
  databaseUrl: string;
  /** At least 32 characters; signs sessions. */
  authSecret: string;
  /** Where the server is reached, such as `http://localhost:3000`. */
  baseURL: string;
  /** Web origins allowed to sign in, such as the web app's. */
  trustedOrigins?: string[];
  /** Sends sign-in codes; prints them to the console by default. */
  sendCode?: SendCode;
  /**
   * Local development only: keep the codes printed, and serve them with
   * the people who can sign in at `GET /dev/session`, for the web app's dev
   * bar (P1b.09). Never set it in production.
   */
  devOutbox?: boolean;
  /**
   * Reload `config/` on every save (P2.05). For local development, where
   * config is read from the working tree.
   */
  watchConfig?: boolean;
  /** Where config loads are reported; the console by default. */
  log?: (line: string) => void;
  /**
   * Read config from a git remote's production branch instead of the
   * working tree, and let staff change it in drafts (P2.08). Tests use a
   * bare repository on disk.
   */
  configRemote?: ConfigRemote;
}

export interface ConfigRemote {
  /** A URL or a path to a repository. */
  url: string;
  /** Where the server keeps its clone of the remote, absolute. */
  cacheDir: string;
  /** `production` by default. */
  production?: string;
  /** `main` by default; publishes are copied to it. */
  main?: string;
  /** How often to look for new commits on production; never by default. */
  pollMs?: number;
}

export const createServer = async (system: System, options: ServerOptions) => {
  const db: Db = createDb(options.databaseUrl);
  try {
    await assertSchema(db, [...coreTables, ...system.tables]);
  } catch (error) {
    await closeDb(db);
    throw error;
  }
  const remote = system.config ? options.configRemote : undefined;
  // Publishing reloads config, so the next run sees the draft's changes.
  const reload: { load?: () => Promise<unknown> } = {};
  const git = remote
    ? createGitConfigService({
        remote: remote.url,
        cacheDir: remote.cacheDir,
        production: remote.production,
        main: remote.main,
        types: system.configTypes,
        catalog: system.catalog,
        onPublished: async () => {
          await reload.load?.();
        },
      })
    : undefined;
  // No config folder means no config: no roles, so no one can do anything.
  const loader = createConfigLoader({
    dir: system.config ?? "",
    source: git?.source,
    types: system.configTypes,
    catalog: system.catalog,
    record: (version) => recordConfigVersion(db, version),
    log: options.log,
    workflows: system.workflowEntries,
  });
  const loaded = system.config
    ? await loader.load().catch(async (error: unknown) => {
        await closeDb(db);
        throw error;
      })
    : null;
  if (loaded?.status === "refused") {
    // There is no last good version to keep at start-up.
    await closeDb(db);
    throw new ConfigError(loaded.problems);
  }
  reload.load = loader.load;
  // On a remote, poll production; locally, watch the working tree.
  const follow = () => {
    if (git) {
      return remote?.pollMs ? loader.poll(remote.pollMs) : undefined;
    }
    return system.config && options.watchConfig ? loader.watch() : undefined;
  };
  const stopWatching = follow();
  const config = loader.service;
  const clock = { now: () => new Date() };
  const pipeline = createPipeline({
    db,
    config,
    git,
    clock,
    permissions: rolePermissions({ db, config }),
    actions: (name) => {
      const definition = system.registry.get(name);
      return definition && definition.kind !== "query" ? definition : undefined;
    },
    objects: system.objects,
  });
  const outbox = options.devOutbox ? createDevOutbox() : null;
  const auth = createAuth({
    db,
    secret: options.authSecret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    sendCode: outbox?.send ?? options.sendCode,
  });
  const workflowCalls = createWorkflowCalls({
    db,
    pipeline,
    clock,
    stepActions: system.stepActions,
    definitions: system.registry.list(),
  });
  const app = createApi({
    registry: system.registry,
    endpoints: system.endpoints,
    pipeline,
    workflowCalls,
    workflows: () => config.workflows ?? [],
    callerFrom: auth.callerFrom,
    authHandler: auth.auth.handler,
    devSession: outbox
      ? async () => ({ users: await activeUsers(db), outbox: outbox.list() })
      : undefined,
  });

  return {
    app,
    db,
    pipeline,
    workflowCalls,
    /** The config loader: the live version, and `load` to reload by hand. */
    config: loader,
    /** Closes the database pool; for tests that never listen. */
    close: () => {
      stopWatching?.();
      return closeDb(db);
    },
    /** Serves on `port` until `close` is called. */
    listen: (port: number) => {
      const server = serve({ fetch: app.fetch, port });
      return {
        close: async () => {
          stopWatching?.();
          await promisify(server.close.bind(server))();
          await closeDb(db);
        },
      };
    },
  };
};

export type Server = Awaited<ReturnType<typeof createServer>>;
