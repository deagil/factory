// The dispatcher (P2.19; SYSTEM_DESIGN §4.7, decision 0046): reads new
// `event_log` rows, oldest first, and starts one run per event and workflow
// whose `starts_when` names it and whose conditions hold on its payload. Each
// run gets the event's origin user, the emitting run as its parent and one
// more depth than the event, so a chain of workflows stops at the runner's
// limit with a failed run saying why. The runs table's unique index makes
// each start happen once, however many dispatchers read the same event.
// Schedules start runs too, once for each minute their cron fields match.
import type { Clock, ConfigService } from "@workspace/actions";
import { markDispatched, undispatchedEvents } from "@workspace/db";
import type { Db, EventRow } from "@workspace/db";
import { cronMatches, definitionOf, startsOn } from "@workspace/workflows";
import type {
  FieldSpecs,
  Runner,
  WorkflowDefinition,
  WorkflowRunOptions,
} from "@workspace/workflows";
import type { z } from "zod";

export interface DispatcherOptions {
  readonly db: Db;
  readonly runner: Runner;
  readonly clock: Clock;
  /** The config runs pin, read once per batch: a pinned snapshot. */
  readonly config: () => ConfigService;
  /** Payload schemas of the system's own events, for `emit`. */
  readonly events?: ReadonlyMap<string, z.ZodType>;
  /** Events read at a time. */
  readonly batch?: number;
  /** Where a dispatch that threw is reported; the console by default. */
  readonly log?: (line: string) => void;
}

/** What one version of config has for the dispatcher. */
const workflowsIn = (config: ConfigService) => {
  const definitions = new Map<string, WorkflowDefinition>(
    (config.workflows ?? []).map((entry) => [entry.key, definitionOf(entry)])
  );
  // The events workflows declare, with their fields, for choice columns.
  const specs = new Map<string, FieldSpecs>();
  for (const workflow of definitions.values()) {
    for (const [type, fields] of Object.entries(workflow.events ?? {})) {
      specs.set(type, fields);
    }
  }
  return { definitions, specs };
};

/** The minute `date` falls in. */
const minuteOf = (date: Date) =>
  new Date(Math.floor(date.getTime() / 60_000) * 60_000);

export const createDispatcher = ({
  db,
  runner,
  clock,
  config: configNow,
  events,
  batch = 100,
  log = (line) => console.error(line),
}: DispatcherOptions) => {
  let lastMinute = 0;

  /** Runs `workflow` as `start`; a throw is logged, not passed on. */
  const start = async (
    workflow: WorkflowDefinition,
    options: WorkflowRunOptions
  ) => {
    try {
      await runner.run(workflow, {}, options);
    } catch (error) {
      log(`dispatch of ${workflow.key} failed: ${String(error)}`);
    }
  };

  /** Starts the workflows `event` starts. */
  const dispatchOne = async (
    event: EventRow,
    config: ConfigService,
    { definitions, specs }: ReturnType<typeof workflowsIn>
  ) => {
    const eventSpecs = specs.get(event.type);
    const started = [...definitions.values()].filter((workflow) =>
      startsOn(workflow, event, config, eventSpecs)
    );
    for (const workflow of started) {
      // One after another, so a later run sees what an earlier one did.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await start(workflow, {
        originUserId: event.originUserId,
        config,
        workflows: definitions,
        ...(events ? { events } : {}),
        start: {
          event: { id: event.id, payload: event.payload },
          eventSpecs,
          parentRunId: event.runId,
          depth: event.depth + 1,
        },
      });
    }
  };

  /** Dispatches one batch of new events; how many there were. */
  const dispatch = async () => {
    const rows = await undispatchedEvents(db, batch);
    if (rows.length === 0) {
      return 0;
    }
    const config = configNow();
    const found = workflowsIn(config);
    for (const event of rows) {
      // Events go in the order they happened.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await dispatchOne(event, config, found);
      // oxlint-disable-next-line eslint/no-await-in-loop
      await markDispatched(db, [event.id], clock.now());
    }
    return rows.length;
  };

  /**
   * Dispatches until no event is left, including those the runs it starts
   * emit; for tests and shutdown.
   */
  const drain = async () => {
    let total = 0;
    let count = await dispatch();
    while (count > 0) {
      total += count;
      // Each batch may emit the next.
      // oxlint-disable-next-line eslint/no-await-in-loop
      count = await dispatch();
    }
    return total;
  };

  /** Starts each scheduled workflow due in `now`'s minute, once a minute. */
  const tick = async (now: Date = clock.now()) => {
    const minute = minuteOf(now);
    if (minute.getTime() === lastMinute) {
      return 0;
    }
    lastMinute = minute.getTime();
    const config = configNow();
    const { definitions } = workflowsIn(config);
    const due = [...definitions.values()].filter((workflow) => {
      const starts = workflow.starts_when;
      return (
        typeof starts === "object" &&
        "schedule" in starts &&
        cronMatches(starts.schedule, minute)
      );
    });
    for (const workflow of due) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await start(workflow, {
        originUserId: null,
        config,
        workflows: definitions,
        ...(events ? { events } : {}),
        start: { scheduledFor: minute },
      });
    }
    return due.length;
  };

  /** Dispatches and ticks every `intervalMs` until the returned stop. */
  const run = (intervalMs: number) => {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        await drain();
        await tick();
      } catch (error) {
        log(`dispatcher: ${String(error)}`);
      } finally {
        busy = false;
      }
    }, intervalMs);
    return () => clearInterval(timer);
  };

  return { dispatch, drain, tick, run };
};

export type Dispatcher = ReturnType<typeof createDispatcher>;
