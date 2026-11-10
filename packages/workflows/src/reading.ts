// Reading workflows for the editor and for agents. Live definitions come
// from the config the call pinned. A draft or a past commit is read through
// the config remote; without one, those inputs are refused with the message
// the draft actions already give. A file's revision is its git blob id.
import { isActionFailure } from "@workspace/actions";
import type {
  ActionError,
  ActionFailure,
  ConfigService,
  GitService,
  WorkflowEntry,
} from "@workspace/actions";
import {
  choiceListSchema,
  parseYaml,
  stringifyYaml,
  yamlWithValue,
} from "@workspace/config";
import type { ConfigCatalog } from "@workspace/config";
import type { DraftEntry } from "@workspace/objects";
import { LineCounter, parseDocument } from "yaml";
import type { Document } from "yaml";
import { z } from "zod";

import { definitionOf } from "./entries.ts";
import { labelFromKey } from "./fields.ts";
import { workflowSchema } from "./schema.ts";
import type { WorkflowDefinition } from "./schema.ts";
import { allSteps, validateWorkflow } from "./validate.ts";
import type { WorkflowCheck, WorkflowContext } from "./validate.ts";

const noConfigRemote =
  "Drafts need a config remote. This system reads config/ from its working tree, so edit the files there.";

const workflowPath = (key: string) => `config/workflows/${key}.yaml`;

const workflowFile =
  /^config\/workflows\/(?<key>[a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.yaml$/u;

const choiceFile =
  /^config\/choices\/(?<key>[a-z][a-z0-9]*(?:_[a-z0-9]+)*)\.yaml$/u;

const actorTrailer = /^Actor-Id:\s*(?<id>\S+)\s*$/mu;

const problemSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});

const checkSchema = z.object({
  problems: z.array(problemSchema),
  warnings: z.array(problemSchema),
  segments: z.array(
    z.object({
      steps: z.array(z.string()),
      queued: z.array(z.string()),
      ends: z
        .object({
          step: z.string(),
          why: z.string(),
          conditional: z.boolean(),
        })
        .nullable(),
    })
  ),
  scopes: z.json(),
});

const changeSchema = z.enum(["added", "changed", "removed"]).nullable();

const listItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  source: z.enum(["code", "config"]),
  path: z.string().nullable(),
  starts_when: z.json().nullable(),
  read_only: z.boolean(),
  emits: z.array(z.string()),
  runs: z.array(z.string()),
  problems: z.number().int(),
  warnings: z.number().int(),
  change: changeSchema,
});

export const workflowListOutput = z.object({
  workflows: z.array(listItemSchema),
});

const savedBySchema = z.object({
  id: z.uuid().nullable(),
  name: z.string(),
});

export const workflowGetOutput = z.object({
  definition: z.json().nullable(),
  content: z.string(),
  revision: z.string().nullable(),
  source: z.enum(["code", "config"]),
  editable: z.boolean(),
  why: z.enum(["code", "no_config_remote", "past_version"]).nullable(),
  at: z.object({
    kind: z.enum(["live", "draft", "version"]),
    sha: z.string().nullable(),
    saved_by: savedBySchema.nullable(),
    saved_at: z.string().nullable(),
  }),
  live_revision: z.string().nullable(),
  behind: z.boolean(),
  check: checkSchema,
});

const linedProblemSchema = problemSchema.extend({
  /** The line of the file the problem is on, when it can be found. */
  line: z.number().int().nullable(),
});

export const workflowValidateOutput = z.object({
  /** The definition as a value. Null when the YAML can't be read. */
  value: z.json().nullable(),
  /** The YAML a save of this would write. */
  content: z.string(),
  check: checkSchema.extend({
    problems: z.array(linedProblemSchema),
    warnings: z.array(linedProblemSchema),
  }),
});

type Failure = ActionFailure<ActionError>;
type Change = z.infer<typeof changeSchema>;
type ListItem = z.infer<typeof listItemSchema>;

