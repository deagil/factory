// `defineSystem` (P1.18, decision 0031): one client's system, from its
// objects, hand-written actions and queries, and its `config/` folder,
// where its roles live (P2.05). It adds what every
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
} from "@workspace/actions";
import type {
  AnyDefinition,
  Registry,
  SystemDescription,
} from "@workspace/actions";
import { identityActions } from "@workspace/auth";
import { coreConfigTypes, validateConfig } from "@workspace/config";
import type { ConfigCatalog, ConfigRead } from "@workspace/config";
import type { AnyObjectDefinition } from "@workspace/objects";

import { catalogOf } from "./catalog.ts";
import { configValidateQuery } from "./config.ts";

export interface SystemOptions {
  /** The system's name, such as `acme-crm`. */
  name: string;
  objects: readonly AnyObjectDefinition[];
  /** Hand-written actions and queries. */
  actions?: readonly AnyDefinition[];
  /**
   * The system's migrations folder, absolute, which `fx ship` writes from
   * its objects. Applied after the core's (decision 0036).
   */
  migrations?: string;
  /**
   * The system's `config/` folder, absolute. With it the system has
   * `config.validate` and `validateConfig()` (P2.04).
   */
  config?: string;
}

export interface System {
  readonly name: string;
  readonly objects: readonly AnyObjectDefinition[];
  /** Every action and query, generated and hand-written. */
  readonly registry: Registry;
  /** The system's migrations folder, if it has one. */
  readonly migrations: string | undefined;
  /** The system's `config/` folder, if it has one. */
  readonly config: string | undefined;
  /** What config can refer to: the system's objects, actions and events. */
  readonly catalog: () => ConfigCatalog;
  /** Checks `config/` against the config types and this system (P2.04). */
  readonly validateConfig: () => ConfigRead;
  /** The object tables, for the schema check. */
  readonly tables: readonly AnyObjectDefinition["table"][];
  /** Everything in the system, as `system.describe` shows it to an admin. */
  readonly describe: () => SystemDescription;
}

export const defineSystem = (options: SystemOptions): System => {
  const definitions = [
    ...options.objects.flatMap((object) => generateDefinitions(object)),
    ...identityActions,
    historyQuery(options.objects),
    ...logQueries,
    ...identityQueries,
    ...(options.actions ?? []),
  ];
  // config.validate checks against the whole registry, itself included, so
  // it reads the catalog once the registry is built.
  const built: { catalog?: ConfigCatalog } = {};
  const catalogNow = () => {
    if (!built.catalog) {
      throw new Error("The system's registry isn't built yet.");
    }
    return built.catalog;
  };
  const configQueries = options.config ? [configValidateQuery] : [];
  const registry = createRegistry([
    ...definitions,
    ...configQueries,
    describeQuery({
      objects: options.objects,
      definitions: [...definitions, ...configQueries],
    }),
  ]);
  built.catalog = catalogOf(options.objects, registry.list());
  return Object.freeze({
    name: options.name,
    objects: options.objects,
    registry,
    migrations: options.migrations,
    config: options.config,
    catalog: catalogNow,
    validateConfig: () =>
      options.config
        ? validateConfig(options.config, coreConfigTypes, catalogNow())
        : { files: [], problems: [] },
    tables: options.objects.map((object) => object.table),
    describe: () =>
      describeFor(
        { objects: options.objects, definitions: registry.list() },
        allGranted
      ),
  });
};
