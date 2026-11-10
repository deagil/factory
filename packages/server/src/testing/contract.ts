// Contract tests across surfaces (P1.17, P2.13): every action, and every
// generated query, runs through the objects' REST endpoints, `/actions` and
// `/queries`, and MCP with the same input, and all must give the same result
// and write the same log rows. A system's tests call `runContract` with its
// registry; any difference is reported.
import { randomUUID } from "node:crypto";

import type {
  AnyDefinition,
  Caller,
  ObjectEndpoint,
  Pipeline,
  Registry,
} from "@workspace/actions";
import type { Db } from "@workspace/db";
import { isComputedField } from "@workspace/objects";
import type {
  AnyField,
  AnyObjectDefinition,
  ChoiceOptions,
} from "@workspace/objects";

/** What one surface did with one call, as the client and the logs see it. */
export interface SurfaceCall {
  ok: boolean;
  /** The output on success, the typed error on failure. */
  body: unknown;
  runId: string | null;
}

/** A way to call an action or query: REST, `/actions`, MCP, or a broken copy. */
export type Surface = (
  definition: AnyDefinition,
  input: unknown
) => Promise<SurfaceCall>;

/** A request to an app such as `createApi`'s. */
type Fetch = (path: string, init: RequestInit) => Response | Promise<Response>;

const headers = {
  authorization: "Bearer contract",
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

const callOf = async (response: Response): Promise<SurfaceCall> => {
  const body = (await response.json()) as {
    output?: unknown;
    error?: unknown;
    runId?: string | null;
  };
  const runId = body.runId ?? null;
  // approval_required is a 202: accepted, but not run, so it's an error.
  return response.ok && body.error === undefined
    ? { ok: true, body: body.output, runId }
    : { ok: false, body: body.error, runId };
};

/** `/actions/<name>` and `/queries/<name>`, which go in P2.26. */
export const httpSurface =
  (request: Fetch): Surface =>
  async (definition, input) =>
    callOf(
      await request(
        `/${definition.kind === "query" ? "queries" : "actions"}/${definition.name}`,
        { method: "POST", headers, body: JSON.stringify(input) }
      )
    );

/** A query parameter: strings as they are, lists comma-separated, else JSON. */
const parameter = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  return Array.isArray(value) ? value.join(",") : JSON.stringify(value);
};

/** An object endpoint's request for `input`: path, query, If-Match, body. */
const restRequest = (
  endpoint: ObjectEndpoint,
  input: unknown
): { path: string; init: RequestInit } => {
  const { id, version, ...rest } = (input ?? {}) as Record<string, unknown>;
  const path = endpoint.path.replace("{id}", encodeURIComponent(String(id)));
  if (endpoint.method === "GET") {
    const query = new URLSearchParams(
      Object.entries(rest).map(([key, value]) => [key, parameter(value)])
    ).toString();
    return {
      path: query ? `${path}?${query}` : path,
      init: { method: "GET", headers },
    };
  }
  const bodies: Partial<Record<ObjectEndpoint["job"], unknown>> = {
    create: input,
    update: rest,
  };
  const body = bodies[endpoint.job];
  return {
    path,
    init: {
      method: endpoint.method,
      headers:
        version === undefined
          ? headers
          : { ...headers, "if-match": `"${String(version)}"` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  };
};

/**
 * The objects' REST endpoints (decision 0045); a definition without one goes
 * to `/actions` or `/queries` instead.
 */
export const restSurface = (
  request: Fetch,
  endpoints: readonly ObjectEndpoint[]
): Surface => {
  const byName = new Map(
    endpoints.map((endpoint) => [endpoint.name, endpoint])
  );
  const fallback = httpSurface(request);
  return async (definition, input) => {
    const endpoint = byName.get(definition.name);
    if (!endpoint) {
      return fallback(definition, input);
    }
    const { path, init } = restRequest(endpoint, input);
    return callOf(await request(path, init));
  };
};

/** Calls the MCP tool `name` with `input`, as a surface sees it. */
const mcpCall = async (
  request: Fetch,
  name: string,
  input: unknown
): Promise<SurfaceCall> => {
  const response = await request("/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: input },
    }),
  });
  const { result } = (await response.json()) as {
    result: {
      isError?: boolean;
      structuredContent?: unknown;
      content: { text: string }[];
      _meta?: { runId?: string };
    };
  };
  const runId = result._meta?.runId ?? null;
  if (!result.isError) {
    // MCP adds the action id to an action's output; HTTP has it beside.
    const { runId: _, ...body } = (result.structuredContent ?? {}) as Record<
      string,
      unknown
    >;
    return { ok: true, body, runId };
  }
  const text = result.content[0]?.text ?? "";
  const json = text.slice(text.indexOf("\n") + 1);
  try {
    return {
      ok: false,
      body: (JSON.parse(json) as { error: unknown }).error,
      runId,
    };
  } catch {
    // Not one of our typed errors: the MCP SDK refused the call itself.
    return { ok: false, body: { sdk: text }, runId };
  }
};

