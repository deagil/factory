# 0006. Choice fields: system, mapped, custom

- **Status:** Accepted
- **Date:** 2026-11-06

## Context

Dropdown values are sometimes relied on by code and sometimes purely business labels. Letting staff delete a value code depends on breaks the system; freezing values code ignores slows staff down.

## Decision

One choice field type with three levels of control. `system`: code acts on each value; staff can only rename labels; new values ship with the code that handles them. `mapped`: code acts on a few categories (for example open, won, lost); staff add, rename and reorder options, each in a category. `custom`: code does not act on the values; staff own them. Options in use are archived, never deleted.

## Consequences

- Whether staff can add a value follows where the behaviour that uses it lives.
- A new mapped option and the workflow that uses it are published in one draft.