export interface WorkflowReadContext {
  readonly config: ConfigService;
  readonly git: GitService | undefined;
  readonly draft: (id: string) => Promise<DraftEntry | null>;
  readonly actor: (id: string) => Promise<{ id: string; name: string } | null>;
  readonly invalid: (message: string) => Failure;
  readonly notFound: (object: string, id: string) => Failure;
}

interface PlaceLive {
  readonly kind: "live";
}
interface PlaceDraft {
  readonly kind: "draft";
  readonly draft: DraftEntry;
  readonly sha: string;
}
interface PlaceVersion {
  readonly kind: "version";
  readonly sha: string;
}
type Place = PlaceLive | PlaceDraft | PlaceVersion;

interface Held {
  readonly key: string;
  readonly content: string;
  readonly definition: WorkflowDefinition | null;
  readonly error: string | null;
}

const isFailure = (value: Place | Failure): value is Failure =>
  isActionFailure(value);

const isCatalog = (value: unknown): value is ConfigCatalog =>
  typeof value === "object" &&
  value !== null &&
  "objects" in value &&
  value.objects instanceof Map &&
  "events" in value &&
  value.events instanceof Set &&
  "owners" in value &&
  value.owners instanceof Set &&
  "choiceLists" in value &&
  Array.isArray(value.choiceLists);

const catalogOf = (config: ConfigService): ConfigCatalog => {
  if (!isCatalog(config.catalog)) {
    throw new Error(
      "This run's config has no catalog, so a workflow can't be checked."
    );
  }
  return config.catalog;
};

const jsonValue = (value: unknown) => z.json().parse(structuredClone(value));

const plainCheck = (check: WorkflowCheck) => ({
  problems: check.problems.map((problem) => ({
    path: [...problem.path],
    message: problem.message,
  })),
  warnings: check.warnings.map((problem) => ({
    path: [...problem.path],
    message: problem.message,
  })),
  segments: check.segments.map((segment) => ({
    steps: [...segment.steps],
    queued: [...segment.queued],
    ends: segment.ends
      ? {
          step: segment.ends.step,
          why: segment.ends.why,
          conditional: segment.ends.conditional,
        }
      : null,
  })),
  scopes: jsonValue(check.scopes),
});

const addName = (names: string[], seen: Set<string>, name: string) => {
  if (seen.has(name)) {
    return;
  }
  seen.add(name);
  names.push(name);
};

const emitsOf = (workflow: WorkflowDefinition) => {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of Object.keys(workflow.events ?? {})) {
    addName(names, seen, name);
  }
  for (const [step] of allSteps(workflow)) {
    if ("emit" in step) {
      addName(names, seen, step.emit);
    }
  }
  return names;
};

const runsOf = (workflow: WorkflowDefinition) => {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const [step] of allSteps(workflow)) {
    if ("run" in step) {
      addName(names, seen, step.run);
    }
  }
  return names;
};

const choiceListsIn = (workflows: Iterable<WorkflowDefinition>) => {
  const lists = new Set<string>();
  const visit = (specs: WorkflowDefinition["input"]) => {
    for (const spec of Object.values(specs ?? {})) {
      if (spec.type === "choice") {
        lists.add(spec.list);
      }
    }
  };
  for (const workflow of workflows) {
    visit(workflow.input);
    for (const payload of Object.values(workflow.events ?? {})) {
      visit(payload);
    }
  }
  return lists;
};

const choiceKeysFromConfig = (
  config: ConfigService,
  workflows: Iterable<WorkflowDefinition>
) => {
  const keys = new Map<string, readonly string[]>();
  for (const list of choiceListsIn(workflows)) {
    const options = config.choices?.(list);
    if (options) {
      keys.set(
        list,
        options.map((option) => option.key)
      );
    }
  }
  return keys;
};

const choiceKeysFromFiles = (
  files: readonly { path: string; content: string }[]
) => {
  const keys = new Map<string, readonly string[]>();
  for (const file of files) {
    if (!choiceFile.test(file.path)) {
      continue;
    }
    let value: unknown;
    try {
      value = parseYaml(file.content);
    } catch {
      continue;
    }
    const parsed = choiceListSchema.safeParse(value);
    if (parsed.success) {
      keys.set(
        parsed.data.key,
        parsed.data.options.map((option) => option.key)
      );
    }
  }
  return keys;
};

