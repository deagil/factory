// What config can refer to in a system (P2.04): its objects and fields, its
// actions and queries, and the events they emit.
import type { AnyDefinition } from "@workspace/actions";
import type { ChoiceListUse, ConfigCatalog } from "@workspace/config";
import type {
  AnyChoiceList,
  AnyObjectDefinition,
  ChoiceField,
} from "@workspace/objects";

/**
 * The choice lists the objects' fields use, each once with the fields that
 * use it. Two different lists with one key are refused.
 */
export const choiceListsOf = (
  objects: readonly AnyObjectDefinition[]
): ChoiceListUse[] => {
  const lists = new Map<string, { list: AnyChoiceList; usedBy: string[] }>();
  for (const object of objects) {
    for (const [key, field] of Object.entries(object.fields)) {
      if (field.kind !== "choice") {
        continue;
      }
      const { list } = field as unknown as ChoiceField;
      const seen = lists.get(list.key);
      if (seen && seen.list !== list) {
        throw new Error(
          `Two choice lists are called "${list.key}". Define it once with defineChoiceList and use that in every field.`
        );
      }
      const entry = seen ?? { list, usedBy: [] };
      entry.usedBy.push(`${object.name}.${key}`);
      lists.set(list.key, entry);
    }
  }
  return [...lists.values()].map(({ list, usedBy }) => ({
    key: list.key,
    keys: list.keys,
    option: list.option,
    usedBy,
  }));
};

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
  owners: new Set(
    objects.flatMap((object) => (object.owner ? [object.name] : []))
  ),
  events: new Set(
    definitions.flatMap((definition) =>
      definition.kind === "action" ? Object.keys(definition.emits) : []
    )
  ),
  choiceLists: choiceListsOf(objects),
});
