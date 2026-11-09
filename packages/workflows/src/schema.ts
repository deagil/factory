// A workflow's shape (P2.16, decision 0048): `config/workflows/<key>.yaml`
// for client processes, and `defineWorkflow` in TypeScript for the core's
// and modules', in the same shape. The schema checks the shape alone;
// `validateWorkflow` checks that it lines up with the system.
import { z } from "zod";

import { fieldSpecSchema, snakeCase } from "./fields.ts";
import type { FieldSpecs } from "./fields.ts";

/**
 * Where a value comes from: `input.<field>`, `event.<field>` or
 * `steps.<id>.output.<field>`, each with any path below it.
 */
export const pathSchema = z
  .string()
  .regex(
    /^(?:input|event|steps)(?:\.[A-Za-z0-9_]+)+$/u,
    "A path starts with input., event. or steps.<id>.output., such as input.deal"
  );

/** A value: `from` a path, or a fixed `value` written in the file. */
export const sourceSchema = z.union([
  z.strictObject({ from: pathSchema }),
  z.strictObject({ value: z.json() }),
]);
export type Source = z.infer<typeof sourceSchema>;

/** An input name of an action: snake_case, or a phase 1 camelCase field. */
const inputName = z.string().regex(/^[a-z][a-zA-Z0-9_]*$/u);

/** The input a step gives an action, a workflow or an event. */
const withSchema = z.record(inputName, sourceSchema);

export const conditionOperators = [
  "is",
  "is_not",
  "one_of",
  "not_one_of",
  "above",
  "at_least",
  "below",
  "at_most",
  "empty",
] as const;
export type ConditionOperator = (typeof conditionOperators)[number];

/**
 * One test: a field, an operator and a value, such as
 * `{ field: input.stage.category, is: lost }`. No expressions.
 */
export const conditionSchema = z
  .strictObject({
    field: pathSchema,
    is: z.json().optional(),
    is_not: z.json().optional(),
    one_of: z.array(z.json()).min(1).optional(),
    not_one_of: z.array(z.json()).min(1).optional(),
    above: z.number().optional(),
    at_least: z.number().optional(),
    below: z.number().optional(),
    at_most: z.number().optional(),
    /** `true`: the field has no value (null, missing or blank text). */
    empty: z.boolean().optional(),
  })
  .superRefine((condition, ctx) => {
    const given = conditionOperators.filter((operator) =>
      Object.hasOwn(condition, operator)
    );
    if (given.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `Give one operator: ${conditionOperators.join(", ")}.${given.length > 1 ? ` This gives ${given.join(" and ")}.` : ""}`,
      });
    }
  });
export type Condition = z.infer<typeof conditionSchema>;

/** The operator a condition uses, and its value. */
export const operatorOf = (
  condition: Condition
): { operator: ConditionOperator; value: unknown } => {
  const operator =
    conditionOperators.find((each) => Object.hasOwn(condition, each)) ?? "is";
  return { operator, value: condition[operator] };
};

/** `30s`, `15m`, `2h`, `3d` or `1w`. */
export const durationSchema = z
  .string()
  .regex(
    /^[1-9][0-9]*[smhdw]$/u,
    "A duration is a number and a unit: s, m, h, d or w, such as 3d"
  );

const approvalSchema = z.strictObject({
  /** The role whose members approve. */
  approver: snakeCase,
  /** How many different people must approve. One by default. */
  approvals: z.int().min(1).optional(),
  /** Only runs whose caller has one of these roles ask. */
  requester: z.array(snakeCase).min(1).optional(),
  /** Runs whose caller has one of these roles go straight on. */
  exempt: z.array(snakeCase).min(1).optional(),
  /** Ask only when every condition holds. */
  when: z.array(conditionSchema).min(1).optional(),
  /** What approvers are told. */
  message: z.string().min(1).optional(),
});

/** What happens when a step fails after a commit (decision 0046). */
export type OnFailure = "leave" | readonly Step[];

interface Identified {
  /** Unique in the workflow: part of each step's retry key and trace. */
  readonly id: string;
  readonly on_failure?: OnFailure | undefined;
}

export interface ActionStep extends Identified {
  readonly action: string;
  readonly with?: Readonly<Record<string, Source>> | undefined;
}

export interface IfStep extends Identified {
  /** Every condition must hold for `then`; otherwise `else`, if any. */
  readonly if: readonly Condition[];
  readonly then: readonly Step[];
  readonly else?: readonly Step[] | undefined;
}

export interface WaitStep {
  readonly id: string;
  readonly wait: { readonly for: string } | { readonly until: Source };
}

export interface ApprovalStep extends Identified {
  readonly wait_for_approval: z.infer<typeof approvalSchema>;
}