const parseWorkflow = (
  content: string
): { definition: WorkflowDefinition } | { error: string } => {
  let value: unknown;
  try {
    value = parseYaml(content);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "The YAML isn't valid.",
    };
  }
  const parsed = workflowSchema.safeParse(value);
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  return { definition: parsed.data as WorkflowDefinition };
};

const heldFrom = (path: string, content: string): Held | null => {
  const key = workflowFile.exec(path)?.groups?.key;
  if (!key) {
    return null;
  }
  const parsed = parseWorkflow(content);
  if ("error" in parsed) {
    return { key, content, definition: null, error: parsed.error };
  }
  if (parsed.definition.key !== key) {
    return {
      key,
      content,
      definition: null,
      error: `The file is ${workflowPath(key)}, but its key is ${parsed.definition.key}.`,
    };
  }
  return { key, content, definition: parsed.definition, error: null };
};

const filesAt = async (git: GitService, ref: string) => {
  try {
    return await git.files(ref);
  } catch {
    return null;
  }
};

const snapshotAt = async (git: GitService, ref: string) => {
  const files = await filesAt(git, ref);
  if (!files) {
    return null;
  }
  const workflows = new Map<string, Held>();
  for (const file of files) {
    const held = heldFrom(file.path, file.content);
    if (held) {
      workflows.set(held.key, held);
    }
  }
  return { workflows, choiceKeys: choiceKeysFromFiles(files) };
};

const codeKeysOf = (catalog: ConfigCatalog) =>
  new Set(catalog.workflows?.keys());

const byKey = (
  entries: readonly WorkflowEntry[],
  code: ReadonlySet<string>,
  wantCode: boolean
) => {
  const workflows = new Map<string, WorkflowDefinition>();
  for (const entry of entries) {
    if (code.has(entry.key) === wantCode) {
      workflows.set(entry.key, definitionOf(entry));
    }
  }
  return workflows;
};

const contextFor = (
  catalog: ConfigCatalog,
  workflows: ReadonlyMap<string, WorkflowDefinition>,
  choiceKeys: ReadonlyMap<string, readonly string[]>,
  choices: ConfigService["choices"]
): WorkflowContext => ({
  catalog,
  workflows,
  choiceKeys,
  ...(choices ? { choices } : {}),
});

const headOf = async (git: GitService, branch: string) => {
  try {
    return await git.head(branch);
  } catch {
    return null;
  }
};

const resolvePlace = async (
  ctx: WorkflowReadContext,
  input: { draft_id?: string | undefined; sha?: string | undefined }
): Promise<Place | Failure> => {
  if (input.draft_id !== undefined && input.sha !== undefined) {
    return ctx.invalid("Give a draft_id or a sha, not both.");
  }
  if (input.draft_id === undefined && input.sha === undefined) {
    return { kind: "live" };
  }
  if (!ctx.git) {
    return ctx.invalid(noConfigRemote);
  }
  if (input.sha !== undefined) {
    const commit = await ctx.git.show(input.sha);
    if (!commit) {
      return ctx.notFound("commit", input.sha);
    }
    return { kind: "version", sha: commit.sha };
  }
  const id = input.draft_id ?? "";
  const draft = await ctx.draft(id);
  if (!draft) {
    return ctx.notFound("draft", id);
  }
  const sha = draft.publishedSha ?? (await headOf(ctx.git, draft.branch));
  if (!sha) {
    return ctx.notFound("draft", draft.id);
  }
  return { kind: "draft", draft, sha };
};

const itemOf = (
  workflow: WorkflowDefinition,
  source: "code" | "config",
  change: Change,
  context: WorkflowContext
): ListItem => {
  const check = validateWorkflow(workflow, context);
  return {
    key: workflow.key,
    label: workflow.label ?? labelFromKey(workflow.key),
    description: workflow.description,
    source,
    path: source === "code" ? null : workflowPath(workflow.key),
    starts_when: workflow.starts_when,
    read_only: workflow.read_only === true,
    emits: emitsOf(workflow),
    runs: runsOf(workflow),
    problems: check.problems.length,
    warnings: check.warnings.length,
    change,
  };
};

