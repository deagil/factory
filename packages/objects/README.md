# @workspace/objects

defineObject, the field types library, the data access layer (the only way to read records) and repositories (the only way to write them), including field history in audit_log.

**Status:** the field types are built (P1.01; decision [0014](../../docs/decisions/0014-field-types.md)). `defineObject`, the data access layer and repositories come next in phase 1.

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

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.1 Objects and the data access layer.
