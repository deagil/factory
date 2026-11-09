// `config.validate`: checks the system's `config/` folder as it is on
// disk, through ctx.config like every other service (AGENTS.md rule 7).
import { defineQuery } from "@workspace/actions";
import { z } from "zod";

const problemSchema = z.object({
  file: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  line: z.number().int().nullable(),
  message: z.string(),
});

export const configValidateQuery = defineQuery({
  name: "config.validate",
  description:
    "Checks every config file against its schema and against the objects, actions and events the system has. Each problem names the file, the path in it and the line.",
  input: z.object({}),
  output: z.object({
    ok: z.boolean(),
    files: z.number().int(),
    problems: z.array(problemSchema),
  }),
  handler: (ctx) => {
    if (!ctx.config.validate) {
      return {
        ok: false,
        files: 0,
        problems: [
          {
            file: "config",
            path: [],
            line: null,
            message: "This system's config can't be checked from here.",
          },
        ],
      };
    }
    const { files, problems } = ctx.config.validate();
    return {
      ok: problems.length === 0,
      files,
      problems: problems.map((problem) => ({
        ...problem,
        path: [...problem.path],
      })),
    };
  },
});