const brokenItem = (held: Held, change: Change): ListItem => ({
  key: held.key,
  label: labelFromKey(held.key),
  description: held.error ?? "This file isn't a valid workflow.",
  source: "config",
  path: workflowPath(held.key),
  starts_when: null,
  read_only: false,
  emits: [],
  runs: [],
  problems: 1,
  warnings: 0,
  change,
});

const sorted = (items: ListItem[]) =>
  items.toSorted((a, b) => a.key.localeCompare(b.key));

interface Loaded {
  readonly catalog: ConfigCatalog;
  readonly code: ReadonlySet<string>;
  readonly coded: Map<string, WorkflowDefinition>;
  readonly live: Map<string, WorkflowDefinition>;
}

const load = (ctx: WorkflowReadContext): Loaded => {
  const catalog = catalogOf(ctx.config);
  const entries = ctx.config.workflows ?? [];
  const code = codeKeysOf(catalog);
  return {
    catalog,
    code,
    coded: byKey(entries, code, true),
    live: byKey(entries, code, false),
  };
};

const liveContext = (ctx: WorkflowReadContext, loaded: Loaded) => {
  const workflows = new Map([...loaded.coded, ...loaded.live]);
  return contextFor(
    loaded.catalog,
    workflows,
    choiceKeysFromConfig(ctx.config, workflows.values()),
    ctx.config.choices
  );
};

const changeBetween = (
  previous: WorkflowDefinition | undefined,
  liveContent: string | undefined,
  draftContent: string
): Change => {
  if (previous === undefined) {
    return "added";
  }
  return liveContent === draftContent ? null : "changed";
};

const listAt = async (
  ctx: WorkflowReadContext,
  place: PlaceDraft | PlaceVersion,
  loaded: Loaded
): Promise<z.output<typeof workflowListOutput> | Failure> => {
  const { git } = ctx;
  if (!git) {
    return ctx.invalid(noConfigRemote);
  }
  const snap = await snapshotAt(git, place.sha);
  if (!snap) {
    return ctx.notFound(place.kind === "draft" ? "draft" : "commit", place.sha);
  }
  const liveSnap =
    ctx.config.sha === null ? null : await snapshotAt(git, ctx.config.sha);
  const drafted = new Map<string, WorkflowDefinition>();
  for (const [key, held] of snap.workflows) {
    if (held.definition && !loaded.code.has(key)) {
      drafted.set(key, held.definition);
    }
  }
  const context = contextFor(
    loaded.catalog,
    new Map([...loaded.coded, ...drafted]),
    snap.choiceKeys,
    ctx.config.choices
  );
  const current = liveContext(ctx, loaded);
  const items: ListItem[] = [...loaded.coded.values()].map((workflow) =>
    itemOf(workflow, "code", null, context)
  );
  for (const [key, held] of snap.workflows) {
    if (loaded.code.has(key)) {
      continue;
    }
    const previous = loaded.live.get(key);
    const liveContent =
      liveSnap?.workflows.get(key)?.content ??
      (previous ? stringifyYaml(previous) : undefined);
    const change = changeBetween(previous, liveContent, held.content);
    items.push(
      held.definition
        ? itemOf(held.definition, "config", change, context)
        : brokenItem(held, change)
    );
  }
  for (const [key, workflow] of loaded.live) {
    if (!snap.workflows.has(key)) {
      items.push(itemOf(workflow, "config", "removed", current));
    }
  }
  return { workflows: sorted(items) };
};

export const listWorkflows = async (
  ctx: WorkflowReadContext,
  input: { draft_id?: string | undefined }
): Promise<z.output<typeof workflowListOutput> | Failure> => {
  const place = await resolvePlace(ctx, input);
  if (isFailure(place)) {
    return place;
  }
  const loaded = load(ctx);
  if (place.kind === "live") {
    const context = liveContext(ctx, loaded);
    return {
      workflows: sorted([
        ...[...loaded.coded.values()].map((workflow) =>
          itemOf(workflow, "code", null, context)
        ),
        ...[...loaded.live.values()].map((workflow) =>
          itemOf(workflow, "config", null, context)
        ),
      ]),
    };
  }
  return listAt(ctx, place, loaded);
};

