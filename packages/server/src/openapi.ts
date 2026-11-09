// The OpenAPI 3.1 document, generated from the registry (decision 0026).
import type { AnyDefinition, Registry } from "@workspace/actions";
import { z } from "zod";

import { errorBodySchema, statusFor } from "./errors.ts";
import type { ApiError } from "./errors.ts";

export const pathOf = (definition: AnyDefinition) =>
  `/${definition.kind === "action" ? "actions" : "queries"}/${definition.name}`;

/** Schemas hoisted out of each JSON Schema's `$defs`, by name. */
type Components = Record<string, unknown>;

/**
 * Converts a Zod schema to JSON Schema for embedding in the document. Its
 * `$defs` (such as the recursive list filter) move to `components/schemas`
 * under `prefix`, and their `#/$defs/` references are rewritten to match.
 */
const schemaOf = (
  schema: z.ZodType,
  prefix: string,
  components: Components,
  io: "input" | "output" = "output"
) => {
  const {
    $defs,
    $schema: _,
    ...rest
  } = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
  });
  const rewrite = (value: unknown) =>
    JSON.parse(
      JSON.stringify(value).replaceAll(
        '"#/$defs/',
        `"#/components/schemas/${prefix}.`
      )
    ) as unknown;
  for (const [name, definition] of Object.entries($defs ?? {})) {
    components[`${prefix}.${name}`] = rewrite(definition);
  }
  return rewrite(rest);
};

const errorResponse = { $ref: "#/components/responses/Error" };

const errorStatuses = (codes: ApiError["code"][]) =>
  Object.fromEntries(
    codes.map((code) => [
      String(statusFor({ code } as ApiError)),
      errorResponse,
    ])
  );

const json = (schema: unknown) => ({
  content: { "application/json": { schema } },
});

const actionResult = (output: z.ZodType) =>
  z.object({
    output,
    runId: z.string(),
    replayed: z.boolean(),
    dryRun: z.boolean(),
    changes: z.array(z.record(z.string(), z.unknown())).optional(),
  });

const operation = (definition: AnyDefinition, components: Components) => {
  const isAction = definition.kind === "action";
  const success = isAction
    ? actionResult(definition.output)
    : z.object({ output: definition.output });
  const codes: ApiError["code"][] = [
    "validation",
    "unauthenticated",
    "permission",
    "not_found",
    "internal",
    ...(isAction ? (["conflict", "approval_required"] as const) : []),
  ];
  return {
    operationId: definition.name,
    description: definition.description,
    parameters: [
      { $ref: "#/components/parameters/RequestId" },
      ...(isAction
        ? [
            { $ref: "#/components/parameters/IdempotencyKey" },
            { $ref: "#/components/parameters/DryRun" },
          ]
        : []),
    ],
    requestBody: {
      required: true,
      ...json(
        schemaOf(
          definition.input,
          `${definition.name}.input`,
          components,
          "input"
        )
      ),
    },
    responses: {
      "200": {
        description: "The result.",
        ...json(schemaOf(success, `${definition.name}.output`, components)),
      },
      ...errorStatuses(codes),
    },
  };
};

/** A query's GET form takes its input as JSON in `?input=`. */
const getOperation = (definition: AnyDefinition, components: Components) => {
  const { requestBody: _, ...rest } = operation(definition, components);
  return {
    ...rest,
    operationId: `${definition.name}.get`,
    parameters: [
      ...rest.parameters,
      {
        name: "input",
        in: "query",
        required: false,
        description: "The query's input as JSON. Defaults to `{}`.",
        schema: { type: "string" },
      },
    ],
  };
};

export const openApiDocument = (registry: Registry) => {
  const schemas: Components = {};
  const paths = Object.fromEntries(
    registry.list().map((definition) => [
      pathOf(definition),
      definition.kind === "action"
        ? { post: operation(definition, schemas) }
        : {
            post: operation(definition, schemas),
            get: getOperation(definition, schemas),
          },
    ])
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "factory",
      version: "0.0.0",
      description:
        "Every action and query in the system. Errors share one shape; send `Authorization: Bearer <API key>` or a session cookie.",
    },
    security: [{ apiKey: [] }, { session: [] }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer" },
        session: {
          type: "apiKey",
          in: "cookie",
          name: "better-auth.session_token",
        },
      },
      parameters: {
        RequestId: {
          name: "X-Request-Id",
          in: "header",
          required: false,
          description: "Echoed back; generated when absent.",
          schema: { type: "string" },
        },
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          description:
            "Retry key: a repeat with the same key returns the first success without running again.",
          schema: { type: "string", maxLength: 255 },
        },
        DryRun: {
          name: "dryRun",
          in: "query",
          required: false,
          description:
            "Run every stage, then roll back and report the changes.",
          schema: { type: "boolean" },
        },
      },
      responses: {
        Error: {
          description: "A typed error.",
          ...json(z.toJSONSchema(errorBodySchema)),
        },
      },
    },
  };
};
