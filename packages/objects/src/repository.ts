// Repositories: the only way to write records (AGENTS.md rule 1), and only
// inside an action's transaction. Every create and update writes one
// audit_log row in the same transaction, holding the changed fields before
// and after. See docs/SYSTEM_DESIGN.md section 4.8 and decision 0018.

import { isDeepStrictEqual } from "node:util";

import type { Executor } from "@workspace/db";
import { auditLog } from "@workspace/db/schema";
import { and, eq, is } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { RecordOf } from "./dal/data-access.ts";
import type { AnyObjectDefinition } from "./define-object.ts";
import { checkChoice } from "./fields/choice.ts";
import type { ChoiceField, ChoiceOptions } from "./fields/choice.ts";
import type { AnyField } from "./fields/field.ts";

export interface RepositoryOptions {
  /** The action's transaction. Anything else is refused. */
  executor: Executor;
  /** The run, and its step, this write belongs to; audit rows point at them. */
  runId: string;
  stepId: string;
  /** Who is acting: written to created_by, updated_by and audit_log. */
  actorId: string;
  /** The clock, from the action's context. */
  now: () => Date;
  /**
   * The choice options loaded for this run (P2.06). Choice values are
   * checked against them; without them, no choice value is accepted.
   */
  choices?: ChoiceOptions | undefined;
}

/** Field values for a write, by key; `customFields` for staff-added fields. */
export type WriteValues = Record<string, unknown> & {
  customFields?: Record<string, unknown>;
};

export interface UpdateOptions {
  /**
   * Lock the row (`SELECT … FOR UPDATE`) before reading it, so a concurrent
   * update waits instead of failing with a conflict.
   */
  lock?: boolean;
  /** Fail with `conflict` unless the record is at this version. */
  expectedVersion?: number;
}

