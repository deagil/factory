// Choice lists where staff expect them (P2.10c): each list with the fields
// that use it, and which of its options the caller's working draft changes
// compared with the live version.
import type { SystemDescription } from "./api.ts";

type Value = Record<string, unknown>;

/** A field that takes its options from a list. */
export interface ListUse {
  object: string;
  objectLabel: string;
  field: string;
  fieldLabel: string;
}

/** Whether the caller can change config, which choice lists need. */
export const canEditConfig = (description: SystemDescription | undefined) =>
  (description?.actions ?? []).some((action) => action.name === "draft.save");

/** "deal-stages" → "Deal stages". */
export const listLabel = (key: string) => {
  const words = key.replaceAll(/[-_]/gu, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Every field, on objects the caller can see, that uses the list. */
export const usesOf = (
  description: SystemDescription | undefined,
  list: string
): ListUse[] =>
  (description?.objects ?? []).flatMap((object) =>
    object.fields
      .filter((field) => field.list === list)
      .map((field) => ({
        object: object.name,
        objectLabel: object.label,
        field: field.key,
        fieldLabel: field.label,
      }))
  );

/** The options of a choice list's value, or none. */
export const optionsOf = (value: unknown): Value[] => {
  const options = (value as { options?: unknown } | null)?.options;
  return Array.isArray(options) ? (options as Value[]) : [];
};

/** A value with its keys in order, leaving out unset and `archived: false`. */
const sorted = (value: Value) =>
  Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, each]) =>
          each !== undefined && !(key === "archived" && each === false)
      )
      .toSorted(([a], [b]) => a.localeCompare(b))
  );

export type OptionMark = "new" | "changed";

/**
 * How each option in `current` differs from `live`, by key: "new" when live
 * has no option with that key, "changed" when any of its values differ.
 * Unchanged options aren't in the map. Order changes aren't marked.
 */
export const optionMarks = (
  current: readonly Value[],
  live: readonly Value[]
): Map<string, OptionMark> => {
  const byKey = new Map(live.map((option) => [String(option.key), option]));
  const marks = new Map<string, OptionMark>();
  for (const option of current) {
    const key = String(option.key);
    const before = byKey.get(key);
    if (!before) {
      marks.set(key, "new");
    } else if (
      JSON.stringify(sorted(before)) !== JSON.stringify(sorted(option))
    ) {
      marks.set(key, "changed");
    }
  }
  return marks;
};
