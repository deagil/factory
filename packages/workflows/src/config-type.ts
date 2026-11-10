// Workflows as config: `config/workflows/<key>.yaml` (P2.16, decision
// 0048). Its references are the roles it names; its check is
// validateWorkflow, against the system and the other config files.
import { choiceLookup, defineConfigType } from "@workspace/config";
import type {
  ChoiceList,
  ConfigCatalog,
  ConfigFile,
  Reference,
} from "@workspace/config";
import type { z } from "zod";

import { workflowSchema } from "./schema.ts";
import type { Step, WorkflowDefinition } from "./schema.ts";
import { validateWorkflow } from "./validate.ts";
import type { WorkflowContext } from "./validate.ts";

const roleAt = (name: string, path: Reference["path"]): Reference => ({
  kind: "role",
  name,
  path,
});

/** Every role a step names, in it and below it. */
const stepRoles = (
  steps: readonly Step[],
  path: Reference["path"]
): Reference[] =>
  steps.flatMap((step, index) => {
    const at = [...path, index];
    const own =
      "wait_for_approval" in step
        ? [
            roleAt(step.wait_for_approval.approver, [
              ...at,
              "wait_for_approval",
              "approver",
            ]),
            ...(["requester", "exempt"] as const).flatMap((field) =>
              (step.wait_for_approval[field] ?? []).map((role, n) =>
                roleAt(role, [...at, "wait_for_approval", field, n])
              )
            ),
          ]
        : [];
    const inner = [
      ...("if" in step
        ? [
            ...stepRoles(step.then, [...at, "then"]),
            ...stepRoles(step.else ?? [], [...at, "else"]),
          ]
        : []),
      ...("on_failure" in step && Array.isArray(step.on_failure)
        ? stepRoles(step.on_failure as readonly Step[], [...at, "on_failure"])
        : []),
    ];
    return [...own, ...inner];
  });

/** The roles a workflow names: its attention role and its approvers. */
export const workflowReferences = (
  workflow: WorkflowDefinition
): Reference[] => [
  ...(workflow.attention_role
    ? [roleAt(workflow.attention_role, ["attention_role"])]
    : []),
  ...stepRoles(workflow.steps, ["steps"]),
  ...(Array.isArray(workflow.on_failure)
    ? stepRoles(workflow.on_failure as readonly Step[], ["on_failure"])
    : []),
];

/** The workflows in config files, by key. */
export const workflowsIn = (
  files: readonly ConfigFile[]
): Map<string, WorkflowDefinition> =>
  new Map(
    files
      .filter((file) => file.type === "workflows")
      .map((file) => [file.key, file.value as WorkflowDefinition])
  );

/** What validateWorkflow needs, from the system and the config files. */
export const contextOf = (
  catalog: ConfigCatalog,
  files: readonly ConfigFile[]
): WorkflowContext => {
  const lists = files
    .filter((file) => file.type === "choices")
    .map((file) => file.value as ChoiceList);
  return {
    catalog,
    workflows: workflowsIn(files),
    choiceKeys: new Map(
      lists.map((list) => [list.key, list.options.map((option) => option.key)])
    ),
    choices: choiceLookup(lists),
  };
};

export const workflowConfigType = defineConfigType<WorkflowDefinition>({
  type: "workflows",
  schema: workflowSchema as unknown as z.ZodType<WorkflowDefinition>,
  references: workflowReferences,
  check: (workflow, { catalog, files }) =>
    validateWorkflow(workflow, contextOf(catalog, files)).problems,
});
