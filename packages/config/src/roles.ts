// Roles as config: `config/roles/<key>.yaml`, each a role as
// `@workspace/actions` defines it (decision 0024).
import { roleSchema } from "@workspace/actions";
import type { Role } from "@workspace/actions";

import { defineConfigType } from "./config-type.ts";
import type { Reference } from "./config-type.ts";

/** Every object and action a role names; `*` names none. */
export const roleReferences = (role: Role): Reference[] =>
  role.permissions.flatMap((permission, index): Reference[] => {
    if ("object" in permission) {
      return permission.object === "*"
        ? []
        : [
            {
              kind: "object",
              name: permission.object,
              path: ["permissions", index, "object"],
            },
          ];
    }
    return permission.action === "*"
      ? []
      : [
          {
            kind: "action",
            name: permission.action,
            path: ["permissions", index, "action"],
          },
        ];
  });

export const roleConfigType = defineConfigType<Role>({
  type: "roles",
  schema: roleSchema,
  references: roleReferences,
});
