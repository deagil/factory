// Choice lists as config: `config/choices/<key>.yaml` (SYSTEM_DESIGN
// §4.5, decision 0040). The file holds the rows; the list's structure (its own
// columns and any fixed keys) is defined in code with `defineChoiceList`, and
// validateConfig checks each row against it.
import { choiceKey, choiceOptionShape } from "@workspace/objects";
import { z } from "zod";

import { defineConfigType } from "./config-type.ts";

const key = choiceKey;

/**
 * One option as read: the built-in columns, and any of the list's own, which
 * validateConfig checks against the list's definition.
 */
export const choiceOptionSchema = z.looseObject(choiceOptionShape);

/** An option of a list no code defines: the built-in columns only. */
export const plainChoiceOption = z.strictObject(choiceOptionShape);

export const choiceListSchema = z
  .strictObject({
    key,
    options: z.array(choiceOptionSchema).min(1),
  })
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const [index, option] of list.options.entries()) {
      if (seen.has(option.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", index, "key"],
          message: `The option "${option.key}" is listed twice.`,
        });
      }
      seen.add(option.key);
    }
  });

export type ChoiceList = z.infer<typeof choiceListSchema>;

export const choiceConfigType = defineConfigType<ChoiceList>({
  type: "choices",
  schema: choiceListSchema,
  // Code defines the lists; a list names nothing.
  references: () => [],
});

/** Each list's options by key, as `ConfigService.choices` gives them. */
export const choiceLookup =
  (lists: readonly ChoiceList[]) =>
  (list: string): ChoiceList["options"] | undefined =>
    lists.find((each) => each.key === list)?.options;