const editability = (
  source: "code" | "config",
  kind: Place["kind"],
  git: boolean
) => {
  if (source === "code") {
    return { editable: false, why: "code" as const };
  }
  if (kind === "version") {
    return { editable: false, why: "past_version" as const };
  }
  if (!git) {
    return { editable: false, why: "no_config_remote" as const };
  }
  return { editable: true, why: null };
};

const blobOf = (
  git: GitService | undefined,
  sha: string | null,
  key: string
): Promise<string | null> =>
  git && sha ? git.blob(sha, workflowPath(key)) : Promise.resolve(null);

const savedBy = async (
  ctx: WorkflowReadContext,
  sha: string
): Promise<{
  saved_by: z.infer<typeof savedBySchema> | null;
  saved_at: string | null;
}> => {
  const commit = await ctx.git?.show(sha);
  if (!commit) {
    return { saved_by: null, saved_at: null };
  }
  const found = actorTrailer.exec(commit.message)?.groups?.id;
  const id = found && z.uuid().safeParse(found).success ? found : null;
  const known = id ? await ctx.actor(id) : null;
  return {
    saved_by: { id: known?.id ?? id, name: known?.name ?? commit.author.name },
    saved_at: commit.at,
  };
};

const viewOf = async (
  ctx: WorkflowReadContext,
  place: Place,
  source: "code" | "config",
  workflow: WorkflowDefinition,
  content: string,
  context: WorkflowContext
) => {
  const readSha = place.kind === "live" ? ctx.config.sha : place.sha;
  const revision =
    source === "code" ? null : await blobOf(ctx.git, readSha, workflow.key);
  const liveRevision =
    source === "code"
      ? null
      : await blobOf(ctx.git, ctx.config.sha, workflow.key);
  const behind =
    place.kind === "draft" && source === "config"
      ? (await blobOf(ctx.git, place.draft.baseSha, workflow.key)) !==
        liveRevision
      : false;
  const saved =
    place.kind === "draft"
      ? await savedBy(ctx, place.sha)
      : { saved_by: null, saved_at: null };
  return {
    definition: jsonValue(workflow),
    content,
    revision,
    source,
    ...editability(source, place.kind, ctx.git !== undefined),
    at: {
      kind: place.kind,
      sha: readSha,
      saved_by: saved.saved_by,
      saved_at: saved.saved_at,
    },
    live_revision: liveRevision,
    behind,
    check: plainCheck(validateWorkflow(workflow, context)),
  };
};

const brokenView = async (
  ctx: WorkflowReadContext,
  place: PlaceDraft | PlaceVersion,
  held: Held
) => {
  const readSha = place.sha;
  const saved =
    place.kind === "draft"
      ? await savedBy(ctx, place.sha)
      : { saved_by: null, saved_at: null };
  const liveRevision = await blobOf(ctx.git, ctx.config.sha, held.key);
  const baseRevision =
    place.kind === "draft"
      ? await blobOf(ctx.git, place.draft.baseSha, held.key)
      : null;
  return {
    definition: null,
    content: held.content,
    revision: await blobOf(ctx.git, readSha, held.key),
    source: "config" as const,
    ...editability("config", place.kind, true),
    at: {
      kind: place.kind,
      sha: readSha,
      saved_by: saved.saved_by,
      saved_at: saved.saved_at,
    },
    live_revision: liveRevision,
    behind: place.kind === "draft" && baseRevision !== liveRevision,
    check: {
      problems: [
        {
          path: [],
          message: held.error ?? "This file isn't a valid workflow.",
        },
      ],
      warnings: [],
      segments: [],
      scopes: {
        steps: {},
        outputs: {},
        input: null,
        event: null,
        eventSchema: null,
      },
    },
  };
};