/** What changed: only the changed fields, by key, with old and new values. */
export interface Changes {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export type UpdateResult<TRecord> =
  | ({ status: "updated"; record: TRecord } & Changes)
  /** Nothing differed, so nothing was written. */
  | { status: "unchanged"; record: TRecord }
  | { status: "not_found" }
  /** Archived records can't be changed. */
  | { status: "archived"; record: TRecord }
  /** The record moved on: another update got there first. */
  | { status: "conflict"; record: TRecord };

export type ArchiveResult<TRecord> =
  | { status: "archived"; record: TRecord }
  | { status: "unchanged"; record: TRecord }
  | { status: "not_found" }
  | { status: "conflict"; record: TRecord };

export type RestoreResult<TRecord> =
  | { status: "restored"; record: TRecord }
  /** It wasn't archived. */
  | { status: "unchanged"; record: TRecord }
  | { status: "not_found" }
  | { status: "conflict"; record: TRecord };

const customFieldsValue = z.record(z.string(), z.json());

const columnOf = (table: PgTable, key: string): PgColumn =>
  (table as unknown as Record<string, PgColumn>)[key] as PgColumn;

type Row = Record<string, unknown>;

/** Checks each value with its field's input rule. */
const parseValues = (object: AnyObjectDefinition, values: WriteValues) => {
  const { customFields, ...fieldValues } = values;
  const parsed: Row = {};
  for (const [key, value] of Object.entries(fieldValues)) {
    if (value === undefined) {
      continue;
    }
    const field = (object.fields as Record<string, AnyField>)[key];
    if (!field) {
      throw new Error(`${object.name} has no field "${key}"`);
    }
    parsed[key] = field.input.parse(value);
  }
  if (customFields !== undefined && !object.customFields) {
    throw new Error(`${object.name} has no custom fields`);
  }
  return {
    fields: parsed,
    customFields:
      customFields === undefined
        ? undefined
        : customFieldsValue.parse(customFields),
  };
};

/**
 * Checks each choice value being written against the loaded options. On an
 * update, `current` is the record as it is, whose archived value may stay.
 */
const checkChoices = (
  object: AnyObjectDefinition,
  values: Row,
  choices: ChoiceOptions | undefined,
  current?: Row
) => {
  for (const [key, value] of Object.entries(values)) {
    const field = (object.fields as Record<string, AnyField>)[key];
    if (field?.kind === "choice") {
      checkChoice(key, field as unknown as ChoiceField, value, {
        choices,
        current: current?.[key],
      });
    }
  }
};

export const createRepository = ({
  executor,
  runId,
  stepId,
  actorId,
  now,
  choices,
}: RepositoryOptions) => {
  if (!is(executor, PgTransaction)) {
    throw new Error(
      "Repositories only run inside an action's transaction. Write data with an action (AGENTS.md rule 1)."
    );
  }
  const db = executor as unknown as {
    insert: (table: PgTable) => {
      values: (values: Row) => { returning: () => Promise<Row[]> };
    };
    update: (table: PgTable) => {
      set: (values: Row) => {
        where: (condition: SQL | undefined) => {
          returning: () => Promise<Row[]>;
        };
      };
    };
    select: () => {
      from: (table: PgTable) => {
        where: (condition: SQL | undefined) => Promise<Row[]> & {
          for: (strength: "update") => Promise<Row[]>;
        };
      };
    };
  };

  const audit = async (
    object: AnyObjectDefinition,
    recordId: string,
    changes: Changes
  ) => {
    await db.insert(auditLog).values({
      object: object.name,
      recordId,
      before: changes.before,
      after: changes.after,
      runId,
      stepId,
      actorId,
      at: now(),
    });
  };

  /** Creates a record, and an audit row with its values. */
  const create = async <TObject extends AnyObjectDefinition>(
    object: TObject,
    values: WriteValues
  ): Promise<RecordOf<TObject>> => {
    const { customFields, ...fieldValues } = values;
    const parsed = object.schemas.create.parse(fieldValues) as Row;
    const extra = parseValues(object, { customFields }).customFields;
    checkChoices(object, parsed, choices);
    const at = now();
    const [row] = await db
      .insert(object.table)
      .values({
        ...object.toRow(parsed),
        ...(extra ? { customFields: extra } : {}),
        createdAt: at,
        updatedAt: at,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();
    const record = object.fromRow(row ?? {});
    const after: Row = {};
    for (const key of Object.keys(object.fields)) {
      if (record[key] !== null) {
        after[key] = record[key];
      }
    }
    for (const [key, value] of Object.entries(extra ?? {})) {
      after[`customFields.${key}`] = value;
    }
    await audit(object, record.id as string, { before: {}, after });
    return record as RecordOf<TObject>;
  };

  /** The current row, locked if asked. */
  const current = async (
    object: AnyObjectDefinition,
    id: string,
    lock: boolean
  ) => {
    const query = db
      .select()
      .from(object.table)
      .where(eq(columnOf(object.table, "id"), id));
    const [row] = await (lock ? query.for("update") : query);
    return row ? object.fromRow(row) : undefined;
  };

  /** Writes `set` if the record is still at `version`; undefined if not. */
  const writeAt = async (
    object: AnyObjectDefinition,
    id: string,
    version: number,
    set: Row
  ) => {
    const [row] = await db
      .update(object.table)
      .set({
        ...set,
        updatedAt: now(),
        updatedBy: actorId,
        version: version + 1,
      })
      .where(
        and(
          eq(columnOf(object.table, "id"), id),
          eq(columnOf(object.table, "version"), version)
        )
      )
      .returning();
    return row ? object.fromRow(row) : undefined;
  };

  /**
   * Changes the fields in `values`. Only fields whose value differs are
   * written and recorded; housekeeping columns are never recorded, and
   * custom fields are compared key by key.
   */
  const update = async <TObject extends AnyObjectDefinition>(
    object: TObject,
    id: string,
    values: WriteValues,
    options: UpdateOptions = {}
  ): Promise<UpdateResult<RecordOf<TObject>>> => {
    const parsed = parseValues(object, values);
    const record = await current(object, id, options.lock ?? false);
    if (!record) {
      return { status: "not_found" };
    }
    const typed = record as RecordOf<TObject>;
    if (record.archivedAt !== null) {
      return { status: "archived", record: typed };
    }
    if (
      options.expectedVersion !== undefined &&
      options.expectedVersion !== record.version
    ) {
      return { status: "conflict", record: typed };
    }

    const changes: Changes = { before: {}, after: {} };
    const changed: Row = {};
    for (const [key, value] of Object.entries(parsed.fields)) {
      if (!isDeepStrictEqual(record[key], value)) {
        changes.before[key] = record[key];
        changes.after[key] = value;
        changed[key] = value;
      }
    }
    const oldCustom = (record.customFields ?? {}) as Row;
    let customFields: Row | undefined;
    for (const [key, value] of Object.entries(parsed.customFields ?? {})) {
      const old = oldCustom[key] ?? null;
      if (!isDeepStrictEqual(old, value)) {
        changes.before[`customFields.${key}`] = old;
        changes.after[`customFields.${key}`] = value;
        customFields = { ...(customFields ?? oldCustom), [key]: value };
      }
    }
    if (Object.keys(changes.after).length === 0) {
      return { status: "unchanged", record: typed };
    }
    checkChoices(object, changed, choices, record);

    const written = await writeAt(object, id, record.version as number, {
      ...object.toRow(changed),
      ...(customFields ? { customFields } : {}),
    });
    if (!written) {
      const latest = await current(object, id, false);
      return {
        status: "conflict",
        record: (latest ?? record) as RecordOf<TObject>,
      };
    }
    await audit(object, id, changes);
    return {
      status: "updated",
      record: written as RecordOf<TObject>,
      ...changes,
    };
  };

  /**
   * Archives a record, with an audit row for `archivedAt` so its history
   * shows it (decision 0035).
   */
  const archive = async <TObject extends AnyObjectDefinition>(
    object: TObject,
    id: string
  ): Promise<ArchiveResult<RecordOf<TObject>>> => {
    const record = await current(object, id, true);
    if (!record) {
      return { status: "not_found" };
    }
    if (record.archivedAt !== null) {
      return { status: "unchanged", record: record as RecordOf<TObject> };
    }
    const written = await writeAt(object, id, record.version as number, {
      archivedAt: now(),
    });
    if (!written) {
      return { status: "conflict", record: record as RecordOf<TObject> };
    }
    await audit(object, id, {
      before: { archivedAt: null },
      after: { archivedAt: written.archivedAt },
    });
    return { status: "archived", record: written as RecordOf<TObject> };
  };

  /** Restores an archived record, with an audit row like archiving's. */
  const restore = async <TObject extends AnyObjectDefinition>(
    object: TObject,
    id: string
  ): Promise<RestoreResult<RecordOf<TObject>>> => {
    const record = await current(object, id, true);
    if (!record) {
      return { status: "not_found" };
    }
    if (record.archivedAt === null) {
      return { status: "unchanged", record: record as RecordOf<TObject> };
    }
    const written = await writeAt(object, id, record.version as number, {
      archivedAt: null,
    });
    if (!written) {
      return { status: "conflict", record: record as RecordOf<TObject> };
    }
    await audit(object, id, {
      before: { archivedAt: record.archivedAt },
      after: { archivedAt: null },
    });
    return { status: "restored", record: written as RecordOf<TObject> };
  };

  return { create, update, archive, restore };
};

/** A repository, as actions get it through `ctx.repo`. */
export type Repository = ReturnType<typeof createRepository>;
