// Roles and their rules (P2.14, decision 0045). A role is config: per
// object, the endpoints it may call, its rows (`own` or `all`) and the
// fields it may read and write; and the workflows it may call, by name.
// Until workflows replace them (P2.24, P2.25), hand-written actions and
// queries are granted the same way, by name, under `workflows`. Actors get
// roles through actor_roles. The pipeline's authorise stage, the data access
// layer and the repository all ask the same granted set. See
// docs/SYSTEM_DESIGN.md section 4.3.

import { actorRoles, actors, isActiveUser } from "@workspace/db";
import type { Db } from "@workspace/db";
import type {
  AnyObjectDefinition,
  ReadAccess,
  WriteRules,
} from "@workspace/objects";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type {
  Actor,
  AnyDefinition,
  ConfigService,
  ObjectJob,
} from "./define-action.ts";
import { namePattern, objectJobs } from "./define-action.ts";
import { failures } from "./errors.ts";
import type { ActionFailure } from "./errors.ts";

/** Which records a role's rules on an object cover. */
export const rowScopes = ["own", "all"] as const;
export type RowScope = (typeof rowScopes)[number];

const snakeCase = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
// Field keys are camelCase until P2.13a.
const fieldKey = z.string().regex(/^[a-z][a-zA-Z0-9_]*$/u);

/** Some of an object's fields: `only` these, or all `except` these. */
export const fieldListSchema = z.union([
  z.strictObject({ only: z.array(fieldKey) }),
  z.strictObject({ except: z.array(fieldKey) }),
]);

/** A role's rules on one object. `*` grants every endpoint. */
export const objectRulesSchema = z.strictObject({
  endpoints: z.union([z.literal("*"), z.array(z.enum(objectJobs)).min(1)]),
  rows: z.enum(rowScopes),
  /** The fields it may read; every field when absent. */
  read: fieldListSchema.optional(),
  /** The fields it may write; every field when absent. */
  write: fieldListSchema.optional(),
});

/** A role, as `config/roles/<key>.yaml` holds it. */
export const roleSchema = z.strictObject({
  key: z.string().regex(snakeCase),
  label: z.string().min(1),
  /** Rules per object, by name; `*` covers objects not named. */
  objects: z
    .record(
      z.union([z.literal("*"), z.string().regex(snakeCase)]),
      objectRulesSchema
    )
    .optional(),
  /** Workflows (and hand-written actions and queries) by name; `*` is all. */
  workflows: z
    .union([z.literal("*"), z.array(z.string().regex(namePattern))])
    .optional(),
});

export type FieldList = z.infer<typeof fieldListSchema>;
export type ObjectRules = z.infer<typeof objectRulesSchema>;
export type Role = z.infer<typeof roleSchema>;

/** The permission a definition needs: its endpoint's or workflow's name. */
export const permissionNameOf = (definition: AnyDefinition): string =>
  definition.name;

/** What a caller may do with one object, its roles added up. */
export interface ObjectGrant {
  readonly endpoints: ReadonlySet<ObjectJob>;
  readonly rows: RowScope;
  /** The fields it may read and write, by key. */
  readonly read: ReadonlySet<string>;
  readonly write: ReadonlySet<string>;
}

/** What one actor may do, worked out once per run. */
export interface Granted {
  /** A permission failure naming what's missing, or null. */
  authorise: (definition: AnyDefinition) => ActionFailure | null;
  /** The actor's grant on `object`, or null when its roles give none. */
  on: (object: AnyObjectDefinition) => ObjectGrant | null;
  /** The workflows it may call by name, or `*` for all. */
  workflows: ReadonlySet<string> | "*";
  /** Whom `rows: own` means: the caller, or the person an agent acts for. */
  ownerId: string | null;
  /** Which of `object`'s records and fields it may read. */
  canRead: (object: AnyObjectDefinition) => ReadAccess;
  /** Which of `object`'s records and fields it may write. */
  writeRules: (object: AnyObjectDefinition) => WriteRules;
  /** Whether the actor holds the role `key`, as approvers must (P2.09). */
  holds: (key: string) => boolean;
}

/** What `permissions` holds: whoever loads an actor's granted set. */
export interface Permissions {
  load: (actor: Actor) => Promise<Granted>;
}

