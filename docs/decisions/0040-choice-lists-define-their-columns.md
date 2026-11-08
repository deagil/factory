# 0040. Choice lists define their columns

- **Status:** Accepted
- **Date:** 2026-11-08
- **Amends:** [0039](0039-choice-fields.md), whose fields had a `control` and whose options had a fixed `category`.

## Context

Decision 0039 gave every option the same shape: key, label, an optional `category` and an archived flag. The field said what staff could change through `control` (`system`, `mapped` or `custom`), and `mapped` meant "code acts on the category". That covers deal stages, but not a list whose rows carry other values code or config acts on, such as a subscription type with an `enableReports` flag and a seat limit. It also put the contract on the field, so two fields sharing a list could each declare different categories.

Staff don't change a list's structure; they change its rows, including the values in a row's columns.

## Decision

- **A list is defined in code with `defineChoiceList({ key, columns, keys })`.** `columns` are the list's own, each a Zod schema, such as `{ category: z.enum(["open", "won", "lost"]) }`. `keys`, when given, are the keys code acts on: the list must have exactly those, none archived, and a field on the list takes only those keys, typed. A list with neither is free for staff to change.
- **Every option has the built-in columns:** `key`, `label`, an optional `description` (plain text, at most 500 characters, for hints, tooltips and agents) and `archived`. `color` and `default` are reserved for the core too, so `defineChoiceList` refuses a column with any of these six names.
- **`f.choice(list, options)` takes the definition**, and `control` and `categories` go. `category` is no longer special: deal stages declare it as their own column.
- **The rows stay in `config/choices/<list>.yaml`, flat:** `{ key: lead, label: Lead, category: open }`. validateConfig checks each row against its list's definition, with the file and line, and refuses columns the list doesn't define. A list file no code defines may have the built-in columns only. Two different definitions with one key are refused when the system starts.
- **`ctx.config.choice(list).get(key)` takes the definition** and returns the option with its columns typed.
- **The `category` filter becomes `where`:** `{ stage: { where: { category: "open" } } }` matches every option with those column values, archived ones included.
- **`system.describe` gives each option's description and its own column values,** and each choice field's columns as JSON Schema (`optionColumns`), so screens and config editors can show them.

## Consequences

- A new column is a code change, shipped with whatever reads it. Staff edit the values in config, through drafts and approval rules like any other config change.
- Changing a list's columns works like a migration: code and config go live separately, so add a column as optional, fill it in, then make it required. Remove one in the opposite order.
- Workflow and approval conditions (P2.09, P2.11) can test a choice field's column, such as `stage.category`, and validateConfig can check the column exists and the value fits its schema.