const getAt = async (
  ctx: WorkflowReadContext,
  place: PlaceDraft | PlaceVersion,
  loaded: Loaded,
  key: string
): Promise<z.output<typeof workflowGetOutput> | Failure> => {
  const { git } = ctx;
  if (!git) {
    return ctx.invalid(noConfigRemote);
  }
  const snap = await snapshotAt(git, place.sha);
  if (!snap) {
    return ctx.notFound(place.kind === "draft" ? "draft" : "commit", place.sha);
  }
  const drafted = new Map<string, WorkflowDefinition>();
  for (const [name, held] of snap.workflows) {
    if (held.definition && !loaded.code.has(name)) {
      drafted.set(name, held.definition);
    }
  }
  const context = contextFor(
    loaded.catalog,
    new Map([...loaded.coded, ...drafted]),
    snap.choiceKeys,
    ctx.config.choices
  );
  const codeWorkflow = loaded.coded.get(key);
  if (codeWorkflow) {
    return viewOf(
      ctx,
      place,
      "code",
      codeWorkflow,
      stringifyYaml(codeWorkflow),
      context
    );
  }
  const held = snap.workflows.get(key);
  if (!held) {
    return ctx.notFound("workflow", key);
  }
  if (!held.definition) {
    return brokenView(ctx, place, held);
  }
  return viewOf(ctx, place, "config", held.definition, held.content, context);
};

export const getWorkflow = async (
  ctx: WorkflowReadContext,
  input: {
    key: string;
    draft_id?: string | undefined;
    sha?: string | undefined;
  }
): Promise<z.output<typeof workflowGetOutput> | Failure> => {
  const place = await resolvePlace(ctx, input);
  if (isFailure(place)) {
    return place;
  }
  const loaded = load(ctx);
  if (place.kind !== "live") {
    return getAt(ctx, place, loaded, input.key);
  }
  const context = liveContext(ctx, loaded);
  const codeWorkflow = loaded.coded.get(input.key);
  if (codeWorkflow) {
    return viewOf(
      ctx,
      place,
      "code",
      codeWorkflow,
      stringifyYaml(codeWorkflow),
      context
    );
  }
  const workflow = loaded.live.get(input.key);
  if (!workflow) {
    return ctx.notFound("workflow", input.key);
  }
  const snap =
    ctx.git && ctx.config.sha
      ? await snapshotAt(ctx.git, ctx.config.sha)
      : null;
  return viewOf(
    ctx,
    place,
    "config",
    workflow,
    snap?.workflows.get(input.key)?.content ?? stringifyYaml(workflow),
    context
  );
};

// ---------------------------------------------------------------------------
// Checking a workflow that hasn't been saved

type Path = readonly (string | number)[];
type Lined = z.infer<typeof linedProblemSchema>;

const noScopes = {
  steps: {},
  outputs: {},
  input: null,
  event: null,
  eventSchema: null,
};

/** The line of the node at `at`, or of its nearest parent that exists. */
const lineAt = (doc: Document, lines: LineCounter, at: Path): number | null => {
  for (let { length } = at; length >= 0; length -= 1) {
    const node = doc.getIn(at.slice(0, length), true) as
      | { range?: [number, number, number] }
      | undefined;
    if (node?.range) {
      return lines.linePos(node.range[0]).line;
    }
  }
  return null;
};

const unchecked = (
  value: unknown,
  content: string,
  problems: Lined[]
): z.output<typeof workflowValidateOutput> => ({
  value: value === null ? null : jsonValue(value),
  content,
  check: { problems, warnings: [], segments: [], scopes: noScopes },
});

/** The value a caller sent as JSON text: an object, or a message saying why not. */
const valueFromJson = (
  text: string
): { value: Record<string, unknown> } | { error: string } => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      error: `value isn't JSON: ${error instanceof Error ? error.message : "it can't be read"}`,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "value must be a JSON object: the workflow's definition." };
  }
  return { value: { ...value } };
};

