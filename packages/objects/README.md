# @workspace/objects

defineObject, the field types library, the data access layer (the only way to read records) and repositories (the only way to write them), including field history in audit_log.

**Status:** the field types (P1.01; decision [0014](../../docs/decisions/0014-field-types.md)) and `defineObject` (P1.02; decision [0015](../../docs/decisions/0015-define-object-tables-and-records.md)) are built. So are the data access layer (P1.04; decision [0017](../../docs/decisions/0017-data-access-layer.md)) and repositories (P1.05; decision [0018](../../docs/decisions/0018-audit-log-row-per-change.md)).

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

Reads go through the data access layer:

```ts
const dal = createDataAccess({ executor: db, canRead: () => "all" });
const page = await dal.list(contact, {
  filter: { lastName: { startsWith: "Lo" }, active: { eq: true } },
  sort: "-createdAt",
  limit: 50,
  expand: ["organisation"],
});
page.records; // contacts
page.related.organisation; // { [id]: organisation }
page.nextCursor; // pass as `cursor` for the next page
await dal.get(contact, id); // { record, related } or null
```

Writes go through a repository, which runs only inside an action's transaction. Actions get it as `ctx.repo` (P1.06); until then, tests make one by hand:

```ts
const repo = createRepository({ executor: tx, actionId, actorId, now });
const org = await repo.create(organisation, { name: "Acme" });
const result = await repo.update(
  organisation,
  org.id,
  {
    name: "Acme Ltd",
    customFields: { tier: "gold" },
  },
  { lock: true, expectedVersion: 1 }
);
// status: "updated" | "unchanged" | "not_found" | "archived" | "conflict"
// one audit_log row: before { name: "Acme", "customFields.tier": null },
//                    after  { name: "Acme Ltd", "customFields.tier": "gold" }
await repo.archive(organisation, org.id); // no audit_log row
```

Schema files that drizzle-kit loads run as CommonJS, so they can't use `import.meta`. Import the core tables from `@workspace/db/schema`.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.1 Objects and the data access layer.
