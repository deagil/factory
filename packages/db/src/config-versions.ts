// config_versions: what the config loader records each time it
// tries a version of `config/`. Only the loader writes it.
import { desc } from "drizzle-orm";

import type { Executor } from "./client.ts";
import type { configVersionStatuses } from "./schema/core.ts";
import { configVersions } from "./schema/core.ts";

export type ConfigVersionStatus = (typeof configVersionStatuses)[number];

export interface ConfigVersionRow {
  readonly sha: string;
  readonly status: ConfigVersionStatus;
  /** The problems, when the version was refused. */
  readonly errors: unknown;
}

/** Records one attempt to load a version of config. */
export const recordConfigVersion = async (
  db: Executor,
  version: ConfigVersionRow
): Promise<void> => {
  await db.insert(configVersions).values({
    sha: version.sha,
    status: version.status,
    errors: version.errors ?? null,
  });
};

/** The versions the loader tried, newest first. */
export const listConfigVersions = (db: Executor, limit = 20) =>
  db
    .select()
    .from(configVersions)
    .orderBy(desc(configVersions.loadedAt), desc(configVersions.id))
    .limit(limit);
