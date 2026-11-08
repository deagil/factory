# 0039. Choice fields

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

SYSTEM_DESIGN §4.5 describes choice fields: a record stores an option key, staff manage the options in `config/choices/<list>.yaml`, and the field's `control` (`system`, `mapped` or `custom`) decides what staff may change. Options change at run time with config (decision 0038), so a value can't be checked by the field's Zod input alone, and the rules on what staff may change have to hold before a version goes live.

## Decision

- **`f.choice(list, { control, keys?, categories? })` stores the key in a text column.** A `system` field's input is `z.enum(keys)`, so code gets the keys as a type. `mapped` and `custom` inputs only check the key's shape. `mapped` declares its `categories`.
- **The repository checks every choice value it writes against the options pinned for the run** (`RepositoryOptions.choices`, from `ConfigService.choices`). An unknown key is refused, and so is an archived one, unless it is the value the record already has, so archived options stay valid on existing records. An update checks only the fields it changes. The pipeline turns a refusal into a `validation` failure on that field. With no options loaded, a choice value is refused rather than let through.
- **`validateConfig` holds each list to its fields' control.** A list a field uses must exist. `system`: the options are exactly the field's keys, none archived (staff may rename labels). `mapped`: every option has one of the field's categories. `custom`: no rules. The catalog's `choiceFields` say which object field uses which list, built by `@workspace/server`.
- **Config refers to an option as `list.option`** (reference kind `choice`). It must exist and not be archived, so archiving an option that config still uses is refused with the file and line of the use.
- **Filters:** `eq`, `ne`, `in` and `isNull` by key, and for `mapped` fields `category`, which reads the pinned options to find that category's keys.
- **Handlers read options through `ctx.config.choices(list)`.** The `ctx.config.choice(list).get(key)` helper in SYSTEM_DESIGN §4.2 comes with its first user, `deal.moveStage` (P2.07).

## Consequences

- A list is a file, `config/choices/<list>.yaml`; the CRM's `organisation.industry` uses `config/choices/industries.yaml`.
- `validateConfig` doesn't read data, so deleting an option that records still hold isn't caught. Those records keep the key, which the screens show as is, and they can still be saved as long as the field isn't changed. Archive options instead, as §4.5 says.
- A `system` field's new key ships in the same change as the code that handles it, and the list file has to gain it in that change too.
