// A workflow in words: what starts it, a condition, where a value comes
// from and how long a wait is. Every sentence is built from the file alone,
// so the same file always reads the same way.
import type {
  Condition,
  FieldSpec,
  Source,
  StartsWhen,
  WorkflowDefinition,
} from "@workspace/workflows";

/** `check_reason` → "check reason". */
export const plain = (name: string) => name.replaceAll("_", " ");

/** `check_reason` → "Check reason". */
export const titleOf = (name: string) => {
  const words = plain(name);
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const vowel = /^[aeiou]/u;

/** "a deal", "an organisation". */
export const withArticle = (noun: string) =>
  `${vowel.test(noun) ? "an" : "a"} ${noun}`;

/** "a", "a or b", "a, b or c". */
export const listOf = (items: readonly string[], joiner = "or"): string => {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1) ?? ""}`;
};

// ---------------------------------------------------------------------------
// Values

/** A fixed value as the file holds it: text in quotes, yes and no, nothing. */
export const fixedWords = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "nothing";
  }
  if (typeof value === "string") {
    return `“${value}”`;
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
};

/** `[record, stage]` → "the record's stage". */
const possessive = (names: readonly string[]) =>
  `the ${names.map(plain).join("'s ")}`;

export interface PathParts {
  root: "input" | "event" | "step";
  /** The step read, when the root is a step. */
  step: string | null;
  /** The names below the root, or below the step's output. */
  names: string[];
}

/** `steps.load.output.record.stage` → the step `load` and `[record, stage]`. */
export const pathParts = (path: string): PathParts => {
  const [root, ...rest] = path.split(".");
  if (root === "steps") {
    const [step = "", , ...names] = rest;
    return { root: "step", step, names };
  }
  return {
    root: root === "event" ? "event" : "input",
    step: null,
    names: rest,
  };
};

const whole = { input: "the input", event: "the event" } as const;

const stepWords = (parts: PathParts) => {
  const from = `the step ${titleOf(parts.step ?? "")}`;
  return parts.names.length === 0
    ? `the output of ${from}`
    : `${possessive(parts.names)} from ${from}`;
};

/** "the deal from the input", "the record's stage from the step Load". */
export const pathWords = (path: string): string => {
  const parts = pathParts(path);
  if (parts.root === "step") {
    return stepWords(parts);
  }
  const where = whole[parts.root];
  return parts.names.length === 0
    ? where
    : `${possessive(parts.names)} from ${where}`;
};

/**
 * A path as a condition names it: the input or the event is the subject
 * already, so "the stage's category", but a step is still named.
 */
export const fieldWords = (path: string): string => {
  const parts = pathParts(path);
  if (parts.root === "step" || parts.names.length === 0) {
    return pathWords(path);
  }
  return possessive(parts.names);
};

/** Where a value comes from: a path, or a fixed value. */
export const sourceWords = (source: Source): string =>
  "from" in source ? pathWords(source.from) : fixedWords(source.value);

// ---------------------------------------------------------------------------
// Conditions

/** A value a condition compares with: a choice key reads without quotes. */
const comparedWords = (value: unknown) =>
  typeof value === "string" ? plain(value) : fixedWords(value);

const many = (value: unknown) =>
  listOf(Array.isArray(value) ? value.map(comparedWords) : []);

const operatorWords: Record<string, (value: unknown) => string> = {
  is: (value) => `is ${comparedWords(value)}`,
  is_not: (value) => `is not ${comparedWords(value)}`,
  one_of: (value) => `is one of ${many(value)}`,
  not_one_of: (value) => `is not one of ${many(value)}`,
  above: (value) => `is above ${fixedWords(value)}`,
  at_least: (value) => `is at least ${fixedWords(value)}`,
  below: (value) => `is below ${fixedWords(value)}`,
  at_most: (value) => `is at most ${fixedWords(value)}`,
  empty: (value) => (value === false ? "is not empty" : "is empty"),
};

const operatorNames = Object.keys(operatorWords);

/** "the stage's category is lost". */
export const conditionWords = (condition: Condition): string => {
  const given: Record<string, unknown> = condition;
  const operator = operatorNames.find((name) => Object.hasOwn(given, name));
  const words = operator ? operatorWords[operator] : undefined;
  const subject = fieldWords(condition.field);
  return words && operator
    ? `${subject} ${words(given[operator])}`
    : `${subject} has no test`;
};

/** Every condition must hold, so they join with "and". */
export const conditionsWords = (conditions: readonly Condition[]): string =>
  conditions.map(conditionWords).join(" and ");

// ---------------------------------------------------------------------------
// Durations

const units: Record<string, string> = {
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
};

/** `3d` → "3 days". Anything else is shown as written. */
export const durationWords = (duration: string): string => {
  const match = /^(?<count>[1-9][0-9]*)(?<unit>[smhdw])$/u.exec(duration);
  const unit = units[match?.groups?.unit ?? ""];
  const count = Number(match?.groups?.count);
  if (!unit || !Number.isFinite(count)) {
    return duration;
  }
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
};

// ---------------------------------------------------------------------------
// Schedules

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const whole59 = /^[0-9]{1,2}$/u;

const numberIn = (field: string | undefined, max: number) => {
  if (field === undefined || !whole59.test(field)) {
    return null;
  }
  const value = Number(field);
  return value <= max ? value : null;
};

const two = (value: number) => String(value).padStart(2, "0");

/** The day part of a schedule that runs at one time: "Every weekday". */
const dayWords = (
  dayOfMonth: string,
  month: string,
  dayOfWeek: string
): string | null => {
  if (month !== "*") {
    return null;
  }
  const date = numberIn(dayOfMonth, 31);
  if (dayOfWeek === "*") {
    if (dayOfMonth === "*") {
      return "Every day";
    }
    return date === null ? null : `On day ${date} of every month`;
  }
  if (dayOfMonth !== "*") {
    return null;
  }
  if (dayOfWeek === "1-5") {
    return "Every weekday";
  }
  const day = days[numberIn(dayOfWeek, 7) ?? -1];
  return day ? `Every ${day}` : null;
};

/** The viewer's time for an hour and minute of UTC, or null if it is UTC. */
export const localTime = (
  hour: number,
  minute: number,
  timeZone?: string
): string | null => {
  const at = new Date(Date.UTC(2026, 0, 15, hour, minute));
  const format = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  });
  const text = format.format(at);
  return text.endsWith("UTC") || text.endsWith("GMT") ? null : text;
};

const fieldNames = ["minute", "hour", "day of month", "month", "day of week"];

/** A schedule this can't phrase: its five fields, each named. */
const namedFields = (fields: readonly string[]) =>
  `On the schedule ${fieldNames
    .map((name, index) => `${name} ${fields[index] ?? "?"}`)
    .join(", ")} (UTC)`;

const everyMinutes = /^\*\/(?<count>[1-9][0-9]?)$/u;

const withinTheHour = (minute: string): string | null => {
  if (minute === "*") {
    return "Every minute";
  }
  const step = everyMinutes.exec(minute)?.groups?.count;
  if (step) {
    return `Every ${step} minutes`;
  }
  const past = numberIn(minute, 59);
  if (past === null) {
    return null;
  }
  return past === 0 ? "Every hour, on the hour" : `Every hour at ${past} past`;
};

export interface ScheduleWords {
  /** The schedule in UTC, as the file holds it. */
  text: string;
  /** The same time where the viewer is, when it differs and can be said. */
  local: string | null;
}

/** "Every weekday at 09:00 UTC", with the viewer's time beside it. */
export const scheduleWords = (
  schedule: string,
  timeZone?: string
): ScheduleWords => {
  const fields = schedule.trim().split(/\s+/u);
  const [minute = "", hour = "", dayOfMonth = "", month = "", dayOfWeek = ""] =
    fields;
  const everyDay = dayOfMonth === "*" && month === "*" && dayOfWeek === "*";
  if (hour === "*") {
    const text = everyDay ? withinTheHour(minute) : null;
    return { text: text ?? namedFields(fields), local: null };
  }
  const at = { hour: numberIn(hour, 23), minute: numberIn(minute, 59) };
  const when = dayWords(dayOfMonth, month, dayOfWeek);
  if (at.hour === null || at.minute === null || when === null) {
    return { text: namedFields(fields), local: null };
  }
  return {
    text: `${when} at ${two(at.hour)}:${two(at.minute)} UTC`,
    local: localTime(at.hour, at.minute, timeZone),
  };
};

// ---------------------------------------------------------------------------
// What starts a workflow

const recordEvents: Record<string, string> = {
  created: "is created",
  updated: "is updated",
  archived: "is archived",
  restored: "is restored",
};

const recordEvent =
  /^(?<object>[a-z0-9_]+)_(?<verb>created|updated|archived|restored)$/u;

/** "a deal is updated" for a record's own events; the event's name otherwise. */
export const eventWords = (event: string): string => {
  const groups = recordEvent.exec(event)?.groups;
  const happens = recordEvents[groups?.verb ?? ""];
  return groups?.object && happens
    ? `${withArticle(plain(groups.object))} ${happens}`
    : plain(event);
};

export interface StartWords {
  text: string;
  /** A schedule's time where the viewer is. */
  local: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isConditions = (value: unknown): value is Condition[] =>
  Array.isArray(value) &&
  value.every((each) => isRecord(each) && typeof each.field === "string");

const eventStart = (event: string, when: unknown): string => {
  const base = `When ${eventWords(event)}`;
  return isConditions(when) && when.length > 0
    ? `${base}, if ${conditionsWords(when)}`
    : base;
};

/**
 * What starts a workflow, as a sentence. Takes the value loosely, since the
 * list gives it before the definition has loaded.
 */
export const startWords = (
  starts: StartsWhen | unknown,
  timeZone?: string
): StartWords => {
  if (starts === "called") {
    return { text: "When someone runs it", local: null };
  }
  if (isRecord(starts) && typeof starts.event === "string") {
    return { text: eventStart(starts.event, starts.when), local: null };
  }
  if (isRecord(starts) && typeof starts.schedule === "string") {
    return scheduleWords(starts.schedule, timeZone);
  }
  return { text: "Unknown start", local: null };
};

// ---------------------------------------------------------------------------
// What it takes, gives back and can fail with

/** What a field holds: "text", "a deal", "one of deal stages". */
export const fieldTypeWords = (spec: FieldSpec): string => {
  if (spec.type === "ref") {
    return withArticle(plain(spec.object));
  }
  if (spec.type === "choice") {
    return `one of ${plain(spec.list)}`;
  }
  return spec.type === "boolean" ? "yes or no" : spec.type;
};

export interface FactRow {
  name: string;
  words: string;
}

export interface WorkflowFacts {
  input: FactRow[];
  output: FactRow[];
  errors: FactRow[];
}

const inputRow = ([name, spec]: [string, FieldSpec]): FactRow => ({
  name,
  words: `${fieldTypeWords(spec)}${spec.optional ? ", optional" : ""}`,
});

/** The workflow's input fields, its output and its errors, each in words. */
export const workflowFacts = (
  definition: WorkflowDefinition | null
): WorkflowFacts => ({
  input: Object.entries(definition?.input ?? {}).map(inputRow),
  output: Object.entries(definition?.output ?? {}).map(([name, source]) => ({
    name,
    words: sourceWords(source),
  })),
  errors: Object.entries(definition?.errors ?? {}).map(([name, words]) => ({
    name,
    words,
  })),
});