export const mcpSurface =
  (request: Fetch): Surface =>
  (definition, input) =>
    mcpCall(request, definition.name.replace(".", "_"), input);

// Sample inputs.

/** A sample value for a field; `variant` gives a different one for updates. */
const sampleValue = async (
  field: AnyField,
  variant: number,
  refTo: (target: string) => Promise<string>,
  choices: ChoiceOptions | undefined
): Promise<unknown> => {
  switch (field.kind) {
    case "text": {
      return `Sample ${variant}`;
    }
    case "email": {
      return `sample${variant}@example.com`;
    }
    case "url": {
      return `https://example${variant}.com`;
    }
    case "number": {
      return variant;
    }
    case "money": {
      return {
        amount: 100 * variant,
        currency: (field as AnyField & { currency?: string }).currency ?? "GBP",
      };
    }
    case "boolean": {
      return variant % 2 === 1;
    }
    case "date": {
      return `2026-01-0${variant}`;
    }
    case "ref": {
      return await refTo(
        String((field as AnyField & { target: string }).target)
      );
    }
    case "choice": {
      // An option that can be chosen: the first, or the second for updates.
      const { list } = field as AnyField & { list: { key: string } };
      const live = (choices?.(list.key) ?? []).filter(
        (option) => !option.archived
      );
      const option = live[(variant - 1) % Math.max(live.length, 1)];
      if (!option) {
        throw new Error(`No options loaded for the choice list ${list.key}`);
      }
      return option.key;
    }
    default: {
      throw new Error(`No sample for a ${field.kind} field`);
    }
  }
};

export interface ContractOptions {
  registry: Registry;
  objects: readonly AnyObjectDefinition[];
  pipeline: Pipeline;
  db: Db;
  /** Who calls, on every surface; the surfaces must authenticate as them. */
  caller: Caller;
  /** The surfaces to compare; the first is the reference. */
  surfaces: Record<string, Surface>;
  /**
   * Inputs for hand-written actions, made fresh for each surface. Generated
   * actions and queries get theirs from their fields.
   */
  samples?: Record<string, () => Promise<unknown>>;
  /** The loaded choice options, for samples of choice fields. */
  choices?: ChoiceOptions;
}

/** A difference between surfaces, or an action with no sample. */
export interface ContractProblem {
  action: string;
  case: "sample" | "invalid";
  problem: string;
}

/** Replaces ids, times and keys, so two runs of one call compare equal. */
const normalise = (value: unknown) => {
  const ids = new Map<string, string>();
  return JSON.parse(
    JSON.stringify(value ?? null)
      .replaceAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu,
        (id) => {
          if (!ids.has(id)) {
            ids.set(id, `<id${ids.size + 1}>`);
          }
          return ids.get(id) ?? id;
        }
      )
      .replaceAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/gu, "<time>")
      .replaceAll(/fx_[\w-]+/gu, "<key>")
  ) as unknown;
};

/** What a call did, as the client and every log table see it. */
const observe = async (db: Db, call: SurfaceCall) => {
  const runId = call.runId ?? "";
  const [log, steps, audit, events] = call.runId
    ? await Promise.all([
        db.query.runs.findFirst({
          where: (t, { eq }) => eq(t.id, runId),
        }),
        db.query.runSteps.findMany({
          where: (t, { eq }) => eq(t.runId, runId),
          orderBy: (t, { asc }) => [
            asc(t.position),
            asc(t.startedAt),
            asc(t.id),
          ],
        }),
        db.query.auditLog.findMany({
          where: (t, { eq }) => eq(t.runId, runId),
        }),
        db.query.eventLog.findMany({
          where: (t, { eq }) => eq(t.runId, runId),
        }),
      ])
    : [null, [], [], []];
  return normalise({
    ok: call.ok,
    body: call.body,
    run: log && {
      endpoint: log.endpoint,
      actorId: log.actorId,
      originUserId: log.originUserId,
      input: log.input,
      output: log.output,
      error: log.error,
      status: log.status,
      dryRun: log.dryRun,
    },
    steps: steps.map(({ stepId, kind, name, input, output, error }) => ({
      stepId,
      kind,
      name,
      input,
      output,
      error,
    })),
    audit: audit.map(({ object, before, after }) => ({
      object,
      before,
      after,
    })),
    events: events.map(({ type, payload }) => ({ type, payload })),
  });
};

