// The typed API client: every read and write goes through the HTTP API
// (AGENTS.md rule 6), via the dev proxy at /api (decision 0032).
import type { SystemDescription } from "@workspace/actions";
import type { ApiError } from "@workspace/server";

/** A failed call, with the API's typed error (decision 0027). */
export class ApiCallError extends Error {
  readonly error: ApiError;
  readonly status: number;

  constructor(error: ApiError, status: number) {
    super(error.message);
    this.name = "ApiCallError";
    this.error = error;
    this.status = status;
  }
}

/** One call the web app made, for the dev bar's API menu. */
export interface ApiCallRecord {
  at: number;
  path: string;
  status: number;
  ms: number;
  requestId?: string;
  runId?: string;
  dryRun: boolean;
  forced: boolean;
}

/** Local-development hooks around every call; only the dev bar sets them. */
export interface ApiDevHooks {
  before: (path: string) => Promise<{
    dryRun?: boolean;
    fail?: { error: ApiError; status: number };
  }>;
  after: (call: ApiCallRecord) => void;
}

let devHooks: ApiDevHooks | undefined;

export const setApiDevHooks = (hooks: ApiDevHooks | undefined) => {
  devHooks = hooks;
};

type Method = "GET" | "POST" | "PATCH";

const send = async <T>(
  method: Method,
  path: string,
  input?: unknown,
  headers: Record<string, string> = {}
): Promise<T> => {
  const started = Date.now();
  const plan = devHooks ? await devHooks.before(path) : {};
  const record = (call: Omit<ApiCallRecord, "at" | "path" | "ms" | "dryRun">) =>
    devHooks?.after({
      ...call,
      at: started,
      path,
      ms: Date.now() - started,
      dryRun: plan.dryRun ?? false,
    });
  if (plan.fail) {
    record({ status: plan.fail.status, forced: true });
    throw new ApiCallError(plan.fail.error, plan.fail.status);
  }
  const dryRun = plan.dryRun
    ? `${path.includes("?") ? "&" : "?"}dryRun=true`
    : "";
  const response = await fetch(`/api${path}${dryRun}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(input ?? {}) }),
  });
  const body = (await response.json()) as {
    error?: ApiError;
    runId?: string;
    requestId?: string;
  } & T;
  record({
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? body.requestId,
    runId: body.runId,
    forced: false,
  });
  if (!response.ok || body.error) {
    throw new ApiCallError(
      body.error ?? { code: "internal", message: response.statusText },
      response.status
    );
  }
  return body;
};

export interface ActionResult<TOutput> {
  output: TOutput;
  runId: string;
  replayed: boolean;
  dryRun: boolean;
}

/** Runs an action; throws `ApiCallError` for a typed error. */
export const runAction = <TOutput = Record<string, unknown>>(
  name: string,
  input: unknown,
  options: { retryKey?: string } = {}
) =>
  send<ActionResult<TOutput>>(
    "POST",
    `/actions/${name}`,
    input,
    options.retryKey ? { "idempotency-key": options.retryKey } : {}
  );

export interface WorkflowResult<TOutput> {
  output: TOutput;
  runId: string;
  replayed: boolean;
}

/** Calls a workflow endpoint (P2.18); throws `ApiCallError` for its errors. */
export const runWorkflow = <TOutput = Record<string, unknown>>(
  key: string,
  input: unknown
) => send<WorkflowResult<TOutput>>("POST", `/workflows/${key}`, input);

/** A read-only workflow's input, as JSON in `?input=`. */
const inputQuery = (input: Record<string, unknown>) => {
  const present = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  return Object.keys(present).length > 0
    ? `?input=${encodeURIComponent(JSON.stringify(present))}`
    : "";
};

/** Reads a read-only workflow. Throws `ApiCallError` for its errors. */
export const readWorkflow = <TOutput = Record<string, unknown>>(
  key: string,
  input: Record<string, unknown> = {}
) =>
  send<WorkflowResult<TOutput>>(
    "GET",
    `/workflows/${encodeURIComponent(key)}${inputQuery(input)}`
  );

/** Runs a query and returns its output. */
export const runQuery = async <TOutput = Record<string, unknown>>(
  name: string,
  input: unknown = {}
) => {
  const { output } = await send<{ output: TOutput }>(
    "POST",
    `/queries/${name}`,
    input
  );
  return output;
};

/** An object's REST endpoints, as `system.describe` lists them. */
export type Endpoints = readonly { path: string; name: string }[];

/** A list's or get's input as query parameters: JSON filter, comma expand. */
const queryOf = (input: Record<string, unknown>) => {
  const entries = Object.entries(input).flatMap(
    ([key, value]): [string, string][] => {
      if (value === undefined) {
        return [];
      }
      if (Array.isArray(value)) {
        return value.length > 0 ? [[key, value.join(",")]] : [];
      }
      return [
        [
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ],
      ];
    }
  );
  return entries.length > 0
    ? `?${new URLSearchParams(entries).toString()}`
    : "";
};

/**
 * An object's REST endpoints (decision 0045). A job with no endpoint, such
 * as a deal's create that a hand-written action owns, runs that action
 * through `/actions` until workflows replace it (P2.25).
 */
export const objectApi = (name: string, endpoints: Endpoints = []) => {
  const pathOf = (job: string, id = "") =>
    endpoints
      .find((endpoint) => endpoint.name === `${name}_${job}`)
      ?.path.replace("{id}", encodeURIComponent(id));
  const read = async <TOutput>(
    path: string | undefined,
    job: string,
    input: Record<string, unknown>
  ) => {
    if (path === undefined) {
      return runQuery<TOutput>(`${name}_${job}`, input);
    }
    const { output } = await send<{ output: TOutput }>(
      "GET",
      `${path}${queryOf(input)}`
    );
    return output;
  };
  return {
    list: <TOutput>(input: Record<string, unknown>) =>
      read<TOutput>(pathOf("list"), "list", input),
    get: <TOutput>(id: string, input: Record<string, unknown> = {}) => {
      const { id: _, ...rest } = input;
      const path = pathOf("get", id);
      return path === undefined
        ? runQuery<TOutput>(`${name}_get`, { id, ...rest })
        : read<TOutput>(path, "get", rest);
    },
    history: <TOutput>(id: string) => {
      const path = pathOf("history", id);
      return path === undefined
        ? runQuery<TOutput>(`${name}_history`, { id })
        : read<TOutput>(path, "history", {});
    },
    create: <TOutput = Record<string, unknown>>(
      values: Record<string, unknown>,
      options: { retryKey?: string } = {}
    ) => {
      const path = pathOf("create");
      const headers: Record<string, string> = options.retryKey
        ? { "idempotency-key": options.retryKey }
        : {};
      return path === undefined
        ? runAction<TOutput>(`${name}_create`, values, options)
        : send<ActionResult<TOutput>>("POST", path, values, headers);
    },
    update: (id: string, version: number, values: Record<string, unknown>) => {
      const path = pathOf("update", id);
      return path === undefined
        ? runAction(`${name}_update`, { ...values, id, version })
        : send<ActionResult<Record<string, unknown>>>("PATCH", path, values, {
            "if-match": `"${version}"`,
          });
    },
    archive: (id: string) => {
      const path = pathOf("archive", id);
      return path === undefined
        ? runAction(`${name}_archive`, { id })
        : send<ActionResult<Record<string, unknown>>>("POST", path, {});
    },
    restore: (id: string) => {
      const path = pathOf("restore", id);
      return path === undefined
        ? runAction(`${name}_restore`, { id })
        : send<ActionResult<Record<string, unknown>>>("POST", path, {});
    },
  };
};

/** What the signed-in caller may use (decision 0029). */
export const describeSystem = () =>
  runQuery<SystemDescription>("system.describe");

export type { SystemDescription } from "@workspace/actions";
