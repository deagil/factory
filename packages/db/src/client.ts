import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgTransaction, PgTransactionConfig } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import type { PoolConfig } from "pg";

import * as schema from "./schema/core.ts";

export type Schema = typeof schema;

/** Creates a typed Drizzle database on its own connection pool. */
export const createDb = (connectionString: string, options?: PoolConfig) => {
  const pool = new Pool({ connectionString, ...options });
  return drizzle({ client: pool, schema });
};

/** A database connection pool. Close it with `closeDb` when done. */
export type Db = ReturnType<typeof createDb>;

/** A database transaction, as passed to `withTransaction` callbacks. */
export type Tx = PgTransaction<
  NodePgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/** Anything that can run a query: the database or a transaction. */
export type Executor = Db | Tx;

/**
 * Runs `work` in one transaction. It commits if `work` resolves and rolls
 * back if it throws. Called on a transaction, it opens a savepoint.
 */
export const withTransaction = <T>(
  executor: Executor,
  work: (tx: Tx) => Promise<T>,
  config?: PgTransactionConfig
): Promise<T> => executor.transaction(work, config);

/** Closes the pool behind a database. */
export const closeDb = (db: Db): Promise<void> => db.$client.end();
