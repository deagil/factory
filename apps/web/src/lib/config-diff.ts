// A config draft's changes in plain English (P2.10): what each file it
// touches now says differently, line by line. Choice lists are compared
// option by option and roles object by object (P2.14); any other type falls
// back to its changed fields.

import {
  fieldListText,
  jobsOf,
  objectName,
  roleOf,
  workflowsOf,
} from "./roles.ts";
import type { ObjectRules } from "./roles.ts";

export interface ConfigChange {
  path: string;
  type: string;
  key: string;
  beforeValue: unknown;
  afterValue: unknown;
}

export interface DescribedChange {
  path: string;
  /** "Choice list deal_stages", "Role manager". */
  title: string;
  /** "added", "removed" or "changed". */
  kind: "added" | "removed" | "changed";
  lines: string[];
}

type Value = Record<string, unknown>;

const isValue = (value: unknown): value is Value =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const shown = (value: unknown): string => {
  if (value === undefined || value === null || value === "") {
    return "nothing";
  }
  if (Array.isArray(value)) {
    return value.map(shown).join(", ");
  }
  return typeof value === "string" ? value : JSON.stringify(value);
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Field-by-field lines for two values, `prefix` naming what they belong to. */
const fieldLines = (before: Value, after: Value, prefix = ""): string[] => {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.flatMap((key) => {
    const from = before[key];
    const to = after[key];
    if (same(from, to)) {
      return [];
    }
    const name = `${prefix}${key}`;
    if (from === undefined) {
      return [`Sets ${name} to ${shown(to)}.`];
    }
    if (to === undefined) {
      return [`Removes ${name} (was ${shown(from)}).`];
    }
    return [`Changes ${name} from ${shown(from)} to ${shown(to)}.`];
  });
};

interface Option extends Value {
  key: string;
  label?: string;
  archived?: boolean;
}

const optionsOf = (value: unknown): Option[] =>
  isValue(value) && Array.isArray(value.options)
    ? (value.options.filter(
        (option) => isValue(option) && typeof option.key === "string"
      ) as Option[])
    : [];

const nameOf = (option: Option) =>
  option.label ? `“${option.label}”` : option.key;

/** The keys of `options` that `other` has too, in order. */
const kept = (options: Option[], other: Option[]) =>
  options
    .map((option) => option.key)
    .filter((key) => other.some((each) => each.key === key));

const optionLines = (before: unknown, after: unknown): string[] => {
  const from = optionsOf(before);
  const to = optionsOf(after);
  const lines: string[] = [];
  for (const option of to) {
    const old = from.find((each) => each.key === option.key);
    if (!old) {
      const { key, label: _label, description, ...rest } = option;
      const described =
        typeof description === "string" && description !== ""
          ? `, “${description}”`
          : "";
      const details = Object.entries(rest)
        .filter(([, value]) => value !== undefined && value !== false)
        .map(([field, value]) => `${field} ${shown(value)}`);
      lines.push(
        `Adds the option ${nameOf(option)} (${key})${described}${details.length > 0 ? `; ${details.join("; ")}` : ""}.`
      );
      continue;
    }
    const { archived: wasArchived, ...oldRest } = old;
    const { archived: isArchived, ...newRest } = option;
    if (Boolean(wasArchived) !== Boolean(isArchived)) {
      lines.push(
        `${isArchived ? "Archives" : "Restores"} the option ${nameOf(option)}.`
      );
    }
    if (old.label !== option.label) {
      lines.push(
        `Renames the option ${option.key} from ${nameOf(old)} to ${nameOf(option)}.`
      );
    }
    const { label: _oldLabel, ...oldFields } = oldRest;
    const { label: _newLabel, ...newFields } = newRest;
    lines.push(...fieldLines(oldFields, newFields, `${nameOf(option)}'s `));
  }
  for (const option of from) {
    if (!to.some((each) => each.key === option.key)) {
      lines.push(`Removes the option ${nameOf(option)}.`);
    }
  }
  if (!same(kept(from, to), kept(to, from))) {
    lines.push(
      `Puts the options in this order: ${to.map((option) => nameOf(option)).join(", ")}.`
    );
  }
  const { options: _before, ...restBefore } = isValue(before) ? before : {};
  const { options: _after, ...restAfter } = isValue(after) ? after : {};
  return [...fieldLines(restBefore, restAfter), ...lines];
};

const workflowName = (name: string) => (name === "*" ? "every workflow" : name);

const ruleLines = (
  object: string,
  had: ObjectRules | undefined,
  has: ObjectRules | undefined
): string[] => {
  const lines: string[] = [];
  const name = objectName(object);
  const from = jobsOf(had);
  const to = jobsOf(has);
  const gained = to.filter((job) => !from.includes(job));
  const lost = from.filter((job) => !to.includes(job));
  if (gained.length > 0) {
    lines.push(`Can now ${gained.join(", ")} ${name}.`);
  }
  if (lost.length > 0) {
    lines.push(`Can no longer ${lost.join(", ")} ${name}.`);
  }
  if (!had || !has) {
    return lines;
  }
  if (had.rows !== has.rows) {
    lines.push(
      has.rows === "own"
        ? `Now reaches only its own ${name} records.`
        : `Now reaches every ${name} record.`
    );
  }
  for (const [side, verb] of [
    ["read", "Reads"],
    ["write", "Writes"],
  ] as const) {
    const before = fieldListText(had[side]);
    const after = fieldListText(has[side]);
    if (before !== after) {
      lines.push(`${verb} ${after} of ${name}, not ${before}.`);
    }
  }
  return lines;
};

const roleLines = (before: unknown, after: unknown): string[] => {
  const from = roleOf(before);
  const to = roleOf(after);
  const lines: string[] = [];
  const objects = new Set([
    ...Object.keys(from.objects ?? {}),
    ...Object.keys(to.objects ?? {}),
  ]);
  for (const object of objects) {
    lines.push(
      ...ruleLines(object, from.objects?.[object], to.objects?.[object])
    );
  }
  const had = workflowsOf(from);
  const has = workflowsOf(to);
  for (const name of has.filter((each) => !had.includes(each))) {
    lines.push(`Can now call ${workflowName(name)}.`);
  }
  for (const name of had.filter((each) => !has.includes(each))) {
    lines.push(`Can no longer call ${workflowName(name)}.`);
  }
  const {
    objects: _objectsBefore,
    workflows: _workflowsBefore,
    ...restBefore
  } = isValue(before) ? before : {};
  const {
    objects: _objectsAfter,
    workflows: _workflowsAfter,
    ...restAfter
  } = isValue(after) ? after : {};
  return [...fieldLines(restBefore, restAfter), ...lines];
};

const typeNames: Record<string, string> = {
  choices: "Choice list",
  roles: "Role",
  approvals: "Approval rule",
};

const kindOf = (change: ConfigChange): DescribedChange["kind"] => {
  if (change.beforeValue === null) {
    return "added";
  }
  return change.afterValue === null ? "removed" : "changed";
};

/** One file's change, in plain English. */
export const describeChange = (change: ConfigChange): DescribedChange => {
  const kind = kindOf(change);
  const title = `${typeNames[change.type] ?? change.type} ${change.key}`;
  const before = kind === "added" ? {} : change.beforeValue;
  const after = kind === "removed" ? {} : change.afterValue;
  if (kind === "removed") {
    return { path: change.path, title, kind, lines: ["Deletes the file."] };
  }
  let lines: string[];
  if (change.type === "choices") {
    lines = optionLines(before, after);
  } else if (change.type === "roles") {
    lines = roleLines(before, after);
  } else {
    lines = fieldLines(
      isValue(before) ? before : {},
      isValue(after) ? after : {}
    );
  }
  return {
    path: change.path,
    title,
    kind,
    lines:
      lines.length > 0
        ? lines
        : ["Changes only its layout or comments, not what it says."],
  };
};
