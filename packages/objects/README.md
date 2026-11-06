# @workspace/objects

defineObject, the field types library, the data access layer (the only way to read records) and repositories (the only way to write them), including field history in audit_log.

**Status:** the field types (P1.01; decision [0014](../../docs/decisions/0014-field-types.md)) and `defineObject` (P1.02; decision [0015](../../docs/decisions/0015-define-object-tables-and-records.md)) are built. The data access layer and repositories come next in phase 1.

```ts
import { f } from "@workspace/objects";

f.text({ required: true, maxLength: 200 });
f.number({ integer: true, min: 0 });
f.money({ currency: "GBP" }); // { amount: 1234, currency: "GBP" } is £12.34
f.date(); // "2026-11-06"
f.boolean();
f.ref("organisation"); // or f.ref("actor")
```

Each field gives its column builders, an input and an output Zod schema, a plain display string and its filter operators.

```ts
import { defineObject, f } from "@workspace/objects";
import { index } from "drizzle-orm/pg-core";

export const contact = defineObject({
  name: "contact", // table `contacts`
  fields: {
    firstName: f.text({ required: true }),
    organisation: f.ref("organisation", { required: true }),
  },
  customFields: true,
  list: ["firstName", "organisation"],
  actions: { update: { readOnly: ["organisation"] } },
  drizzle: (t) => [index("contacts_first_name_idx").on(t.firstName)],
});

contact.table; // a real Drizzle table
contact.schemas.create; // and update, record
contact.fromRow(row); // a JSON-safe record
```

Schema files that drizzle-kit loads run as CommonJS, so they can't use `import.meta`. Import the core tables from `@workspace/db/schema`.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.1 Objects and the data access layer.
