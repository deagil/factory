// The field types library. See docs/SYSTEM_DESIGN.md section 4.1 and
// decision 0014. Choice fields are decisions 0039 and 0040.

import { boolean } from "./boolean.ts";
import { choice } from "./choice.ts";
import { date } from "./date.ts";
import { money } from "./money.ts";
import { number } from "./number.ts";
import { ref } from "./ref.ts";
import { text } from "./text.ts";

/** The field types, as used in `defineObject({ fields: { name: f.text() } })`. */
export const f = { text, number, money, date, boolean, ref, choice } as const;