const fieldsIn = (object: AnyObjectDefinition, list: FieldList | undefined) => {
  const keys = Object.keys(object.fields);
  if (!list) {
    return new Set(keys);
  }
  return new Set(
    "only" in list
      ? keys.filter((key) => list.only.includes(key))
      : keys.filter((key) => !list.except.includes(key))
  );
};

const union = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  new Set([...a, ...b]);
const both = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) =>
  new Set([...a].filter((item) => b.has(item)));
const within = <T>(inner: ReadonlySet<T>, outer: ReadonlySet<T>) =>
  [...inner].every((item) => outer.has(item));

/** A role's own rules on the object called `name`, if it has any. */
const rulesOn = (role: Role, name: string) =>
  role.objects?.[name] ?? role.objects?.["*"];

const grantOf = (
  rules: ObjectRules,
  object: AnyObjectDefinition
): ObjectGrant => ({
  endpoints: new Set(rules.endpoints === "*" ? objectJobs : rules.endpoints),
  rows: rules.rows,
  read: fieldsIn(object, rules.read),
  write: fieldsIn(object, rules.write),
});

/** Two roles' grants added up: what either allows. */
const addGrants = (a: ObjectGrant, b: ObjectGrant): ObjectGrant => ({
  endpoints: union(a.endpoints, b.endpoints),
  rows: a.rows === "all" || b.rows === "all" ? "all" : "own",
  read: union(a.read, b.read),
  write: union(a.write, b.write),
});

/** What both grants allow: the narrower of the two. */
const narrowGrants = (a: ObjectGrant, b: ObjectGrant): ObjectGrant => ({
  endpoints: both(a.endpoints, b.endpoints),
  rows: a.rows === "own" || b.rows === "own" ? "own" : "all",
  read: both(a.read, b.read),
  write: both(a.write, b.write),
});

/** No record has this id, so `own` with no one to own matches nothing. */
const nobody = "00000000-0000-0000-0000-000000000000";

/** Where `rows: own` points: the object's owner field, set to `ownerId`. */
const ownerOf = (object: AnyObjectDefinition, ownerId: string | null) =>
  object.owner && ownerId
    ? { field: object.owner, id: ownerId }
    : { field: "id", id: nobody };

/** The rules `grant` puts on reads or writes of `fields`. */
const rulesFrom = (
  object: AnyObjectDefinition,
  grant: ObjectGrant,
  fields: ReadonlySet<string>,
  ownerId: string | null
) => ({
  ...(grant.rows === "own" ? { owner: ownerOf(object, ownerId) } : {}),
  ...(fields.size === Object.keys(object.fields).length ? {} : { fields }),
});

type Core = Pick<Granted, "on" | "workflows" | "holds" | "ownerId">;

/** The whole granted set from its grants per object and its workflows. */
const finish = (core: Core): Granted => {
  const { on, workflows, ownerId } = core;
  return {
    ...core,
    authorise: (definition) => {
      if (definition.everyone) {
        return null;
      }
      const needed = definition.objectPermission;
      // Endpoints don't depend on fields: a stand-in object will do.
      const allowed = needed
        ? (on({ name: needed.object, fields: {} } as never)?.endpoints.has(
            needed.job
          ) ?? false)
        : workflows === "*" || workflows.has(definition.name);
      return allowed ? null : failures.forbidden(permissionNameOf(definition));
    },
    canRead: (object) => {
      const grant = on(object);
      if (!grant) {
        return "none";
      }
      const rules = rulesFrom(object, grant, grant.read, ownerId);
      return rules.owner || rules.fields ? rules : "all";
    },
    writeRules: (object) => {
      const grant = on(object);
      return grant
        ? rulesFrom(object, grant, grant.write, ownerId)
        : { owner: ownerOf(object, null), fields: new Set() };
    },
  };
};

/**
 * The granted set of `roles`, which add up: per object, any endpoint, field
 * or `all` rows one of them gives. `ownerId` is whom `rows: own` means.
 */
export const grantedBy = (
  roles: readonly Role[],
  ownerId: string | null = null
): Granted =>
  finish({
    on: (object) => {
      let grant: ObjectGrant | null = null;
      for (const role of roles) {
        const rules = rulesOn(role, object.name);
        if (rules) {
          const own = grantOf(rules, object);
          grant = grant ? addGrants(grant, own) : own;
        }
      }
      return grant;
    },
    workflows: roles.some((role) => role.workflows === "*")
      ? "*"
      : new Set(
          roles.flatMap((role) =>
            Array.isArray(role.workflows) ? role.workflows : []
          )
        ),
    holds: (key) => roles.some((role) => role.key === key),
    ownerId,
  });

