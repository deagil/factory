// What config can refer to in a system (P2.04): its objects and fields, its
// actions and queries, and the events they emit.
import type { AnyDefinition } from "@workspace/actions";
import type { ConfigCatalog } from "@workspace/config";
import type { AnyObjectDefinition, ChoiceField } from "@workspace/objects";

/** The objects, actions, queries and events that config can refer to. */
export const catalogOf = (
  objects: readonly AnyObjectDefinition[],
  definitions: readonly AnyDefinition[]
): ConfigCatalog => ({
  objects: new Map(
    objects.map((object) => [object.name, Object.keys(object.fields)])
  ),
  actions: new Set(
    definitions
      .filter((definition) => !definition.objectPermission)
      .map((definition) => definition.name)
  ),
  objectActions: new Map(
    definitions.flatMap((definition) =>
      definition.objectPermission
        ? [[definition.name, definition.objectPermission] as const]
        : []
    )
  ),
  events: new Set(
    definitions.flatMap((definition) =>
      definition.kind === "action" ? Object.keys(definition.emits) : []
    )
  ),
  choiceFields: objects.flatMap((object) =>
    Object.entries(object.fields).flatMap(([field, definition]) => {
      if (definition.kind !== "choice") {
        return [];
      }
      const choice = definition as unknown as ChoiceField;
      return [
        {
          object: object.name,
          field,
          list: choice.list,
          control: choice.control,
          keys: choice.keys,
          categories: choice.categories,
        },
      ];
    })
  ),
});
