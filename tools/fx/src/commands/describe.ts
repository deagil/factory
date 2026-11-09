// fx describe: prints what a system has (objects, actions, queries, events
// and their schemas) without a database, so agents building a system can
// see what exists without reading every file (P1.22).
//
// A system is a workspace package whose package.json names its system file:
// `"factory": { "system": "./src/system.ts" }`. That file's default export
// is the `defineSystem` result.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FxError } from "../errors.ts";
import { findRepo } from "../git.ts";

type JsonSchema = Record<string, unknown>;

/** `system.describe`'s output, as far as fx reads it. */
export interface Description {
  objects: {
    name: string;
    label: string;
    description: string | null;
    fields: {
      key: string;
      label: string;
      type: string;
      required: boolean;
      read: boolean;
      write: boolean;
      target: string | null;
      options:
        | {
            key: string;
            label: string;
            archived: boolean;
          }[]
        | null;
      schema: JsonSchema;
    }[];
  }[];
  actions: Definition[];
  queries: Definition[];
  events: { type: string; payload: JsonSchema }[];
}

interface Definition {
  name: string;
  description: string;
  input: JsonSchema;
  output: JsonSchema;
  emits?: string[];
}

export interface SystemPackage {
  /** The package's folder, relative to the repo. */
  dir: string;
  /** The system file, absolute. */
  file: string;
}

export interface DescribeResult {
  system: string;
  dir: string;
  description: Description;
  /** What `name` matched, when one was given. */
  match: "object" | "action" | "query" | "event" | null;
}

/** Workspace packages that declare a system, one folder deep under each top folder. */
export const findSystems = async (root: string): Promise<SystemPackage[]> => {
  const found: SystemPackage[] = [];
  const tops = await readdir(root, { withFileTypes: true });
  for (const top of tops) {
    if (
      !top.isDirectory() ||
      top.name.startsWith(".") ||
      top.name === "node_modules"
    ) {
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of folders
    const children = await readdir(path.join(root, top.name), {
      withFileTypes: true,
    });
    for (const child of children) {
      const dir = path.join(top.name, child.name);
      let manifest: { factory?: { system?: string } };
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- a handful of folders
        const text = await readFile(
          path.join(root, dir, "package.json"),
          "utf-8"
        );
        manifest = JSON.parse(text) as typeof manifest;
      } catch {
        continue;
      }
      const system = manifest.factory?.system;
      if (child.isDirectory() && system) {
        found.push({ dir, file: path.resolve(root, dir, system) });
      }
    }
  }
  return found;
};

const pick = (systems: SystemPackage[], wanted: string | undefined) => {
  if (systems.length === 0) {
    throw new FxError(
      "no_system",
      "There is no system in this repo.",
      'Add "factory": { "system": "./src/system.ts" } to a package.json.'
    );
  }
  if (wanted) {
    const chosen = systems.find(
      (system) => system.dir === wanted || path.basename(system.dir) === wanted
    );
    if (!chosen) {
      throw new FxError(
        "no_system",
        `There is no system at ${wanted}.`,
        `Systems: ${systems.map((system) => system.dir).join(", ")}`
      );
    }
    return chosen;
  }
  const [only] = systems;
  if (systems.length > 1 || !only) {
    throw new FxError(
      "usage",
      "This repo has more than one system.",
      `Pick one with --system: ${systems.map((system) => system.dir).join(", ")}`
    );
  }
  return only;
};

