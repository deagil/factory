// A role file's shape as the web app reads it (P2.14): per object, the
// endpoints it may call, which rows (its own or all) and which fields it
// may read and write; then the workflows it may call. The server's Zod
// schema in @workspace/actions is the authority; this mirrors it.

export const objectJobs = [
  "list",
  "get",
  "create",
  "update",
  "archive",
  "restore",
  "history",
] as const;

export type ObjectJob = (typeof objectJobs)[number];

export interface FieldList {
  only?: string[];
  except?: string[];
}

export interface ObjectRules {
  endpoints: "*" | string[];
  rows: "own" | "all";
  read?: FieldList;
  write?: FieldList;
}

export interface Role {
  key: string;
  label: string;
  objects?: Record<string, ObjectRules>;
  workflows?: "*" | string[];
}

type Value = Record<string, unknown>;

const isValue = (value: unknown): value is Value =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : [];

const fieldListOf = (value: unknown): FieldList | undefined => {
  if (!isValue(value)) {
    return undefined;
  }
  if (Array.isArray(value.only)) {
    return { only: strings(value.only) };
  }
  return Array.isArray(value.except)
    ? { except: strings(value.except) }
    : undefined;
};

/** A role file's value read leniently, so a half-written draft still shows. */
export const roleOf = (value: unknown): Role => {
  const role = isValue(value) ? value : {};
  const objects: Record<string, ObjectRules> = {};
  if (isValue(role.objects)) {
    for (const [name, rules] of Object.entries(role.objects)) {
      if (isValue(rules)) {
        objects[name] = {
          endpoints: rules.endpoints === "*" ? "*" : strings(rules.endpoints),
          rows: rules.rows === "own" ? "own" : "all",
          read: fieldListOf(rules.read),
          write: fieldListOf(rules.write),
        };
      }
    }
  }
  return {
    key: String(role.key ?? ""),
    label: String(role.label ?? ""),
    objects,
    workflows: role.workflows === "*" ? "*" : strings(role.workflows),
  };
};

/** The endpoints a rule grants, with `*` spelled out. */
export const jobsOf = (rules: ObjectRules | undefined): string[] => {
  if (!rules) {
    return [];
  }
  return rules.endpoints === "*" ? [...objectJobs] : rules.endpoints;
};

/** "every field", "all but website", "only name, email". */
export const fieldListText = (list: FieldList | undefined): string => {
  if (list?.only) {
    return list.only.length === 0 ? "no field" : `only ${list.only.join(", ")}`;
  }
  return list?.except && list.except.length > 0
    ? `all but ${list.except.join(", ")}`
    : "every field";
};

/** An object rule's name: `*` is every object. */
export const objectName = (object: string) =>
  object === "*" ? "every object" : object;

/** The workflows a role grants, as a list; `*` stays `*`. */
export const workflowsOf = (role: Role): string[] =>
  role.workflows === "*" ? ["*"] : (role.workflows ?? []);
