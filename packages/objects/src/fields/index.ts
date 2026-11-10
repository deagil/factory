// The field types library. See docs/SYSTEM_DESIGN.md section 4.1 and
// decision 0014. Choice fields are P2.06.

import { boolean } from "./boolean.ts";
import { choice } from "./choice.ts";
import { computed } from "./computed.ts";
import { date } from "./date.ts";
import { email } from "./email.ts";
import { money } from "./money.ts";
import { number } from "./number.ts";
import { ref } from "./ref.ts";
import { text } from "./text.ts";
import { url } from "./url.ts";

/** The field types, as used in `defineObject({ fields: { name: f.text() } })`. */
export const f = {
  text,
  email,
  url,
  number,
  money,
  date,
  boolean,
  ref,
  choice,
  computed,
} as const;