/**
 * A refused input that every surface can carry: an id that isn't one where
 * the endpoint's path has an id, a bad page size for a list, else `{}`.
 */
const invalidFor = (definition: AnyDefinition) => {
  const job = definition.objectPermission?.job;
  if (job === undefined || job === "create") {
    return {};
  }
  return job === "list" ? { limit: 0 } : { id: "not-a-uuid" };
};

/* oxlint-disable eslint/no-await-in-loop -- calls run one after another, so
   each surface sees the database as the one before left it. */
/** Runs every action on every surface and reports any difference. */
export const runContract = async ({
  registry,
  objects,
  pipeline,
  db,
  caller,
  surfaces,
  samples = {},
  choices,
}: ContractOptions): Promise<ContractProblem[]> => {
  const byName = new Map(objects.map((object) => [object.name, object]));

  /** Creates a record directly through the pipeline; returns its id. */
  const createRecord = async (objectName: string): Promise<string> => {
    const create = registry.get(`${objectName}_create`);
    const object = byName.get(objectName);
    if (!create || create.kind === "query" || !object) {
      throw new Error(`Can't make a ${objectName} to refer to`);
    }
    // oxlint-disable-next-line eslint/no-use-before-define -- mutual recursion: a ref's target is made from its own fields.
    const fields = await fieldsOf(object, 1);
    const result = await pipeline.run(create, fields, caller);
    if (!result.ok) {
      throw new Error(`${objectName}.create: ${JSON.stringify(result.error)}`);
    }
    return (result.output as { record: { id: string } }).record.id;
  };

  const refTo = (target: string) =>
    target === "actor" ? Promise.resolve(caller.actorId) : createRecord(target);

  const fieldsOf = async (
    object: AnyObjectDefinition,
    variant: number,
    skip: readonly string[] = []
  ) => {
    const entries = Object.entries(object.fields).filter(
      ([key, field]) =>
        !(skip.includes(key) || isComputedField(field as AnyField))
    );
    const values = await Promise.all(
      entries.map(([, field]) =>
        sampleValue(field as AnyField, variant, refTo, choices)
      )
    );
    return Object.fromEntries(
      entries.map(([key], index) => [key, values[index]])
    );
  };

  const sampleFor = (definition: AnyDefinition) => {
    if (samples[definition.name]) {
      return samples[definition.name];
    }
    const needed = definition.objectPermission;
    const object = needed && byName.get(needed.object);
    if (!(needed && object)) {
      return null;
    }
    switch (needed.job) {
      case "create": {
        return () => fieldsOf(object, 1);
      }
      case "update": {
        return async () => ({
          id: await createRecord(object.name),
          ...(await fieldsOf(object, 2)),
        });
      }
      case "list": {
        return () => Promise.resolve({ limit: 5 });
      }
      default: {
        // get, history, archive and restore: one record by id.
        return async () => ({ id: await createRecord(object.name) });
      }
    }
  };

  const problems: ContractProblem[] = [];
  const entries = Object.entries(surfaces);
  const definitions = [
    ...registry.actions(),
    // The generated queries: each is an object endpoint.
    ...registry.queries().filter((query) => query.objectPermission),
  ];
  for (const action of definitions) {
    const sample = sampleFor(action);
    if (!sample) {
      problems.push({
        action: action.name,
        case: "sample",
        problem: "no sample input; add one to `samples`",
      });
      continue;
    }
    const invalid = invalidFor(action);
    const cases = { sample, invalid: () => Promise.resolve(invalid) };
    for (const [name, makeInput] of Object.entries(cases)) {
      const seen: [string, string][] = [];
      for (const [surface, call] of entries) {
        const input = await makeInput();
        seen.push([
          surface,
          JSON.stringify(await observe(db, await call(action, input))),
        ]);
      }
      const [reference, ...others] = seen;
      for (const [surface, observed] of others) {
        if (reference && observed !== reference[1]) {
          problems.push({
            action: action.name,
            case: name as ContractProblem["case"],
            problem: `${surface} differs from ${reference[0]}:\n  ${reference[0]}: ${reference[1]}\n  ${surface}: ${observed}`,
          });
        }
      }
    }
  }
  return problems;
};
/* oxlint-enable eslint/no-await-in-loop */

/**
 * Samples for the identity actions every system has, run as `caller`, who
 * must be a staff actor allowed to run them.
 */