/** The other workflows and choice lists to check against, and the file as it is. */
const surroundings = async (
  ctx: WorkflowReadContext,
  place: PlaceLive | PlaceDraft,
  loaded: Loaded,
  key: string
) => {
  const ref = place.kind === "draft" ? place.sha : ctx.config.sha;
  const snap = ctx.git && ref ? await snapshotAt(ctx.git, ref) : null;
  const existing = snap?.workflows.get(key)?.content ?? null;
  if (place.kind === "live" || !snap) {
    const workflows = new Map([...loaded.coded, ...loaded.live]);
    return {
      existing,
      workflows,
      choiceKeys: choiceKeysFromConfig(ctx.config, workflows.values()),
    };
  }
  const workflows = new Map(loaded.coded);
  for (const [name, held] of snap.workflows) {
    if (held.definition && !loaded.code.has(name)) {
      workflows.set(name, held.definition);
    }
  }
  return { existing, workflows, choiceKeys: snap.choiceKeys };
};

/** The YAML to check: what was sent, or the value laid over the file. */
const contentFor = (
  input: { value?: string | undefined; content?: string | undefined },
  existing: string | null
): { content: string } | { error: string } => {
  if (input.content !== undefined) {
    return { content: input.content };
  }
  const parsed = valueFromJson(input.value ?? "");
  if ("error" in parsed) {
    return parsed;
  }
  return {
    content:
      existing === null
        ? stringifyYaml(parsed.value)
        : yamlWithValue(existing, parsed.value),
  };
};

/**
 * Check a workflow without saving it: the problems a save would give,
 * against the draft's other files or the live ones, with the value and the
 * YAML each way.
 */
export const checkUnsavedWorkflow = async (
  ctx: WorkflowReadContext,
  input: {
    key: string;
    value?: string | undefined;
    content?: string | undefined;
    draft_id?: string | undefined;
  }
): Promise<z.output<typeof workflowValidateOutput> | Failure> => {
  if ((input.value === undefined) === (input.content === undefined)) {
    return ctx.invalid(
      "Give value (the definition as JSON) or content (its YAML), and not both."
    );
  }
  const place = await resolvePlace(ctx, { draft_id: input.draft_id });
  if (isFailure(place)) {
    return place;
  }
  if (place.kind === "version") {
    return ctx.invalid("A past version can't be checked against.");
  }
  const loaded = load(ctx);
  if (loaded.coded.has(input.key)) {
    return ctx.invalid(
      `${input.key} is written in code and shipped with a release, so it can't be changed here.`
    );
  }
  const around = await surroundings(ctx, place, loaded, input.key);
  const made = contentFor(input, around.existing);
  if ("error" in made) {
    return ctx.invalid(made.error);
  }
  const { content } = made;
  const lines = new LineCounter();
  const doc = parseDocument(content, { lineCounter: lines });
  if (doc.errors.length > 0) {
    return unchecked(
      null,
      content,
      doc.errors.map((error) => ({
        path: [],
        line: error.linePos?.[0].line ?? null,
        message: error.message,
      }))
    );
  }
  const raw: unknown = doc.toJS();
  const lined = (problem: { path: Path; message: string }): Lined => ({
    path: [...problem.path],
    line: lineAt(doc, lines, problem.path),
    message: problem.message,
  });
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success) {
    return unchecked(
      raw ?? null,
      content,
      parsed.error.issues.map((issue) =>
        lined({
          path: issue.path.map((part) =>
            typeof part === "number" ? part : String(part)
          ),
          message: issue.message,
        })
      )
    );
  }
  const definition = parsed.data as WorkflowDefinition;
  if (definition.key !== input.key) {
    return unchecked(raw, content, [
      lined({
        path: ["key"],
        message: `The file is ${workflowPath(input.key)}, but its key is ${definition.key}.`,
      }),
    ]);
  }
  const check = plainCheck(
    validateWorkflow(
      definition,
      contextFor(
        loaded.catalog,
        new Map([...around.workflows, [input.key, definition]]),
        around.choiceKeys,
        ctx.config.choices
      )
    )
  );
  return {
    value: jsonValue(definition),
    content,
    check: {
      ...check,
      problems: check.problems.map(lined),
      warnings: check.warnings.map(lined),
    },
  };
};