export interface RunStep extends Identified {
  /** Another workflow, which the parent waits for. */
  readonly run: string;
  readonly with?: Readonly<Record<string, Source>> | undefined;
}

export interface EmitStep {
  readonly id: string;
  readonly emit: string;
  readonly with?: Readonly<Record<string, Source>> | undefined;
}

/** Ends the run with one of the workflow's errors. */
export interface FailStep {
  readonly id?: string | undefined;
  readonly fail: string;
  /** Overrides the error's message for this step. */
  readonly message?: string | undefined;
  readonly on_failure?: OnFailure | undefined;
}

/** Ends the run with this output. */
export interface OutputStep {
  readonly id?: string | undefined;
  readonly output: Readonly<Record<string, Source>>;
}

export type Step =
  | ActionStep
  | IfStep
  | WaitStep
  | ApprovalStep
  | RunStep
  | EmitStep
  | FailStep
  | OutputStep;

const steps: z.ZodType<readonly Step[]> = z.lazy(() =>
  // oxlint-disable-next-line eslint/no-use-before-define -- recursive: z.lazy reads it once it exists
  z.array(stepSchema).min(1)
);

const onFailureSchema: z.ZodType<OnFailure> = z.union([
  z.literal("leave"),
  steps,
]);

const identified = { id: snakeCase, on_failure: onFailureSchema.optional() };

export const stepSchema: z.ZodType<Step> = z.lazy(() =>
  z.union([
    z.strictObject({
      ...identified,
      action: snakeCase,
      with: withSchema.optional(),
    }),
    z.strictObject({
      ...identified,
      if: z.array(conditionSchema).min(1),
      // oxlint-disable-next-line unicorn/no-thenable -- a step's branch, not a promise
      then: steps,
      else: steps.optional(),
    }),
    z.strictObject({
      id: snakeCase,
      wait: z.union([
        z.strictObject({ for: durationSchema }),
        z.strictObject({ until: sourceSchema }),
      ]),
    }),
    z.strictObject({ ...identified, wait_for_approval: approvalSchema }),
    z.strictObject({
      ...identified,
      run: snakeCase,
      with: withSchema.optional(),
    }),
    z.strictObject({
      id: snakeCase,
      emit: snakeCase,
      with: withSchema.optional(),
    }),
    z.strictObject({
      id: snakeCase.optional(),
      fail: snakeCase,
      message: z.string().min(1).optional(),
      on_failure: onFailureSchema.optional(),
    }),
    z.strictObject({
      id: snakeCase.optional(),
      output: z.record(snakeCase, sourceSchema),
    }),
  ])
);

/** Five cron fields: minute, hour, day of month, month, day of week. */
const cronSchema = z
  .string()
  .regex(
    /^\S+(?:\s+\S+){4}$/u,
    'A schedule is five cron fields, such as "0 9 * * 1-5" for 9am on weekdays'
  );

export const startsWhenSchema = z.union([
  z.literal("called"),
  z.strictObject({
    event: snakeCase,
    /** Start only when every condition on the event holds. */
    when: z.array(conditionSchema).min(1).optional(),
  }),
  z.strictObject({ schedule: cronSchema }),
]);
export type StartsWhen = z.infer<typeof startsWhenSchema>;

/**
 * An example case (decision 0045). P2.22 runs them and settles their shape;
 * until then each needs a name and may hold anything else.
 */
const caseSchema = z.looseObject({ name: z.string().min(1) });

export const workflowSchema = z.strictObject({
  /** Its name everywhere: file, URL, MCP tool and trace. */
  key: snakeCase,
  /** What people see, on its button and in lists. */
  label: z.string().min(1).max(200).optional(),
  description: z.string().min(1),
  starts_when: startsWhenSchema,
  /** Only reads: served as `GET`, and validation proves it never writes. */
  read_only: z.boolean().optional(),
  input: z.record(snakeCase, fieldSpecSchema).optional(),
  /** What the caller gets back. */
  output: z.record(snakeCase, sourceSchema).optional(),
  /** Its own error codes, each with a plain-English message. */
  errors: z.record(snakeCase, z.string().min(1)).optional(),
  /** Events it emits, each with its payload's fields. */
  events: z.record(snakeCase, z.record(snakeCase, fieldSpecSchema)).optional(),
  /** The role whose inbox gets a run that needs attention. */
  attention_role: snakeCase.optional(),
  /** For any step that fails after a commit and has none of its own. */
  on_failure: onFailureSchema.optional(),
  cases: z.array(caseSchema).optional(),
  steps,
});

export type WorkflowDefinition = Readonly<
  Omit<z.infer<typeof workflowSchema>, "input" | "events"> & {
    input?: FieldSpecs | undefined;
    events?: Readonly<Record<string, FieldSpecs>> | undefined;
  }
>;
