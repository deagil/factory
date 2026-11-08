// A config draft's changes in plain English (P2.10): what each file it
// touches now says differently, line by line. Choice lists are compared
// option by option and roles permission by permission; any other type falls
// back to its changed fields.

export interface ConfigChange {
  path: string;
  type: string;
  key: string;
  beforeValue: unknown;
  afterValue: unknown;
}

export interface DescribedChange {
  path: string;
  /** "Choice list deal-stages", "Role manager". */
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

interface Permission extends Value {
  object?: string;
  action?: string;
  can?: string[];
}

const permissionsOf = (value: unknown): Permission[] =>
  isValue(value) && Array.isArray(value.permissions)
    ? (value.permissions.filter(isValue) as Permission[])
    : [];

const objectName = (object: string) =>
  object === "*" ? "every object" : object;

const actionName = (action: string) =>
  action === "*" ? "every action" : action;

const actions = (list: Permission[]) =>
  list.flatMap((line) => (line.action ? [line.action] : []));

const permissionLines = (before: unknown, after: unknown): string[] => {
  const from = permissionsOf(before);
  const to = permissionsOf(after);
  const lines: string[] = [];
  const objects = new Set(
    [...from, ...to].flatMap((line) => (line.object ? [line.object] : []))
  );
  for (const object of objects) {
    const had = from.find((line) => line.object === object)?.can ?? [];
    const has = to.find((line) => line.object === object)?.can ?? [];
    const gained = has.filter((verb) => !had.includes(verb));
    const lost = had.filter((verb) => !has.includes(verb));
    if (gained.length > 0) {
      lines.push(`Can now ${gained.join(", ")} ${objectName(object)}.`);
    }
    if (lost.length > 0) {
      lines.push(`Can no longer ${lost.join(", ")} ${objectName(object)}.`);
    }
  }
  for (const action of actions(to)) {
    if (!actions(from).includes(action)) {
      lines.push(`Can now run ${actionName(action)}.`);
    }
  }
  for (const action of actions(from)) {
    if (!actions(to).includes(action)) {
      lines.push(`Can no longer run ${actionName(action)}.`);
    }
  }
  const { permissions: _before, ...restBefore } = isValue(before) ? before : {};
  const { permissions: _after, ...restAfter } = isValue(after) ? after : {};
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
    lines = permissionLines(before, after);
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
