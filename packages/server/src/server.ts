// `createServer` (P1.18, decision 0031): runs a system. It checks the
// database matches the code (decision 0016), then serves the HTTP API, sign-in
// and MCP (decisions 0027 and 0028).
import { promisify } from "node:util";

import { serve } from "@hono/node-server";
import { createPipeline, rolePermissions } from "@workspace/actions";
import { createAuth } from "@workspace/auth";
import type { SendCode } from "@workspace/auth";
import { assertSchema, closeDb, coreTables, createDb } from "@workspace/db";
import type { Db } from "@workspace/db";

import { createApi } from "./api.ts";
import type { System } from "./system.ts";

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
}

export const createServer = async (system: System, options: ServerOptions) => {
  const db: Db = createDb(options.databaseUrl);
  try {
    await assertSchema(db, [...coreTables, ...system.tables]);
  } catch (error) {
    await closeDb(db);
    throw error;
  }
  const config = { sha: null, roles: system.roles };
  const pipeline = createPipeline({
    db,
    config,
    clock: { now: () => new Date() },
    permissions: rolePermissions({ db, config }),
  });
  const auth = createAuth({
    db,
    secret: options.authSecret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    sendCode: options.sendCode,
  });
  const app = createApi({
    registry: system.registry,
    pipeline,
    callerFrom: auth.callerFrom,
    authHandler: auth.auth.handler,
  });

  return {
    app,
    db,
    pipeline,
    /** Closes the database pool; for tests that never listen. */
    close: () => closeDb(db),
    /** Serves on `port` until `close` is called. */
    listen: (port: number) => {
      const server = serve({ fetch: app.fetch, port });
      return {
        close: async () => {
          await promisify(server.close.bind(server))();
          await closeDb(db);
        },
      };
    },
  };
};

export type Server = Awaited<ReturnType<typeof createServer>>;
