# 0052. Computed fields, and the display field

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [0014](0014-field-types.md), whose field types each own columns. A computed field owns none.

## Context

A contact is stored as a first name and a last name, and a reference to that contact has been showing the first text field. Staff want one name, calculated from the parts, and they want to choose which field a reference shows. A person or a company also wants a picture beside that name. An image field does not exist yet, and config still cannot hold logic (section 8).

## Decision

- **A computed field is calculated when a record is read.** It stores nothing. `f.computed({ type, using, fields })` names the result (`text` or `number`) and one operation: `concat`, `coalesce`, `add`, `subtract` or `multiply`. The operation is code, with a result in TypeScript. There is no expression language, and a computed field reads only stored fields on the same record.
- **`concat` joins text, email and url values**, skipping empty ones, with a space unless `separator` says otherwise. **`coalesce` returns the first value that is present**, and zero counts. **`add`, `subtract` and `multiply` combine numbers** and return null when any of them is empty.
- **Create and update omit it.** The record schema includes it. Lists do not sort or filter on it.
- **One field is the display field.** `displayField: true` marks it. A reference, and the record's own title, show that field. With none marked, they show the first text field, as before. A reference cannot be the display field.
- **The display field may name an avatar** with `avatar: "logo"`. That field has to be an image field. Image fields are not built yet, so nothing sets one today. The screen leaves a leading picture in front of the display value for when they are.

## Consequences

- A full name does not need its own column, and it changes whenever the names it reads change. History records those names, not the calculated one.
- Sorting or filtering a large list by a calculated value needs a generated column later. That is a separate decision.
- Adding an image field is enough for avatars: the display field already names the one to show, and the screen already leaves room for it.
