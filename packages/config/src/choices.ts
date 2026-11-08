// Choice lists as config: `config/choices/<key>.yaml` (P2.06, SYSTEM_DESIGN
// §4.5). Fields in code name the list; what staff may change in it depends on
// the field's control, which validateConfig checks.
import { z } from "zod";

import { defineConfigType } from "./config-type.ts";

const key = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/u,
    "Use lower case letters, digits and dashes, starting with a letter"
  );

export const choiceOptionSchema = z.strictObject({
  key,
  label: z.string().min(1),
  category: key.optional(),
  archived: z.boolean().optional(),
});

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
  // Code names the lists; a list names nothing.
  references: () => [],
});
