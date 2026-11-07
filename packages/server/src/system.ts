// `defineSystem` (P1.18, decision 0031): one client's system, from its
// objects, hand-written actions and queries, and roles. It adds what every
// system has: the generated actions and queries for each object, the
// identity actions and queries, `record.history`, the log queries and
// `system.describe`.
import {
  allGranted,
  createRegistry,
  describeFor,
  describeQuery,
  generateDefinitions,
  historyQuery,
  identityQueries,
  logQueries,
  roleSchema,
} from "@workspace/actions";
import type {
  AnyDefinition,
  Registry,
  Role,
  SystemDescription,
} from "@workspace/actions";
import { identityActions } from "@workspace/auth";
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

export interface SystemOptions {
  /** The system's name, such as `acme-crm`. */
  name: string;
  objects: readonly AnyObjectDefinition[];
  /** Hand-written actions and queries. */
  actions?: readonly AnyDefinition[];
  /** Roles, until phase 2 loads them from config. */
  roles: readonly Role[];
}

export interface System {
  readonly name: string;
  readonly objects: readonly AnyObjectDefinition[];
  readonly roles: readonly Role[];
  /** Every action and query, generated and hand-written. */
  readonly registry: Registry;
  /** The object tables, for the schema check. */
  readonly tables: readonly AnyObjectDefinition["table"][];
  /** Everything in the system, as `system.describe` shows it to an admin. */
  readonly describe: () => SystemDescription;
}

export const defineSystem = (options: SystemOptions): System => {
  const roles = z.array(roleSchema).parse(options.roles);
  const definitions = [
    ...options.objects.flatMap((object) => generateDefinitions(object)),
    ...identityActions,
    historyQuery(options.objects),
    ...logQueries,
    ...identityQueries,
    ...(options.actions ?? []),
  ];
  const registry = createRegistry([
    ...definitions,
    describeQuery({ objects: options.objects, definitions }),
  ]);
  return Object.freeze({
    name: options.name,
    objects: options.objects,
    roles,
    registry,
    tables: options.objects.map((object) => object.table),
    describe: () =>
      describeFor(
        { objects: options.objects, definitions: registry.list() },
        allGranted
      ),
  });
};
