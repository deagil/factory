// The durable engine (P2.20; decision 0046): DBOS Transact, on the system's
// own Postgres in the `dbos` schema. A run that may pause or reach another
// system is one DBOS workflow, `factory_run`. Each segment, each attempt at
// an external step and each wait is a DBOS step or sleep, so after a
// restart DBOS replays what finished and carries on from there.
//
// DBOS is one per process, so this module keeps it: runners attach a host
// under their system's name, the first to need DBOS launches it, and the
// last to detach shuts it down. A run carries its host's name, so a run a
// restart recovers finds the runner that took over.
import { DBOS } from "@dbos-inc/dbos-sdk";

import type { RunStart } from "./run.ts";
import type { WorkflowDefinition } from "./schema.ts";

/** What a run's DBOS workflow gets: plain JSON DBOS stores with it. */
export interface DurableArgs {
  /** The system's name: which attached runner drives the run. */
  readonly host: string;
  readonly runId: string;
  /** A new run's start; a run picked up again reads its checkpoint. */
  readonly begin?: {
    readonly definition: WorkflowDefinition;
    readonly input: unknown;
    readonly originUserId: string | null;
    readonly retryKey?: string | undefined;
    readonly start?: RunStart | undefined;
  };
}

/** What a run's DBOS workflow returns; the runner's `WorkflowResult`. */
type Drive = (args: DurableArgs) => Promise<unknown>;

const hosts = new Map<string, Drive>();
const attached = new Set<symbol>();
let engine: {
  readonly url: string;
  readonly ready: Promise<void>;
  readonly run: Drive;
} | null = null;

/** Lets runs named `name` be driven by `drive`; returns how to stop. */
export const attach = (name: string, drive: Drive) => {
  const token = Symbol(name);
  hosts.set(name, drive);
  attached.add(token);
  return async () => {
    attached.delete(token);
    if (hosts.get(name) === drive) {
      hosts.delete(name);
    }
    if (attached.size === 0 && engine) {
      const stopping = engine;
      engine = null;
      await stopping.ready.catch(() => undefined);
      await DBOS.shutdown({ deregister: true });
    }
  };
};

/**
 * Launches DBOS on `databaseUrl` if it isn't running, which recovers the
 * runs a stop left unfinished. One database per process.
 */
export const launch = (databaseUrl: string): Promise<void> => {
  if (engine) {
    if (engine.url !== databaseUrl) {
      throw new Error(
        "DBOS already runs on another database in this process; durable runs need one database per process."
      );
    }
    return engine.ready;
  }
  const run = DBOS.registerWorkflow(
    (args: DurableArgs) => {
      const drive = hosts.get(args.host);
      if (!drive) {
        throw new Error(`No runner is attached for ${args.host}.`);
      }
      return drive(args);
    },
    { name: "factory_run" }
  );
  DBOS.setConfig({
    name: "factory",
    systemDatabaseUrl: databaseUrl,
    logLevel: "warn",
  });
  const ready = DBOS.launch().catch((error: unknown) => {
    engine = null;
    throw error;
  });
  engine = { url: databaseUrl, ready, run };
  return ready;
};

/** Starts a run's DBOS workflow, or finds the one already started with `id`. */
export const startDurable = async (id: string, args: DurableArgs) => {
  if (!engine) {
    throw new Error("DBOS isn't launched: call launch first.");
  }
  await engine.ready;
  return DBOS.startWorkflow(engine.run, { workflowID: id })(args);
};

/** A checkpointed step: after a restart, its recorded result comes back. */
export const durableStep = <T>(name: string, work: () => Promise<T>) =>
  DBOS.runStep(work, { name });

/** A sleep a restart doesn't lose: it wakes when it would have. */
export const durableSleep = (ms: number) => DBOS.sleep(Math.max(0, ms));
