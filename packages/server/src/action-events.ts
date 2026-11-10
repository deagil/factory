// What `action_list` and `event_list` return. The actions are the ones
// workflow steps run. The events are the catalog's, joined with the events
// workflows declare and the workflows each one starts.
import { describeAction, jsonSchemaOf } from "@workspace/actions";
import type {
  AnyActionDefinition,
  AnyDefinition,
  GitService,
  WorkflowEntry,
} from "@workspace/actions";
import { noRemote } from "@workspace/config";
import type { AnyObjectDefinition } from "@workspace/objects";
import { workflowSchema } from "@workspace/workflows";
import type { FieldSpecs, WorkflowDefinition } from "@workspace/workflows";
import { parse } from "yaml";
import type { z } from "zod";

const recordJobs = ["get", "list", "create", "update", "archive", "restore"];

const generatedSuffixes = new Set([
  "created",
  "updated",
  "archived",
  "restored",
]);

const workflowPath =
  /^config\/workflows\/(?<key>[a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.yaml$/u;

const byText = (left: string, right: string) => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

/** The object a generated record action is for, such as `deal_update`. */
export const objectOfRecordAction = (
  name: string,
  objects: readonly { readonly name: string }[]
) => {
  for (const object of objects) {
    if (recordJobs.some((job) => name === `${object.name}_${job}`)) {
      return object.name;
    }
  }
};

/** `<object>_updated` and the other three generated events, or undefined. */
const objectOfEvent = (type: string, objects: ReadonlySet<string>) => {
  const split = type.lastIndexOf("_");
  if (split <= 0) {
    return;
  }
  const object = type.slice(0, split);
  const suffix = type.slice(split + 1);
  return generatedSuffixes.has(suffix) && objects.has(object)
    ? object
    : undefined;
};

const plainFields = (specs: FieldSpecs) => {
  const fields: Record<string, Record<string, unknown>> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const row: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(spec)) {
      row[name] = value;
    }
    fields[key] = row;
  }
  return fields;
};

const schemaRecord = (schema: z.ZodType) => {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(jsonSchemaOf(schema))) {
    record[key] = value;
  }
  return record;
};

export interface ListedAction {
  readonly name: string;
  readonly description: string;
  readonly kind: "internal" | "external";
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly errors: Record<string, string>;
  readonly emits: string[];
  readonly read_only?: true;
  readonly fixed_inputs?: string[];
  readonly object?: string;
}

/** Every step action, in name order, in the shape `action_list` returns. */
export const listStepActions = (
  steps: ReadonlyMap<string, AnyActionDefinition>,
  objects: readonly AnyObjectDefinition[]
): ListedAction[] =>
  [...steps.values()]
    .map((action) => {
      const described = describeAction(action);
      const object = objectOfRecordAction(action.name, objects);
      const input: Record<string, unknown> = {};
      const output: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(described.input)) {
        input[key] = value;
      }
      for (const [key, value] of Object.entries(described.output)) {
        output[key] = value;
      }
      return {
        name: described.name,
        description: described.description,
        kind: described.kind,
        input,
        output,
        errors: { ...described.errors },
        emits: [...described.emits],
        ...(described.readOnly ? { read_only: true as const } : {}),
        ...(described.fixedInputs
          ? { fixed_inputs: [...described.fixedInputs] }
          : {}),
        ...(object ? { object } : {}),
      };
    })
    .toSorted((left, right) => byText(left.name, right.name));

export interface ListedEvent {
  readonly type: string;
  readonly payload:
    | {
        readonly kind: "fields";
        readonly fields: Record<string, Record<string, unknown>>;
      }
    | { readonly kind: "schema"; readonly schema: Record<string, unknown> };
  readonly from: {
    readonly kind: "object" | "action" | "workflow";
    readonly name: string;
  };
  readonly workflows: string[];
}

interface Declared {
  readonly workflow: string;
  readonly fields: FieldSpecs;
}

const definitionOf = (key: string, value: unknown): WorkflowDefinition => {
  const parsed = workflowSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`The workflow "${key}" isn't a valid workflow.`);
  }
  return Object.freeze(parsed.data) as WorkflowDefinition;
};

/**
 * The events `workflows` know about. A generated record event comes from
 * its object. Any other catalog event comes from the action that emits it.
 * An event only a workflow declares comes from that workflow. When several
 * workflows declare one event, the first key in order supplies the fields.
 */