/** Narrows a description to one object (with its definitions), definition or event. */
export const narrow = (
  description: Description,
  name: string
): { description: Description; match: DescribeResult["match"] } => {
  const object = description.objects.find((each) => each.name === name);
  if (object) {
    const ours = (definition: { name: string }) =>
      definition.name.startsWith(`${name}.`);
    return {
      match: "object",
      description: {
        objects: [object],
        actions: description.actions.filter(ours),
        queries: description.queries.filter(ours),
        events: description.events.filter((event) =>
          event.type.startsWith(`${name}.`)
        ),
      },
    };
  }
  const empty: Description = {
    objects: [],
    actions: [],
    queries: [],
    events: [],
  };
  const action = description.actions.find((each) => each.name === name);
  if (action) {
    return { match: "action", description: { ...empty, actions: [action] } };
  }
  const query = description.queries.find((each) => each.name === name);
  if (query) {
    return { match: "query", description: { ...empty, queries: [query] } };
  }
  const event = description.events.find((each) => each.type === name);
  if (event) {
    return { match: "event", description: { ...empty, events: [event] } };
  }
  throw new FxError(
    "not_found",
    `Nothing is called "${name}".`,
    `Objects: ${description.objects.map((each) => each.name).join(", ")}. Run \`fx describe\` to see everything.`
  );
};

/** Loads the system for `cwd`'s repo and describes it. */
export const describeSystem = async (
  cwd: string,
  name?: string,
  /** `system` is the --system option as parsed; only a string counts. */
  options: { system?: unknown } = {}
): Promise<DescribeResult> => {
  const repo = await findRepo(cwd);
  const wanted =
    typeof options.system === "string" ? options.system : undefined;
  const chosen = pick(await findSystems(repo.worktreeRoot), wanted);
  const module = (await import(pathToFileURL(chosen.file).href)) as {
    default?: { name?: string; describe?: () => Description };
  };
  const system = module.default;
  if (typeof system?.describe !== "function") {
    throw new FxError(
      "no_system",
      `${chosen.file} has no system as its default export.`,
      "Export the defineSystem result: `export default defineSystem({ … })`."
    );
  }
  const full = system.describe();
  const narrowed = name
    ? narrow(full, name)
    : { description: full, match: null };
  return {
    system: system.name ?? chosen.dir,
    dir: chosen.dir,
    ...narrowed,
  };
};

const schemaText = (schema: JsonSchema) =>
  JSON.stringify(schema, null, 2).replaceAll("\n", "\n    ");

const fieldText = (field: Description["objects"][number]["fields"][number]) => {
  const type = field.target ? `ref → ${field.target}` : field.type;
  const notes = [
    field.required ? "required" : "",
    field.read ? "" : "hidden",
    field.read && !field.write ? "read-only" : "",
  ].filter(Boolean);
  const labels = (field.options ?? [])
    .filter((option) => !option.archived)
    .map((option) => option.label);
  const line =
    `    ${field.key.padEnd(16)} ${type.padEnd(22)} ${notes.join(", ")}`.trimEnd();
  return labels.length > 0 ? `${line}  ${labels.join(", ")}` : line;
};

/** The human-readable form: a summary, or schemas when one definition matched. */
export const formatDescribe = ({
  system,
  dir,
  description,
  match,
}: DescribeResult) => {
  const lines = [`${system} (${dir})`];
  const detailed = match === "action" || match === "query" || match === "event";
  if (description.objects.length > 0) {
    lines.push("", "Objects");
    for (const object of description.objects) {
      lines.push(
        `  ${object.name}${object.description ? `  ${object.description}` : ""}`,
        ...object.fields.map(fieldText)
      );
    }
  }
  const definitions = (title: string, list: Definition[]) => {
    if (list.length === 0) {
      return;
    }
    lines.push("", title);
    for (const definition of list) {
      const emits = definition.emits?.length
        ? `  → ${definition.emits.join(", ")}`
        : "";
      lines.push(`  ${definition.name}  ${definition.description}${emits}`);
      if (detailed) {
        lines.push(
          `    input: ${schemaText(definition.input)}`,
          `    output: ${schemaText(definition.output)}`
        );
      }
    }
  };
  definitions("Actions", description.actions);
  definitions("Queries", description.queries);
  if (description.events.length > 0) {
    lines.push("", "Events");
    for (const event of description.events) {
      lines.push(`  ${event.type}`);
      if (detailed) {
        lines.push(`    payload: ${schemaText(event.payload)}`);
      }
    }
  }
  if (!detailed) {
    lines.push(
      "",
      "Run `fx describe <name>` for one action's schemas, or --json for all of them."
    );
  }
  return `${lines.join("\n")}\n`;
};
