import type {
  AnyDefinition,
  Caller,
  Pipeline,
  RunOptions,
} from "@workspace/actions";

/** Runs an action or a query through the pipeline. */
export const callDefinition = (
  pipeline: Pipeline,
  definition: AnyDefinition,
  input: unknown,
  caller: Caller,
  options: RunOptions = {}
) =>
  definition.kind === "query"
    ? pipeline.query(definition, input, caller)
    : pipeline.run(definition, input, caller, options);
