// Contract tests across surfaces (P1.17): every action runs through the HTTP
// API and through MCP with the same input, and both must give the same
// result and write the same log rows. A system's tests call `runContract`
// with its registry; any difference is reported.
import { randomUUID } from "node:crypto";

import type {
  AnyActionDefinition,
  Caller,
  Pipeline,
  Registry,
} from "@workspace/actions";
import type { Db } from "@workspace/db";
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
  actionId: string | null;
}

/** A way to call an action: the HTTP API, MCP, or a test's broken copy. */
export type Surface = (
  action: AnyActionDefinition,
  input: unknown
) => Promise<SurfaceCall>;

/** A request to an app such as `createApi`'s. */
type Fetch = (path: string, init: RequestInit) => Response | Promise<Response>;

const headers = {
  authorization: "Bearer contract",
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

export const httpSurface =
  (request: Fetch): Surface =>
  async (action, input) => {
    const response = await request(`/actions/${action.name}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {
      output?: unknown;
      error?: unknown;
      actionId: string | null;
    };
    return response.ok
      ? { ok: true, body: body.output, actionId: body.actionId }
      : { ok: false, body: body.error, actionId: body.actionId };
  };

export const mcpSurface =
  (request: Fetch): Surface =>
  async (action, input) => {
    const response = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: action.name.replace(".", "_"), arguments: input },
      }),
    });
    const { result } = (await response.json()) as {
      result: {
        isError?: boolean;
        structuredContent?: unknown;
        content: { text: string }[];
        _meta?: { actionId?: string };
      };
    };
    const actionId = result._meta?.actionId ?? null;
    if (!result.isError) {
      // MCP adds the action id to an action's output; HTTP has it beside.
      const { actionId: _, ...body } = (result.structuredContent ??
        {}) as Record<string, unknown>;
      return { ok: true, body, actionId };
    }
    const text = result.content[0]?.text ?? "";
    const json = text.slice(text.indexOf("\n") + 1);
    try {
      return {
        ok: false,
        body: (JSON.parse(json) as { error: unknown }).error,
        actionId,
      };
    } catch {
      // Not one of our typed errors: the MCP SDK refused the call itself.
      return { ok: false, body: { sdk: text }, actionId };
    }
  };

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
   * create, update and archive actions get theirs from their fields.
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
    const create = registry.get(`${objectName}.create`);
    const object = byName.get(objectName);
    if (create?.kind !== "action" || !object) {
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
      ([key]) => !skip.includes(key)
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

  const sampleFor = (action: AnyActionDefinition) => {
    if (samples[action.name]) {
      return samples[action.name];
    }
    const needed = action.objectPermission;
    const object = needed && byName.get(needed.object);
    if (!(needed && object)) {
      return null;
    }
    switch (needed.can) {
      case "create": {
        return () => fieldsOf(object, 1);
      }
      case "update": {
        return async () => ({
          id: await createRecord(object.name),
          ...(await fieldsOf(object, 2, object.actions.update.readOnly)),
        });
      }
      case "archive": {
        return async () => ({ id: await createRecord(object.name) });
      }
      default: {
        return null;
      }
    }
  };

  /** What a call did, as the client and every log table see it. */
  const observe = async (call: SurfaceCall) => {
    const actionId = call.actionId ?? "";
    const [log, audit, events] = call.actionId
      ? await Promise.all([
          db.query.actionLog.findFirst({
            where: (t, { eq }) => eq(t.id, actionId),
          }),
          db.query.auditLog.findMany({
            where: (t, { eq }) => eq(t.actionId, actionId),
          }),
          db.query.eventLog.findMany({
            where: (t, { eq }) => eq(t.actionId, actionId),
          }),
        ])
      : [null, [], []];
    return normalise({
      ok: call.ok,
      body: call.body,
      log: log && {
        name: log.name,
        actorId: log.actorId,
        originUserId: log.originUserId,
        input: log.input,
        result: log.result,
        error: log.error,
        status: log.status,
        dryRun: log.dryRun,
      },
      audit: audit.map(({ object, before, after }) => ({
        object,
        before,
        after,
      })),
      events: events.map(({ type, payload }) => ({ type, payload })),
    });
  };

  const problems: ContractProblem[] = [];
  const entries = Object.entries(surfaces);
  for (const action of registry.actions()) {
    const sample = sampleFor(action);
    if (!sample) {
      problems.push({
        action: action.name,
        case: "sample",
        problem: "no sample input; add one to `samples`",
      });
      continue;
    }
    const cases = { sample, invalid: () => Promise.resolve({}) };
    for (const [name, makeInput] of Object.entries(cases)) {
      const seen: [string, string][] = [];
      for (const [surface, call] of entries) {
        const input = await makeInput();
        seen.push([
          surface,
          JSON.stringify(await observe(await call(action, input))),
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
      action?.kind === "action"
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