export const identitySamples = (
  registry: Registry,
  pipeline: Pipeline,
  caller: Caller
): Record<string, () => Promise<unknown>> => {
  const setUp = async (name: string, input: unknown) => {
    const action = registry.get(name);
    const result =
      action && action.kind !== "query"
        ? await pipeline.run(action, input, caller)
        : null;
    if (!result?.ok) {
      throw new Error(`${name} failed in setup: ${JSON.stringify(result)}`);
    }
    return result.output as Record<string, string>;
  };
  const agentKey = async () => {
    const { actorId } = await setUp("actor.createAgent", { name: "Helper" });
    return { actorId, label: "contract" };
  };
  const agent = async () => {
    const { actorId } = await setUp("actor.createAgent", { name: "Helper" });
    return actorId;
  };
  return {
    // A uuid in the email keeps each one new, and normalises away.
    "user.invite": () =>
      Promise.resolve({
        name: "Invited",
        email: `${randomUUID()}@example.com`,
        roles: [],
      }),
    "actor.setRoles": async () => ({ id: await agent(), roles: [] }),
    "actor.disable": async () => ({ id: await agent() }),
    "actor.enable": async () => {
      const id = await agent();
      await setUp("actor.disable", { id });
      return { id };
    },
    "actor.createAgent": () => Promise.resolve({ name: "Agent" }),
    "actor.createIntegration": () =>
      Promise.resolve({ name: "Integration", roles: [] }),
    "apiKey.create": agentKey,
    "apiKey.revoke": async () => {
      const key = await setUp("apiKey.create", await agentKey());
      return { id: key.id };
    },
  };
};

/**
 * Samples for the draft and approval actions a system with config has (P2.08,
 * P2.09). Without a config remote each draft action is refused the same way
 * on every surface, and there is no approval with the sample id.
 */
export const configSamples = (): Record<string, () => Promise<unknown>> => {
  const id = "00000000-0000-7000-8000-00000000d4af";
  return {
    "approval.approve": () => Promise.resolve({ id }),
    "approval.reject": () => Promise.resolve({ id, comment: "Not now" }),
    "approval.withdraw": () => Promise.resolve({ subjectId: id }),
    "draft.open": () => Promise.resolve({ title: "Sample draft" }),
    "draft.save": () =>
      Promise.resolve({
        id,
        path: "config/roles/sample.yaml",
        content: "key: sample\n",
      }),
    "draft.revert": () =>
      Promise.resolve({ id, path: "config/roles/sample.yaml" }),
    "draft.discard": () => Promise.resolve({ id }),
    "draft.publish": () => Promise.resolve({ id }),
  };
};

/** A way to call a workflow endpoint (P2.18): HTTP or MCP. */
export type WorkflowSurface = (
  key: string,
  input: unknown
) => Promise<SurfaceCall>;

/** `POST /workflows/<key>`. */
export const workflowHttpSurface =
  (request: Fetch): WorkflowSurface =>
  async (key, input) =>
    callOf(
      await request(`/workflows/${key}`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    );

/** The MCP tool named as the workflow. */
export const workflowMcpSurface =
  (request: Fetch): WorkflowSurface =>
  (key, input) =>
    mcpCall(request, key, input);

/** One call to make on every surface; `input` runs once per surface. */
export interface WorkflowCase {
  name: string;
  key: string;
  input: () => unknown;
}

/* oxlint-disable eslint/no-await-in-loop -- one surface after another, so
   each sees the database as the last left it. */
/**
 * Calls each workflow case on every surface and reports any difference in
 * the result or the rows the run wrote: the run, its steps, history and
 * events.
 */
export const runWorkflowContract = async ({
  db,
  surfaces,
  cases,
}: {
  db: Db;
  surfaces: Record<string, WorkflowSurface>;
  cases: readonly WorkflowCase[];
}): Promise<ContractProblem[]> => {
  const problems: ContractProblem[] = [];
  for (const { name, key, input } of cases) {
    const seen: [string, string][] = [];
    for (const [surface, call] of Object.entries(surfaces)) {
      seen.push([
        surface,
        JSON.stringify(await observe(db, await call(key, await input()))),
      ]);
    }
    const [reference, ...others] = seen;
    for (const [surface, observed] of others) {
      if (reference && observed !== reference[1]) {
        problems.push({
          action: `${key} (${name})`,
          case: "sample",
          problem: `${surface} differs from ${reference[0]}:\n  ${reference[0]}: ${reference[1]}\n  ${surface}: ${observed}`,
        });
      }
    }
  }
  return problems;
};
/* oxlint-enable eslint/no-await-in-loop */
