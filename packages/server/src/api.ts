// The HTTP API (P1.14, decisions 0027 and 0045): each object's REST
// endpoints, a route per action and query from the registry (until P2.26),
// the OpenAPI document, sign-in under /auth and MCP at /mcp.
import type {
  AnyDefinition,
  Caller,
  ObjectEndpoint,
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
  /** The objects' REST endpoints; `System.endpoints`. */
  endpoints?: readonly ObjectEndpoint[];
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

type Read = { input: unknown } | { error: string };

/** The input of a request: the JSON body, or `?input=` on a GET. */
const inputOf = async (c: Context<Env>): Promise<Read> => {
  try {
    if (c.req.method === "GET") {
      const raw = c.req.query("input");
      return { input: raw === undefined ? {} : JSON.parse(raw) };
    }
    return { input: await c.req.json() };
  } catch {
    return { error: "The input isn't valid JSON." };
  }
};

/** `?archived=` and `?expand=a,b`, the read options of `get` and `list`. */
const readOptions = (c: Context<Env>) => {
  const archived = c.req.query("archived");
  const expand = c.req.query("expand");
  return {
    ...(archived === undefined ? {} : { archived }),
    ...(expand === undefined ? {} : { expand: expand.split(",") }),
  };
};

/** `If-Match: "3"` (or `W/"3"`, or `3`): the version an update expects. */
const versionOf = (header: string | undefined) => {
  if (header === undefined) {
    return {};
  }
  const version = Number(header.replace(/^W\//u, "").replaceAll('"', ""));
  return { version: Number.isInteger(version) ? version : header };
};

/**
 * The input of an object endpoint's request: path, query parameters,
 * `If-Match` and the body, mapped onto its action's or query's input.
 */
const objectInputOf = async (
  c: Context<Env>,
  endpoint: ObjectEndpoint
): Promise<Read> => {
  const id = c.req.param("id") ?? "";
  switch (endpoint.job) {
    case "list": {
      const { filter, sort, cursor, limit } = c.req.query();
      let parsedFilter: unknown;
      try {
        parsedFilter = filter === undefined ? undefined : JSON.parse(filter);
      } catch {
        return { error: "`filter` isn't valid JSON." };
      }
      return {
        input: {
          ...(parsedFilter === undefined ? {} : { filter: parsedFilter }),
          ...(sort === undefined ? {} : { sort }),
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined
            ? {}
            : { limit: Number.isNaN(Number(limit)) ? limit : Number(limit) }),
          ...readOptions(c),
        },
      };
    }
    case "get": {
      return { input: { id, ...readOptions(c) } };
    }
    case "create": {
      return inputOf(c);
    }
    case "update": {
      const read = await inputOf(c);
      if ("error" in read) {
        return read;
      }
      if (
        typeof read.input !== "object" ||
        read.input === null ||
        Array.isArray(read.input)
      ) {
        return { error: "The body must be a JSON object of fields." };
      }
      return {
        input: {
          ...read.input,
          id,
          ...versionOf(c.req.header("if-match")),
        },
      };
    }
    default: {
      return { input: { id } };
    }
  }
};

/** Runs `definition` on `read`'s input and answers in the one envelope. */
const respond = async (
  c: Context<Env>,
  pipeline: Pipeline,
  definition: AnyDefinition,
  read: Read,
  created = false
) => {
  if ("error" in read) {
    return fail(c, invalid(read.error));
  }
  const retryKey = c.req.header("idempotency-key");
  if (retryKey !== undefined && retryKey.length > maxRetryKeyLength) {
    return fail(c, invalid("Idempotency-Key is longer than 255 characters."));
  }
  const caller = c.get("caller");
  if (definition.kind === "query") {
    const result = await pipeline.query(definition, read.input, caller);
    if (!result.ok) {
      return fail(c, result.error);
    }
    const version = (result.output as { record?: { version?: unknown } }).record
      ?.version;
    if (typeof version === "number") {
      c.header("ETag", `"${version}"`);
    }
    return c.json({ output: result.output });
  }
  const result = await pipeline.run(definition, read.input, caller, {
    retryKey,
    dryRun: c.req.query("dryRun") === "true",
  });
  if (!result.ok) {
    return fail(c, result.error, result.runId);
  }
  const { output, runId, replayed, dryRun, changes } = result;
  return c.json(
    { output, runId, replayed, dryRun, changes },
    created && !replayed && !dryRun ? 201 : 200
  );
};

const route =
  (pipeline: Pipeline, definition: AnyDefinition) => async (c: Context<Env>) =>
    respond(c, pipeline, definition, await inputOf(c));

const objectRoute =
  (pipeline: Pipeline, definition: AnyDefinition, endpoint: ObjectEndpoint) =>
  async (c: Context<Env>) =>
    respond(
      c,
      pipeline,
      definition,
      await objectInputOf(c, endpoint),
      endpoint.job === "create"
    );

/** `/deals/{id}/archive` in Hono's form: `/deals/:id/archive`. */
const honoPath = (path: string) => path.replace("{id}", ":id");

/** A throw outside the pipeline: log it, and tell the caller nothing more. */
const unexpected = (error: Error, c: Context<Env>) => {
  console.error(error);
  return fail(c, { code: "internal", message: "Something went wrong." });
};

export const createApi = ({
  registry,
  endpoints = [],
  pipeline,
  callerFrom,
  authHandler,
  devSession,
}: ApiOptions) => {
  const app = new Hono<Env>();
  app.use(requestId());

  app.get("/openapi.json", (c) => c.json(openApiDocument(registry, endpoints)));
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

  for (const path of new Set(endpoints.map((e) => honoPath(e.path)))) {
    app.use(path, authenticate);
  }
  for (const endpoint of endpoints) {
    const definition = registry.get(endpoint.name);
    if (!definition) {
      throw new Error(
        `The endpoint ${endpoint.method} ${endpoint.path} runs "${endpoint.name}", which isn't registered.`
      );
    }
    app.on(
      endpoint.method,
      honoPath(endpoint.path),
      objectRoute(pipeline, definition, endpoint)
    );
  }

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
