// Config checking for a system (P2.04): what the system has, as
// validateConfig needs it, and the `config.validate` query.
import { defineQuery } from "@workspace/actions";
import type { AnyDefinition } from "@workspace/actions";
import { coreConfigTypes, validateConfig } from "@workspace/config";
import type { ConfigCatalog, ConfigRead } from "@workspace/config";
import type { AnyObjectDefinition } from "@workspace/objects";
import { z } from "zod";

/** The objects, actions, queries and events that config can refer to. */
export const catalogOf = (
  objects: readonly AnyObjectDefinition[],
  definitions: readonly AnyDefinition[]
): ConfigCatalog => ({
  objects: new Map(
    objects.map((object) => [object.name, Object.keys(object.fields)])
  ),
  actions: new Set(
    definitions
      .filter((definition) => !definition.objectPermission)
      .map((definition) => definition.name)
  ),
  objectActions: new Map(
    definitions.flatMap((definition) =>
      definition.objectPermission
        ? [[definition.name, definition.objectPermission] as const]
        : []
    )
  ),
  events: new Set(
    definitions.flatMap((definition) =>
      definition.kind === "action" ? Object.keys(definition.emits) : []
    )
  ),
});

const problemSchema = z.object({
  file: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  line: z.number().int().nullable(),
  message: z.string(),
});

/** `config.validate`: checks the system's `config/` folder as it is on disk. */
export const configValidateQuery = (
  configDir: string,
  catalog: () => ConfigCatalog
) =>
  defineQuery({
    name: "config.validate",
    description:
      "Checks every config file against its schema and against the objects, actions and events the system has. Each problem names the file, the path in it and the line.",
    input: z.object({}),
    output: z.object({
      ok: z.boolean(),
      files: z.number().int(),
      problems: z.array(problemSchema),
    }),
    handler: () => {
      const read: ConfigRead = validateConfig(
        configDir,
        coreConfigTypes,
        catalog()
      );
      return {
        ok: read.problems.length === 0,
        files: read.files.length,
        problems: read.problems.map((problem) => ({
          ...problem,
          path: [...problem.path],
        })),
      };
    },
  });