const narrowWorkflows = (
  a: Granted["workflows"],
  b: Granted["workflows"]
): Granted["workflows"] => {
  if (a === "*") {
    return b;
  }
  return b === "*" ? a : both(a, b);
};

/** What both `a` and `b` allow: the narrower of the two. `own` is `a`'s. */
/** Whether `granted` lets its holder call the workflow `key` (P2.18). */
export const mayCall = (granted: Pick<Granted, "workflows">, key: string) =>
  granted.workflows === "*" || granted.workflows.has(key);

export const intersect = (a: Granted, b: Granted): Granted =>
  finish({
    on: (object) => {
      const left = a.on(object);
      const right = b.on(object);
      return left && right ? narrowGrants(left, right) : null;
    },
    workflows: narrowWorkflows(a.workflows, b.workflows),
    holds: (key) => a.holds(key) && b.holds(key),
    ownerId: a.ownerId,
  });

/**
 * What `wanted` allows beyond `holder`, in words, or null when `holder`
 * covers it: the privilege ceiling (decision 0045). Nobody grants, mints or
 * revokes authority they don't hold themselves.
 */
export const beyond = (
  holder: Granted,
  wanted: Granted,
  objects: readonly AnyObjectDefinition[]
): string | null => {
  for (const object of objects) {
    const want = wanted.on(object);
    const have = holder.on(object);
    if (
      want &&
      !(
        have &&
        within(want.endpoints, have.endpoints) &&
        (want.rows === "own" || have.rows === "all") &&
        within(want.read, have.read) &&
        within(want.write, have.write)
      )
    ) {
      return `more on ${object.label.toLowerCase()} records than you have`;
    }
  }
  if (holder.workflows === "*") {
    return null;
  }
  if (wanted.workflows === "*") {
    return "every workflow, and you can't call them all";
  }
  const held = holder.workflows;
  const missing = [...wanted.workflows].find((name) => !held.has(name));
  return missing ? `${missing}, which you can't call` : null;
};

const nothing = grantedBy([]);

/** A role with every rule, for tests and tools that run as the system. */
export const everythingRole: Role = {
  key: "all",
  label: "Everything",
  objects: { "*": { endpoints: "*", rows: "all" } },
  workflows: "*",
};

/** Everything, for tests and tools that run as the system itself. */
export const allowAll: Permissions = {
  load: () => Promise.resolve(grantedBy([everythingRole])),
};

/**
 * Permissions from roles: an actor holds the roles actor_roles gives it, as
 * `config.roles` defines them. Role keys config doesn't define grant nothing.
 *
 * An agent acts for its user, so it gets the user's staff actor's rules,
 * narrowed by any roles of its own; never more than the user, and `own`
 * rows are the user's. A disabled user's agents get nothing.
 */
export const rolePermissions = ({
  db,
  config,
}: {
  db: Db;
  config: ConfigService;
}): Permissions => {
  const rolesOf = async (actorId: string) => {
    const rows = await db
      .select({ roleKey: actorRoles.roleKey })
      .from(actorRoles)
      .where(eq(actorRoles.actorId, actorId));
    return new Set(rows.map((row) => row.roleKey));
  };
  const grantedFor = async (actorId: string, ownerId: string) => {
    const keys = await rolesOf(actorId);
    return {
      granted: grantedBy(
        config.roles.filter((role) => keys.has(role.key)),
        ownerId
      ),
      hasRoles: keys.size > 0,
    };
  };
  const forAgent = async (actor: Actor) => {
    if (!actor.userId || !(await isActiveUser(db, actor.userId))) {
      return nothing;
    }
    const [staff] = await db
      .select({ id: actors.id, status: actors.status })
      .from(actors)
      .where(and(eq(actors.userId, actor.userId), eq(actors.kind, "staff")));
    if (!staff || staff.status !== "active") {
      return nothing;
    }
    const user = await grantedFor(staff.id, staff.id);
    const own = await grantedFor(actor.id, staff.id);
    return own.hasRoles ? intersect(user.granted, own.granted) : user.granted;
  };
  return {
    load: async (actor) => {
      if (actor.kind === "agent") {
        return forAgent(actor);
      }
      const { granted } = await grantedFor(actor.id, actor.id);
      return granted;
    },
  };
};