export const listEvents = (
  objects: readonly AnyObjectDefinition[],
  definitions: readonly AnyDefinition[],
  steps: ReadonlyMap<string, AnyActionDefinition>,
  workflows: readonly WorkflowDefinition[]
): ListedEvent[] => {
  const objectNames = new Set(objects.map((object) => object.name));
  const payloads = new Map<string, z.ZodType>();
  const emitters = new Map<string, Set<string>>();
  const note = (action: AnyActionDefinition) => {
    for (const [type, payload] of Object.entries(action.emits)) {
      payloads.set(type, payload);
      const names = emitters.get(type) ?? new Set<string>();
      names.add(action.name);
      emitters.set(type, names);
    }
  };
  for (const definition of definitions) {
    if (definition.kind !== "query") {
      note(definition);
    }
  }
  for (const action of steps.values()) {
    note(action);
  }

  const declared = new Map<string, Declared[]>();
  const startedBy = new Map<string, string[]>();
  for (const workflow of workflows) {
    for (const [type, fields] of Object.entries(workflow.events ?? {})) {
      const list = declared.get(type) ?? [];
      list.push({ workflow: workflow.key, fields });
      declared.set(type, list);
    }
    const { starts_when: starts } = workflow;
    if (typeof starts === "object" && "event" in starts) {
      const list = startedBy.get(starts.event) ?? [];
      list.push(workflow.key);
      startedBy.set(starts.event, list);
    }
  }

  const types = new Set([...payloads.keys(), ...declared.keys()]);
  return [...types].toSorted(byText).map((type) => {
    const object = objectOfEvent(type, objectNames);
    const declarations = [...(declared.get(type) ?? [])].toSorted(
      (left, right) => byText(left.workflow, right.workflow)
    );
    const [first] = declarations;
    const schema = payloads.get(type);
    const [action] = [...(emitters.get(type) ?? [])].toSorted(byText);
    let from: ListedEvent["from"];
    if (object) {
      from = { kind: "object", name: object };
    } else if (!schema && first) {
      from = { kind: "workflow", name: first.workflow };
    } else if (action) {
      from = { kind: "action", name: action };
    } else {
      throw new Error(`Event "${type}" has no source.`);
    }
    let payload: ListedEvent["payload"];
    if (schema) {
      payload = { kind: "schema", schema: schemaRecord(schema) };
    } else if (first) {
      payload = { kind: "fields", fields: plainFields(first.fields) };
    } else {
      throw new Error(`Event "${type}" has no payload.`);
    }
    return {
      type,
      payload,
      from,
      workflows: [...(startedBy.get(type) ?? [])].toSorted(byText),
    };
  });
};

const workflowsInFiles = (
  files: readonly { readonly path: string; readonly content: string }[],
  codeKeys: ReadonlySet<string>
):
  | { readonly ok: true; readonly workflows: WorkflowDefinition[] }
  | { readonly ok: false; readonly message: string } => {
  const found: WorkflowDefinition[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const match = workflowPath.exec(file.path);
    const fileKey = match?.groups?.key;
    if (!fileKey) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parse(file.content);
    } catch {
      return { ok: false, message: `${file.path} isn't valid YAML.` };
    }
    const workflow = workflowSchema.safeParse(parsed);
    if (!workflow.success) {
      return { ok: false, message: `${file.path} isn't a valid workflow.` };
    }
    if (workflow.data.key !== fileKey) {
      return {
        ok: false,
        message: `${file.path} is named ${fileKey}, but its key is ${workflow.data.key}.`,
      };
    }
    if (codeKeys.has(workflow.data.key)) {
      continue;
    }
    if (seen.has(workflow.data.key)) {
      return {
        ok: false,
        message: `${workflow.data.key} is declared by two workflow files.`,
      };
    }
    seen.add(workflow.data.key);
    found.push(definitionOf(workflow.data.key, workflow.data));
  }
  return { ok: true, workflows: found };
};

export interface EventListRead {
  readonly config: { readonly workflows?: readonly WorkflowEntry[] };
  readonly git: GitService | undefined;
  readonly dal: {
    readonly draftDetail: (id: string) => Promise<{
      readonly branch: string;
      readonly publishedSha: string | null;
    } | null>;
  };
}

export type EventListResult =
  | { readonly ok: true; readonly events: ListedEvent[] }
  | {
      readonly ok: false;
      readonly code: "validation";
      readonly message: string;
    }
  | { readonly ok: false; readonly code: "not_found"; readonly id: string };

const liveWorkflows = (
  config: EventListRead["config"],
  codeWorkflows: ReadonlyMap<string, WorkflowDefinition>
) => {
  if (!config.workflows) {
    return [...codeWorkflows.values()];
  }
  return config.workflows.map((entry) =>
    definitionOf(entry.key, entry.definition)
  );
};

const draftWorkflows = async (
  ctx: EventListRead,
  draftId: string,
  codeWorkflows: ReadonlyMap<string, WorkflowDefinition>
): Promise<
  | { readonly ok: true; readonly workflows: readonly WorkflowDefinition[] }
  | Extract<EventListResult, { ok: false }>
> => {
  if (!ctx.git) {
    return { ok: false, code: "validation", message: noRemote };
  }
  const draft = await ctx.dal.draftDetail(draftId);
  if (!draft) {
    return { ok: false, code: "not_found", id: draftId };
  }
  let sha = draft.publishedSha;
  if (!sha) {
    try {
      sha = await ctx.git.head(draft.branch);
    } catch {
      return {
        ok: false,
        code: "validation",
        message: "This draft's files can't be read.",
      };
    }
  }
  const parsed = workflowsInFiles(
    await ctx.git.files(sha),
    new Set(codeWorkflows.keys())
  );
  if (!parsed.ok) {
    return { ok: false, code: "validation", message: parsed.message };
  }
  return {
    ok: true,
    workflows: [...codeWorkflows.values(), ...parsed.workflows],
  };
};

/** The events for one call: live config, or a draft's workflow files. */
export const collectEvents = async (
  ctx: EventListRead,
  input: { readonly draft_id?: string | undefined },
  deps: {
    readonly objects: readonly AnyObjectDefinition[];
    readonly definitions: readonly AnyDefinition[];
    readonly steps: ReadonlyMap<string, AnyActionDefinition>;
    readonly codeWorkflows: ReadonlyMap<string, WorkflowDefinition>;
  }
): Promise<EventListResult> => {
  const found = input.draft_id
    ? await draftWorkflows(ctx, input.draft_id, deps.codeWorkflows)
    : {
        ok: true as const,
        workflows: liveWorkflows(ctx.config, deps.codeWorkflows),
      };
  if (!found.ok) {
    return found;
  }
  return {
    ok: true,
    events: listEvents(
      deps.objects,
      deps.definitions,
      deps.steps,
      found.workflows
    ),
  };
};
