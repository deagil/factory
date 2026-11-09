// The OpenAPI 3.1 document, generated from the registry, the objects'
// endpoints and the live config's workflows (decisions 0026 and 0045).
import type {
  AnyDefinition,
  ObjectEndpoint,
  Registry,
  WorkflowEntry,
} from "@workspace/actions";
import { z } from "zod";

import { errorBodySchema, statusFor } from "./errors.ts";
import type { ApiError } from "./errors.ts";

export const pathOf = (definition: AnyDefinition) =>
  `/${definition.kind === "query" ? "queries" : "actions"}/${definition.name}`;

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
  const isAction = definition.kind !== "query";
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
    operationId: `${definition.kind === "query" ? "queries" : "actions"}.${definition.name}`,
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
    operationId: `queries.${definition.name}.get`,
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

const queryParameter = (
  name: string,
  description: string,
  schema: unknown
) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

/** The path and query parameters each kind of object endpoint takes. */
const endpointParameters = (endpoint: ObjectEndpoint) => {
  const id = endpoint.path.includes("{id}")
    ? [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ]
    : [];
  const read =
    endpoint.job === "list" || endpoint.job === "get"
      ? [
          queryParameter("archived", "`include` to see archived records too.", {
            type: "string",
            enum: ["exclude", "include"],
          }),
          queryParameter(
            "expand",
            "Reference fields whose records to return in `related`, comma-separated.",
            { type: "string" }
          ),
        ]
      : [];
  const list =
    endpoint.job === "list"
      ? [
          queryParameter("filter", "The filter, as JSON.", { type: "string" }),
          queryParameter("sort", "A field key; `-key` sorts descending.", {
            type: "string",
          }),
          queryParameter("cursor", "`nextCursor` from the last page.", {
            type: "string",
          }),
          queryParameter("limit", "Records per page.", { type: "integer" }),
        ]
      : [];
  const ifMatch =
    endpoint.job === "update"
      ? [
          {
            name: "If-Match",
            in: "header",
            required: false,
            description:
              "The version you read (its ETag); a newer one is a conflict.",
            schema: { type: "string" },
          },
        ]
      : [];
  return [...id, ...read, ...list, ...ifMatch];
};

/** One object endpoint: its action's or query's operation, over REST. */
const endpointOperation = (
  endpoint: ObjectEndpoint,
  definition: AnyDefinition,
  components: Components
) => {
  const { requestBody, parameters, responses, ...rest } = operation(
    definition,
    components
  );
  const { "200": success, ...errors } = responses;
  const hasBody = endpoint.job === "create" || endpoint.job === "update";
  return {
    ...rest,
    operationId: endpoint.name,
    tags: [endpoint.object],
    parameters: [...parameters, ...endpointParameters(endpoint)],
    ...(hasBody ? { requestBody } : {}),
    responses: {
      [endpoint.job === "create" ? "201" : "200"]: success,
      ...errors,
    },
  };
};

/**
 * A workflow endpoint (P2.18): `POST /workflows/<key>`, or GET with the
 * input as JSON in `?input=` for a `read_only` one. Its declared errors
 * answer 422 and are listed in the description.
 */
const workflowOperation = (workflow: WorkflowEntry, components: Components) => {
  const declared = Object.entries(workflow.errors);
  const input = schemaOf(
    workflow.input,
    `workflows.${workflow.key}.input`,
    components,
    "input"
  );
  const common = {
    operationId: workflow.key,
    summary: workflow.label,
    description: [
      workflow.description,
      ...(declared.length > 0
        ? [
            `Its own errors, each a 422 with \`declared: true\`: ${declared.map(([code, message]) => `\`${code}\` (${message})`).join("; ")}.`,
          ]
        : []),
    ].join("\n\n"),
    tags: ["workflows"],
    responses: {
      "200": {
        description: "The workflow's output and the run it wrote.",
        ...json({
          type: "object",
          required: ["output", "runId", "replayed"],
          properties: {
            output: { type: "object" },
            runId: { type: "string", format: "uuid" },
            replayed: { type: "boolean" },
          },
        }),
      },
      ...errorStatuses([
        "validation",
        "unauthenticated",
        "permission",
        "not_found",
        "conflict",
        "internal",
      ]),
      ...(declared.length > 0 ? { "422": errorResponse } : {}),
    },
  };
  if (workflow.readOnly) {
    return {
      get: {
        ...common,
        parameters: [
          { $ref: "#/components/parameters/RequestId" },
          queryParameter("input", "The workflow's input as JSON.", {
            type: "string",
          }),
        ],
      },
    };
  }
  return {
    post: {
      ...common,
      parameters: [
        { $ref: "#/components/parameters/RequestId" },
        { $ref: "#/components/parameters/IdempotencyKey" },
      ],
      requestBody: { required: true, ...json(input) },
    },
  };
};

const runOperation = {
  get: {
    operationId: "run_get",
    description:
      "One run: its input, output or error, each step, and the changes and events it wrote. Your own runs, or any with the run.get permission.",
    tags: ["workflows"],
    parameters: [
      { $ref: "#/components/parameters/RequestId" },
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": {
        description: "The run.",
        ...json({ type: "object", properties: { output: { type: "object" } } }),
      },
      ...errorStatuses(["unauthenticated", "permission", "not_found"]),
    },
  },
};

export const openApiDocument = (
  registry: Registry,
  endpoints: readonly ObjectEndpoint[] = [],
  workflows: readonly WorkflowEntry[] = []
) => {
  const schemas: Components = {};
  const rest: Record<string, Record<string, unknown>> = {};
  for (const endpoint of endpoints) {
    const definition = registry.get(endpoint.name);
    if (definition) {
      rest[endpoint.path] = {
        ...rest[endpoint.path],
        [endpoint.method.toLowerCase()]: endpointOperation(
          endpoint,
          definition,
          schemas
        ),
      };
    }
  }
  const paths = Object.fromEntries([
    ...Object.entries(rest),
    ...workflows
      .filter((workflow) => workflow.called)
      .map((workflow) => [
        `/workflows/${workflow.key}`,
        workflowOperation(workflow, schemas),
      ]),
    ["/runs/{id}", runOperation],
    ...registry.list().map((definition) => [
      pathOf(definition),
      definition.kind === "query"
        ? {
            post: operation(definition, schemas),
            get: getOperation(definition, schemas),
          }
        : { post: operation(definition, schemas) },
    ]),
  ]);
  return {
    openapi: "3.1.0",
    info: {
      title: "factory",
      version: "0.0.0",
      description:
        "Each object's endpoints, each workflow, and every action and query in the system. Errors share one shape; send `Authorization: Bearer <API key>` or a session cookie.",
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
