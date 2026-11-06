// Ordering the query builder can't express. The data access layer lives in
// @workspace/objects, which has no raw SQL (AGENTS.md rule 2), so the pieces
// of SQL it needs live here.

import { sql } from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";

/** `column asc nulls last`. */
export const ascNullsLast = (column: AnyColumn): SQL =>
  sql`${column} asc nulls last`;

/** `column desc nulls last`, so empty values come last both ways. */
export const descNullsLast = (column: AnyColumn): SQL =>
  sql`${column} desc nulls last`;
