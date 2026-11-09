# 0011. Who actions run as

- **Status:** Superseded by [0045](0045-object-endpoints-and-workflows.md)
- **Date:** 2026-11-06

> **Superseded.** Workflows no longer get permissions derived from their steps. They run under the service key, and the control is the publish gate (validation, example cases) and a second person's approval. Still true: people act as themselves, agents act for a person, fixed `http_send` destinations, and `actor_id` and `origin_user_id` on every row with no `acting_for` or `triggered_by`.

## Context

Actions can be started by a person, an agent working for a person, an integration, or a workflow reacting to something a person did. Running every workflow step with the original person's permissions breaks when the automation legitimately needs more than they have (a support agent cancels a booking; the refund needs finance permission), or when there is no person (schedules). Running workflows as one all-powerful automation actor hides who allowed the behaviour and lets anyone who can edit a workflow borrow powers they do not hold.

## Decision

- **People act as themselves,** checked against their roles. **Agents act for a person,** with permissions no wider than that person's.
- **Each workflow acts as itself** (an automation actor). Its permissions are **derived** from the actions its steps run; nobody writes a role for it.
- **Publish guard:** whoever publishes or approves a workflow must hold every derived permission. Any edit recalculates and re-checks.
- **Manual starts** need permission to run that workflow.
- **Approval rules still apply** to actions inside workflows; the run waits durably (DBOS) for the decision.
- **`http.send` destinations are fixed** in the workflow file, never taken from data, so publishing the workflow is approving where data goes.
- **Every action records `actor_id`** (who performed it) **and `origin_user_id`** (the person at the start of the chain, copied through events and runs), plus `run_id` inside a workflow. These replace `acting_for` and `triggered_by`.
- **Dry run before publish** shows each step, its result and any missing permission. An **authority review** screen lists workflows whose publisher or approver has since lost a permission the workflow uses.

## Consequences

- The question "may this happen?" is answered once, at publish time, by a named person who holds the power; the question "who started this?" is answered on every row.
- Staff can trigger automation that does more than they can do directly, but only automation that someone with that power approved.
- Removing someone's permission does not silently break running workflows; the authority review makes the follow-up visible.
- The permission derivation must cover every action, including module actions, so it is built into the action registry rather than per workflow.
