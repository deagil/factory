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
  actionId?: string;
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

const post = async <T>(
  path: string,
  input: unknown,
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
  const response = await fetch(
    `/api${path}${plan.dryRun ? "?dryRun=true" : ""}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(input ?? {}),
    }
  );
  const body = (await response.json()) as {
    error?: ApiError;
    actionId?: string;
    requestId?: string;
  } & T;
  record({
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? body.requestId,
    actionId: body.actionId,
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
  actionId: string;
  replayed: boolean;
  dryRun: boolean;
}

/** Runs an action; throws `ApiCallError` for a typed error. */
export const runAction = <TOutput = Record<string, unknown>>(
  name: string,
  input: unknown,
  options: { retryKey?: string } = {}
) =>
  post<ActionResult<TOutput>>(
    `/actions/${name}`,
    input,
    options.retryKey ? { "idempotency-key": options.retryKey } : {}
  );

/** Runs a query and returns its output. */
export const runQuery = async <TOutput = Record<string, unknown>>(
  name: string,
  input: unknown = {}
) => {
  const { output } = await post<{ output: TOutput }>(`/queries/${name}`, input);
  return output;
};

/** What the signed-in caller may use (decision 0029). */
export const describeSystem = () =>
  runQuery<SystemDescription>("system.describe");

export type { SystemDescription } from "@workspace/actions";
