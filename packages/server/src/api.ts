// The HTTP API (P1.14, decision 0027): a route per action and query from the
// registry, the OpenAPI document, sign-in under /auth and MCP at /mcp.
import type {
  AnyDefinition,
  Caller,
  Pipeline,
  Registry,
} from "@workspace/actions";
import { Hono } from "hono";
import type { Context } from "hono";
import { requestId } from "hono/request-id";

import { statusFor } from "./errors.ts";
import type { ApiError, ErrorBody } from "./errors.ts";
import { handleMcp } from "./mcp.ts";
import { openApiDocument, pathOf } from "./openapi.ts";

export interface ApiOptions {
  registry: Registry;
  pipeline: Pipeline;
  /** Finds the caller from an API key or a session; `createAuth().callerFrom`. */
  callerFrom: (headers: Headers) => Promise<Caller | null>;
  /** Better Auth's handler, served under `/auth`; `createAuth().auth.handler`. */
  authHandler?: (request: Request) => Promise<Response>;
  /**
   * Local development only: serves `GET /dev/session` with who can sign in
   * and the last codes sent. Without it, the route doesn't exist.
   */
  devSession?: () => Promise<{
    users: { name: string; email: string }[];
    outbox: { email: string; code: string; at: string }[];
  }>;
}

interface Env {
  Variables: { caller: Caller; requestId: string };
}

const maxRetryKeyLength = 255;

const fail = (c: Context<Env>, error: ApiError, runId: string | null = null) =>
  c.json(
    { error, runId, requestId: c.get("requestId") } satisfies ErrorBody,
    statusFor(error)
  );

const invalid = (message: string): ApiError => ({
  code: "validation",
  message,
  issues: [],
});

/** The input of a request: the JSON body, or `?input=` on a GET. */
const inputOf = async (c: Context<Env>): Promise<{ input: unknown } | null> => {
  try {
    if (c.req.method === "GET") {
      const raw = c.req.query("input");
      return { input: raw === undefined ? {} : JSON.parse(raw) };
    }
    return { input: await c.req.json() };
  } catch {
    return null;
  }
};

const route =
  (pipeline: Pipeline, definition: AnyDefinition) =>
  async (c: Context<Env>) => {
    const read = await inputOf(c);
    if (!read) {
      return fail(c, invalid("The input isn't valid JSON."));
    }
    const retryKey = c.req.header("idempotency-key");
    if (retryKey !== undefined && retryKey.length > maxRetryKeyLength) {
      return fail(c, invalid("Idempotency-Key is longer than 255 characters."));
    }
    const caller = c.get("caller");
    if (definition.kind === "query") {
      const result = await pipeline.query(definition, read.input, caller);
      return result.ok
        ? c.json({ output: result.output })
        : fail(c, result.error);
    }
    const result = await pipeline.run(definition, read.input, caller, {
      retryKey,
      dryRun: c.req.query("dryRun") === "true",
    });
    if (!result.ok) {
      return fail(c, result.error, result.runId);
    }
    const { output, runId, replayed, dryRun, changes } = result;
    return c.json({ output, runId, replayed, dryRun, changes });
  };

/** A throw outside the pipeline: log it, and tell the caller nothing more. */
const unexpected = (error: Error, c: Context<Env>) => {
  console.error(error);
  return fail(c, { code: "internal", message: "Something went wrong." });
};

export const createApi = ({
  registry,
  pipeline,
  callerFrom,
  authHandler,
  devSession,
}: ApiOptions) => {
  const app = new Hono<Env>();
  app.use(requestId());

  app.get("/openapi.json", (c) => c.json(openApiDocument(registry)));
  if (authHandler) {
    app.on(["GET", "POST"], "/auth/*", (c) => authHandler(c.req.raw));
  }
  if (devSession) {
    app.get("/dev/session", async (c) => c.json(await devSession()));
  }

  const authenticate = async (c: Context<Env>, next: () => Promise<void>) => {
    const caller = await callerFrom(c.req.raw.headers);
    if (!caller) {
      return fail(c, {
        code: "unauthenticated",
        message: "Send an API key or sign in.",
      });
    }
    c.set("caller", caller);
    return next();
  };
  app.use("/actions/*", authenticate);
  app.use("/queries/*", authenticate);
  app.use("/mcp", authenticate);

  for (const definition of registry.list()) {
    const handler = route(pipeline, definition);
    app.post(pathOf(definition), handler);
    if (definition.kind === "query") {
      app.get(pathOf(definition), handler);
    }
  }

  app.all("/mcp", (c) =>
    handleMcp(c.req.raw, registry, pipeline, c.get("caller"))
  );

  app.notFound((c) =>
    fail(c, {
      code: "not_found",
      message: `Nothing at ${c.req.method} ${c.req.path}.`,
    })
  );
  app.onError(unexpected);

  return app;
};

export type Api = ReturnType<typeof createApi>;
