// Events and the workflows they start: what a workflow sets off next, what
// happens when a record changes, and the actions a step can run.
import { eventWords, plain, titleOf } from "./workflow-words.ts";

export const eventListKey = "event_list";
export const actionListKey = "action_list";

/** One row of `event_list`. */
export interface EventListItem {
  type: string;
  payload:
    | { kind: "fields"; fields: Record<string, Record<string, unknown>> }
    | { kind: "schema"; schema: unknown };
  from: { kind: "object" | "action" | "workflow"; name: string };
  /** The workflows this event starts. */
  workflows: string[];
}

/** One row of `action_list`. */
export interface ActionListItem {
  name: string;
  description: string;
  kind: "internal" | "external";
  input: unknown;
  output: unknown;
  errors: Record<string, string>;
  emits: string[];
  read_only?: true;
  fixed_inputs?: string[];
  object?: string;
}

/** The caller's roles name this read-only workflow. */
export const mayCall = (
  workflows: readonly { key: string }[] | undefined,
  key: string
) => workflows?.some((workflow) => workflow.key === key) ?? false;

export interface Started {
  key: string;
  label: string;
}

export interface EventStarts {
  type: string;
  /** "When a deal is updated", "When deal stage changed". */
  heading: string;
  workflows: Started[];
}

const started = (
  keys: readonly string[],
  labels: ReadonlyMap<string, string>
): Started[] =>
  keys.map((key) => ({ key, label: labels.get(key) ?? titleOf(key) }));

const startsOf = (
  type: string,
  events: readonly EventListItem[],
  labels: ReadonlyMap<string, string>
): EventStarts => ({
  type,
  heading: `When ${eventWords(type)}`,
  workflows: started(
    events.find((event) => event.type === type)?.workflows ?? [],
    labels
  ),
});

/** Each event a workflow emits, with the workflows it starts. */
export const startedBy = (
  emits: readonly string[],
  events: readonly EventListItem[],
  labels: ReadonlyMap<string, string>
): EventStarts[] => emits.map((type) => startsOf(type, events, labels));

const recordVerbs = ["created", "updated", "archived", "restored"] as const;

/** An object's four generated events, with the workflows each one starts. */
export const whatHappensWhen = (
  object: string,
  events: readonly EventListItem[],
  labels: ReadonlyMap<string, string>
): EventStarts[] =>
  recordVerbs.map((verb) => startsOf(`${object}_${verb}`, events, labels));

/** Where an event comes from, in words. */
export const eventSource = (from: EventListItem["from"]): string => {
  switch (from.kind) {
    case "object": {
      return `Records of ${plain(from.name)}`;
    }
    case "action": {
      return `The action ${plain(from.name)}`;
    }
    case "workflow": {
      return `The workflow ${plain(from.name)}`;
    }
    default: {
      const never: never = from.kind;
      return never;
    }
  }
};

/** An event's payload as the page's JSON box shows it. */
export const payloadOf = (payload: EventListItem["payload"]): unknown =>
  payload.kind === "fields" ? payload.fields : payload.schema;

/** A lookup from a workflow's key to its label. */
export const labelsOf = (
  workflows: readonly { key: string; label: string }[] | undefined
): Map<string, string> =>
  new Map((workflows ?? []).map((workflow) => [workflow.key, workflow.label]));
