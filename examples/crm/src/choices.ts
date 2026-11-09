// The CRM's choice lists (decision 0040). Each list's structure is here: its
// own columns and any keys code acts on. The rows are in config/choices/,
// where staff edit them. drizzle-kit loads this file through objects.ts, so it
// imports only from `@workspace/objects/define` and zod.
import { defineChoiceList } from "@workspace/objects/define";
import { z } from "zod";

/** Deal stages. Staff add and rename stages; code acts on each one's category. */
export const dealStages = defineChoiceList({
  key: "deal_stages",
  columns: { category: z.enum(["open", "won", "lost"]) },
});

/** Industries. Staff own them; no code acts on them. */
export const industries = defineChoiceList({ key: "industries" });
