# @workspace/events

Events record what happened; workflows are the only listeners (SYSTEM_DESIGN §4.7).

**Status:** the dispatcher (P2.19). Events are written to `event_log` by the pipeline and the workflow runner, in the transaction of the change they record.

- **`createDispatcher({ db, runner, clock, config })`** reads `event_log` rows not yet dispatched, oldest first, and starts one run of each workflow whose `starts_when` names the event and whose `when` conditions hold on its payload (`event.…`, including a declared choice field's columns). Each run gets the event's origin user, the emitting run as `parent_run_id` and one more depth than the event, so a loop of workflows stops at the runner's depth limit with a failed run saying why. A unique index on runs (`endpoint`, `event_id`) makes each start happen once, however many dispatchers read the event.
- **Schedules:** `tick(now)` starts each workflow whose `{ schedule }` cron fields match the minute, once (`runs.scheduled_for` is unique per workflow).
- `run(intervalMs)` does both on a timer; `drain()` dispatches until nothing is left, for tests. `createServer` runs it. Its tests are in `examples/crm/src/events.test.ts`, on a real system.
