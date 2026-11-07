// Roles and permissions. A role is config: a key, a label and permissions,
// each on an object (with verbs) or an action, with a scope (`all` only for
// now). Actors get roles through actor_roles. The pipeline's authorise stage
// and the data access layer both ask the same granted set. See
// docs/SYSTEM_DESIGN.md section 4.3 and decision 0024.

import { actorRoles } from "@workspace/db";
import type { Db } from "@workspace/db";
import type { AnyObjectDefinition, ReadAccess } from "@workspace/objects";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type {
  Actor,
  AnyDefinition,
  ConfigService,
  ObjectVerb,
} from "./define-action.ts";
import { objectVerbs } from "./define-action.ts";
import { failures } from "./errors.ts";
import type { ActionFailure } from "./errors.ts";

/** Which records a permission covers. Only `all` until later phases. */
export const scopes = ["all"] as const;

const name = z.union([
  z.literal("*"),
  z.string().regex(/^[a-z][a-zA-Z0-9]*$/u),
]);

/** One line of a role. `*` means every object, or every action. */
export const permissionSchema = z.union([
  z.strictObject({
    object: name,
    can: z.array(z.enum(objectVerbs)).min(1),
    scope: z.enum(scopes),
  }),
  z.strictObject({
    action: z.union([
      z.literal("*"),
      z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/u),
    ]),
    scope: z.enum(scopes),
  }),
]);

/** A role, as `config/roles/<key>.yaml` holds it. */
export const roleSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]*$/u),
  label: z.string().min(1),
  permissions: z.array(permissionSchema),
});

export type Permission = z.infer<typeof permissionSchema>;
export type Role = z.infer<typeof roleSchema>;

/**
 * The permission a definition needs, by name: `<object>.<verb>` for
 * generated ones (`contact.view`), the definition's own name otherwise.
 */
export const permissionNameOf = (definition: AnyDefinition): string =>
  definition.objectPermission
    ? `${definition.objectPermission.object}.${definition.objectPermission.can}`
    : definition.name;

/** What one actor may do, worked out once per run. */
export interface Granted {
  /** A permission failure naming what's missing, or null. */
  authorise: (definition: AnyDefinition) => ActionFailure | null;
  canRead: (object: AnyObjectDefinition) => ReadAccess;
}

/** What `permissions` holds: whoever loads an actor's granted set. */
export interface Permissions {
  load: (actor: Actor) => Promise<Granted>;
}

/** The granted set of `roles`. */
export const grantedBy = (roles: readonly Role[]): Granted => {
  const lines = roles.flatMap((role) => role.permissions);
  const canDo = (object: string, verb: ObjectVerb) =>
    lines.some(
      (line) =>
        "object" in line &&
        (line.object === "*" || line.object === object) &&
        line.can.includes(verb)
    );
  const canRun = (action: string) =>
    lines.some(
      (line) =>
        "action" in line && (line.action === "*" || line.action === action)
    );
  return {
    authorise: (definition) => {
      const needed = definition.objectPermission;
      const allowed = needed
        ? canDo(needed.object, needed.can)
        : canRun(definition.name);
      return allowed ? null : failures.forbidden(permissionNameOf(definition));
    },
    canRead: (object) => (canDo(object.name, "view") ? "all" : "none"),
  };
};

/** Everything, for tests and tools that run as the system itself. */
export const allowAll: Permissions = {
  load: () =>
    Promise.resolve(
      grantedBy([
        {
          key: "all",
          label: "Everything",
          permissions: [
            { object: "*", can: [...objectVerbs], scope: "all" },
            { action: "*", scope: "all" },
          ],
        },
      ])
    ),
};

/**
 * Permissions from roles: an actor holds the roles actor_roles gives it, as
 * `config.roles` defines them. Role keys config doesn't define grant nothing.
 */
export const rolePermissions = ({
  db,
  config,
}: {
  db: Db;
  config: ConfigService;
}): Permissions => ({
  load: async (actor) => {
    const rows = await db
      .select({ roleKey: actorRoles.roleKey })
      .from(actorRoles)
      .where(eq(actorRoles.actorId, actor.id));
    const keys = new Set(rows.map((row) => row.roleKey));
    return grantedBy(config.roles.filter((role) => keys.has(role.key)));
  },
});
