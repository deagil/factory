# Plans

One plan file per phase, with tasks to tick off. The phase goals are in the [README build plan](../../README.md#build-plan); how things work is in [SYSTEM_DESIGN.md](../SYSTEM_DESIGN.md).

| Phase               | Plan                         | Status      |
| ------------------- | ---------------------------- | ----------- |
| 0. Foundations      | [phase-0.md](phase-0.md)     | Done        |
| 1. Walking skeleton | [phase-1.md](phase-1.md)     | Not started |
| 2. Config over git  | Written when phase 1 is done |             |
| 3. CRM, hosted      |                              |             |
| 4. Breadth          |                              |             |

## How to use a plan

**Starting or resuming (agents and people):**

1. Read `AGENTS.md`, then the plan for the current phase (the first row above that isn't done).
2. Read the plan's **Resume here** section and the latest **Log** entries.
3. Pick the first unticked task whose **Needs** are all ticked. If someone else's branch or PR already covers it, pick the next one.
4. Read the sections of `SYSTEM_DESIGN.md` that the task points to before writing code.

**Working a task:**

- One task is one change: one branch, one PR, merged within hours or days. Start it with the task ID in its name: `pnpm fx start "P0.04 db core tables"` makes the branch `change/p0-04-db-core-tables`. Put the ID in the first commit's subject too, as in `feat: core tables (P0.04)`, since `fx ship` makes that the PR title.
- A task is done only when everything under **Done when** is true, tests included.
- If a task turns out to be too big, split it into lettered tasks (P1.08a, P1.08b) in the plan, in the same PR.
- If you make a decision the design doesn't cover, write a decision record in `docs/decisions/` and mention it in the log.
- If you're blocked, leave the box unticked, add `Blocked:` with the reason under the task, and log it.

**Finishing a task, in the same PR:**

1. Tick the box: `- [x]`.
2. Add one line to the plan's **Log**: date, task ID, PR, and anything the next person needs to know.
3. Update **Resume here** if the next step or a known issue has changed.
4. When the last task is ticked, set the phase status above to Done and write the next phase's plan.
