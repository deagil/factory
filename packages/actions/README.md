# @workspace/actions

defineAction and defineQuery, the action registry, the action pipeline, permissions and scopes, approvals, action_log.

**Status:** definitions, the registry, the handler context and typed errors (P1.06; decision [0019](../../docs/decisions/0019-define-action-context-and-errors.md)) and the pipeline (P1.07; decision [0020](../../docs/decisions/0020-action-pipeline.md)) are built, with retry keys and dry runs (P1.08; decision [0021](../../docs/decisions/0021-retry-keys-and-dry-runs.md)). So are generated actions and queries (P1.09; decision [0022](../../docs/decisions/0022-generated-actions.md)): `generateDefinitions(object)` gives `<object>.create`, `.update`, `.archive`, `.get` and `.list`. Permissions (P1.11) come next.

Design: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md), section 4.2 Actions and the action pipeline.

```ts
import { createRegistry, defineAction } from "@workspace/actions";

export const moveToOrganisation = defineAction({
  name: "contact.moveToOrganisation",
  description: "Move a contact to another organisation",
  input: z.object({ contactId: z.uuid(), organisationId: z.uuid() }),
  output: z.object({ contact: contact.schemas.record }),
  emits: { "contact.moved": movedSchema },
  async handler(ctx, { contactId, organisationId }) {
    const result = await ctx.repo.update(contact, contactId, {
      organisation: organisationId,
    });
    if (result.status === "not_found") {
      return ctx.notFound("contact", contactId); // typed errors are returned
    }
    if (result.status !== "updated" && result.status !== "unchanged") {
      return ctx.conflict("The contact can't be moved now");
    }
    ctx.emit("contact.moved", { contactId, organisationId }); // checked against emits
    return { contact: result.record };
  },
});

const registry = createRegistry([moveToOrganisation, ...generated]);
```

- **`ctx`** has `repo`, `dal`, `config`, `clock`, `actor`, `originUserId`, `emit` and the error helpers (`invalid`, `invalidInput`, `forbidden`, `needsApproval`, `conflict`, `notFound`). Queries get it without `repo` and `emit`. The pipeline builds it per run with `createActionContext` and `createQueryContext`.
- **Typed errors** have a `code`: `validation`, `permission`, `approval_required`, `conflict` or `not_found`. `isActionFailure(value)` tells them apart from outputs.
- **The registry** refuses two definitions with the same name, and one event declared with two schemas.
- **Handlers reach services only through `ctx`.** `checkHandlerBoundary(dirs)` from `@workspace/actions/boundary` reports files that define actions or queries and import the database or other service packages, build repositories themselves or read the system clock.
- **The pipeline** runs them: `createPipeline({ db, config, clock }).run(action, input, { actorId })` returns `{ ok: true, output, actionId, events }` or `{ ok: false, error, actionId }`, and `.query(query, input, caller)` the same without a log row. `run` takes `{ retryKey, dryRun }` as a fourth argument.
