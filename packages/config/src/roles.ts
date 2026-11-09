// Roles as config: `config/roles/<key>.yaml`, each a role as
// `@workspace/actions` defines it (P2.14, decision 0045).
import { roleSchema } from "@workspace/actions";
import type { FieldList, Role } from "@workspace/actions";

import { defineConfigType } from "./config-type.ts";
import type { ConfigPath, Reference } from "./config-type.ts";

const fieldReferences = (
  object: string,
  list: FieldList | undefined,
  at: ConfigPath
): Reference[] => {
  if (!list) {
    return [];
  }
  const [mode, keys] =
    "only" in list
      ? (["only", list.only] as const)
      : (["except", list.except] as const);
  return keys.map((key, index) => ({
    kind: "field",
    name: `${object}.${key}`,
    path: [...at, mode, index],
  }));
};

/**
 * Every object, field, endpoint and workflow a role names; `*` names none.
 * A role with `rows: own` names the object's owner field too.
 */
export const roleReferences = (role: Role): Reference[] => [
  ...Object.entries(role.objects ?? {}).flatMap(
    ([object, rules]): Reference[] => {
      if (object === "*") {
        return [];
      }
      const at = ["objects", object];
      return [
        { kind: "object", name: object, path: at },
        ...(rules.endpoints === "*"
          ? []
          : rules.endpoints.map((job, index): Reference => ({
              kind: "endpoint",
              name: `${object}_${job}`,
              path: [...at, "endpoints", index],
            }))),
        ...(rules.rows === "own"
          ? [{ kind: "owner", name: object, path: [...at, "rows"] } as const]
          : []),
        ...fieldReferences(object, rules.read, [...at, "read"]),
        ...fieldReferences(object, rules.write, [...at, "write"]),
      ];
    }
  ),
  ...(Array.isArray(role.workflows)
    ? role.workflows.map((name, index): Reference => ({
        kind: "action",
        name,
        path: ["workflows", index],
      }))
    : []),
];

export const roleConfigType = defineConfigType<Role>({
  type: "roles",
  schema: roleSchema,
  references: roleReferences,
});
