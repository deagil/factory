// Drafts (P2.08, decision 0041): staff change config in a draft, a branch
// made from production, and publish it as one commit. A draft whose files an
// approval rule covers waits for approval before it publishes (P2.09). The actions and
// queries reach git only through `ctx.git`, and record each draft in the
// `drafts` table. A system that reads `config/` from its working tree has no
// `ctx.git`, and refuses them.
import {
  approvalEntrySchema,
  defineAction,
  defineQuery,
  describeSignOffs,
  rulesForFiles,
  signOffsFor,
  unmetSignOff,
} from "@workspace/actions";
import type {
  ActionContext,
  ConfigAuthor,
  ConfigCheck,
  GitService,
  QueryContext,
} from "@workspace/actions";
import type { DraftEntry } from "@workspace/objects";
import { parse, stringify } from "yaml";
import { z } from "zod";

import { configExtension } from "./read.ts";

const problemSchema = z.object({
  file: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  line: z.number().int().nullable(),
  message: z.string(),
});

const draftSchema = z.object({
  id: z.uuid(),
  branch: z.string(),
  title: z.string(),
  files: z.array(z.string()),
  status: z.enum([
    "draft",
    "valid",
    "invalid",
    "awaiting_approval",
    "published",
    "abandoned",
  ]),
  baseSha: z.string(),
  publishedSha: z.string().nullable(),
  syncedSha: z.string().nullable(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
});

const checkedSchema = z.object({
  draft: draftSchema,
  problems: z.array(problemSchema),
});

/** `config/<type>/<key>.yaml`, as readConfig names files (decision 0037). */
const configFile = z
  .string()
  .regex(
    new RegExp(
      `^config/[a-z][a-z0-9-]*/[a-z0-9][a-z0-9-]*${configExtension.replace(".", "\\.")}$`,
      "u"
    ),
    "A config file is config/<type>/<key>.yaml"
  );

const noRemote =
  "Drafts need a config remote. This system reads config/ from its working tree, so edit the files there.";

/** Commits are by the actor; the address only says who, it's never mailed. */
const authorOf = (ctx: QueryContext): ConfigAuthor => ({
  name: ctx.actor.name,
  email: `actor-${ctx.actor.id}@factory.invalid`,
});

const trailers = (ctx: QueryContext, draftId: string) =>
  `\n\nDraft-Id: ${draftId}\nActor-Id: ${ctx.actor.id}\n`;

const problemsOf = (check: ConfigCheck) =>
  check.problems.map((problem) => ({ ...problem, path: [...problem.path] }));

const toDraft = (entry: DraftEntry) => draftSchema.parse(entry);

/** The draft and the remote, or why the action can't go on. */
const openDraft = async (
  ctx: ActionContext<Record<never, never>>,
  id: string
) => {
  if (!ctx.git) {
    return ctx.invalid(noRemote);
  }
  if (ctx.dryRun) {
    return ctx.invalid(
      "Drafts write to the config remote, so they can't be dry-run."
    );
  }
  const draft = await ctx.dal.draftDetail(id);
  if (!draft) {
    return ctx.notFound("draft", id);
  }
  if (draft.status === "published" || draft.status === "abandoned") {
    return ctx.conflict(`This draft is ${draft.status}, so it can't change.`);
  }
  return { draft, git: ctx.git };
};

/** The sign-offs the rules covering `files` ask of `ctx.actor`. */
const signOffs = (
  ctx: ActionContext<Record<never, never>>,
  files: readonly string[]
) =>
  signOffsFor(
    rulesForFiles(ctx.config.approvals ?? [], files),
    ctx.actor,
    ctx.granted
  );

/** Re-checks a draft's whole set of files and records what it found. */
const recheck = async (
  ctx: ActionContext<Record<never, never>>,
  git: GitService,
  draft: DraftEntry
) => {
  const head = await git.head(draft.branch);
  const [check, diff] = await Promise.all([
    git.check(head),
    git.diff(draft.baseSha, head),
  ]);
  await ctx.drafts.update(draft.id, {
    files: diff.map((each) => each.path),
    status: check.problems.length > 0 ? "invalid" : "valid",
  });
  const updated = await ctx.dal.draftDetail(draft.id);
  if (!updated) {
    throw new Error(`Draft ${draft.id} vanished while it was saved.`);
  }
  return { draft: toDraft(updated), problems: problemsOf(check) };
};

export const draftOpen = defineAction({
  name: "draft.open",
  description:
    "Open a draft: a set of config changes made on a branch from production, published together. Save files into it with draft.save.",
  input: z.strictObject({ title: z.string().min(1).max(200) }),
  output: z.object({ draft: draftSchema }),
  handler: async (ctx, { title }) => {
    if (!ctx.git) {
      return ctx.invalid(noRemote);
    }
    if (ctx.dryRun) {
      return ctx.invalid(
        "Drafts write to the config remote, so they can't be dry-run."
      );
    }
    const id = await ctx.drafts.newId();
    const branch = `draft/${id}`;
    const baseSha = await ctx.git.branch(branch);
    await ctx.drafts.create({
      id,
      branch,
      title,
      baseSha,
      createdBy: ctx.actor.id,
    });
    const draft = await ctx.dal.draftDetail(id);
    if (!draft) {
      throw new Error(`Draft ${id} wasn't saved.`);
    }
    return { draft: toDraft(draft) };
  },
});

export const draftSave = defineAction({
  name: "draft.save",
  description:
    "Save one config file in a draft: its YAML as content, or its value as an object, which is written as YAML; content null deletes it. Each save is one commit, and checks the draft's whole set of files against the running system.",
  input: z
    .strictObject({
      id: z.uuid(),
      path: configFile,
      content: z.string().max(200_000).nullable().optional(),
      value: z.record(z.string(), z.unknown()).optional(),
    })
    .refine(
      (input) => (input.content === undefined) !== (input.value === undefined),
      { message: "Give either content or value", path: ["content"] }
    ),
  output: checkedSchema,
  handler: async (ctx, input) => {
    const opened = await openDraft(ctx, input.id);
    if (!("draft" in opened)) {
      return opened;
    }
    const { draft, git } = opened;
    const content =
      input.value === undefined
        ? (input.content ?? null)
        : stringify(input.value, { lineWidth: 0 });
    const committed = await git.commit({
      branch: draft.branch,
      path: input.path,
      content,
      message: `${content === null ? "Delete" : "Save"} ${input.path}${trailers(ctx, draft.id)}`,
      author: authorOf(ctx),
    });
    if (committed.status === "conflict") {
      return ctx.conflict(
        "Someone else saved this draft at the same moment. Read it again and retry."
      );
    }
    // What was approved has changed, so it needs approving again.
    await ctx.approvals.cancelOpen("draft", draft.id, ctx.clock.now());
    return recheck(ctx, git, draft);
  },
});

export const draftSubmit = defineAction({
  name: "draft.submit",
  description:
    "Submit a draft for publishing: checks it again and, when an approval rule covers one of its files, asks the rule's approvers. It waits in awaiting_approval until they decide.",
  input: z.strictObject({ id: z.uuid() }),
  output: checkedSchema,
  handler: async (ctx, { id }) => {
    const opened = await openDraft(ctx, id);
    if (!("draft" in opened)) {
      return opened;
    }
    const checked = await recheck(ctx, opened.git, opened.draft);
    // A new submission starts a new round of approvals.
    await ctx.approvals.cancelOpen("draft", id, ctx.clock.now());
    const needed = signOffs(ctx, checked.draft.files);
    if (checked.draft.status !== "valid" || needed.length === 0) {
      return checked;
    }
    await ctx.approvals.request("draft", id, needed, ctx.actor.id);
    await ctx.drafts.update(id, { status: "awaiting_approval" });
    return {
      ...checked,
      draft: { ...checked.draft, status: "awaiting_approval" as const },
    };
  },
});

export const draftPublish = defineAction({
  name: "draft.publish",
  description:
    "Publish a valid draft: its files go onto production as one commit, which is copied to main, and the running system loads it.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ draft: draftSchema }),
  emits: {
    "draft.published": z.object({
      draftId: z.uuid(),
      sha: z.string(),
      files: z.array(z.string()),
    }),
  },
  handler: async (ctx, { id }) => {
    const opened = await openDraft(ctx, id);
    if (!("draft" in opened)) {
      return opened;
    }
    const { draft, git } = opened;
    if (draft.files.length === 0) {
      return ctx.invalid("This draft changes nothing yet. Save a file first.");
    }
    if (draft.status === "awaiting_approval") {
      const waiting = await ctx.approvals.forSubject("draft", draft.id);
      const rule =
        waiting.find((each) => each.status === "pending")?.ruleKey ?? "";
      return ctx.needsApproval(
        rule,
        "This draft is waiting for approval. It can be published once it's approved."
      );
    }
    if (draft.status !== "valid") {
      return ctx.invalid(
        "Only a valid draft can be published. Fix its problems and save again."
      );
    }
    // What the rules ask now, which may be more than when it was submitted.
    const missing = unmetSignOff(
      signOffs(ctx, draft.files),
      await ctx.approvals.forSubject("draft", draft.id)
    );
    if (missing) {
      return ctx.needsApproval(
        missing.ruleKey,
        `The rule ${missing.ruleKey} covers this draft's files, so it needs ${describeSignOffs([missing])}. Submit it for approval.`
      );
    }
    const result = await git.publish({
      branch: draft.branch,
      base: draft.baseSha,
      message: `${draft.title}${trailers(ctx, draft.id)}`,
      author: authorOf(ctx),
    });
    if (result.status === "conflict") {
      return ctx.conflict(
        `Production changed ${result.files.join(", ")} since this draft began. Start a new draft from the current config.`
      );
    }
    if (result.status === "invalid") {
      await ctx.drafts.update(draft.id, { status: "invalid" });
      return ctx.invalid(
        "On top of the current production config, this draft doesn't validate.",
        result.problems.map((problem) => ({
          path: [problem.file, ...problem.path],
          message: problem.message,
        }))
      );
    }
    await ctx.approvals.cancelPending("draft", draft.id, ctx.clock.now());
    await ctx.drafts.update(draft.id, {
      status: "published",
      publishedSha: result.sha,
      syncedSha: result.synced.status === "copied" ? result.synced.sha : null,
      publishedAt: ctx.clock.now(),
    });
    ctx.emit("draft.published", {
      draftId: draft.id,
      sha: result.sha,
      files: draft.files,
    });
    const published = await ctx.dal.draftDetail(draft.id);
    if (!published) {
      throw new Error(`Draft ${draft.id} vanished while it was published.`);
    }
    return { draft: toDraft(published) };
  },
});

/** A draft branch's head, or null once it's gone. */
const branchHead = async (git: GitService | undefined, branch: string) => {
  try {
    return git ? await git.head(branch) : null;
  } catch {
    return null;
  }
};

export const draftList = defineQuery({
  name: "draft.list",
  description: "Config drafts, newest first, optionally in one status.",
  input: z.strictObject({
    status: draftSchema.shape.status.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  output: z.object({ drafts: z.array(draftSchema) }),
  handler: async (ctx, input) => {
    const drafts = await ctx.dal.draftList(input);
    return { drafts: drafts.map(toDraft) };
  },
});

/** A file's YAML as a value, or null when it's missing or doesn't parse. */
const valueOf = (content: string | null): unknown => {
  if (content === null) {
    return null;
  }
  try {
    return parse(content) ?? null;
  } catch {
    return null;
  }
};

/** `config/<type>/<key>.yaml` → its type and key. */
const typeAndKey = (file: string) => {
  const [, type = "", name = ""] = file.split("/");
  return { type, key: name.replace(configExtension, "") };
};

/** The commit a draft's files are at: published, or its branch's head. */
const draftCommit = async (git: GitService | undefined, draft: DraftEntry) =>
  draft.publishedSha ?? (await branchHead(git, draft.branch));

export const draftGet = defineQuery({
  name: "draft.get",
  description:
    "One config draft: each file it changes before and after, as YAML and as values (null where the file doesn't exist), and its approvals.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({
    draft: draftSchema,
    changes: z.array(
      z.object({
        path: z.string(),
        type: z.string(),
        key: z.string(),
        before: z.string().nullable(),
        after: z.string().nullable(),
        beforeValue: z.unknown(),
        afterValue: z.unknown(),
      })
    ),
    approvals: z.array(approvalEntrySchema),
  }),
  handler: async (ctx, { id }) => {
    const draft = await ctx.dal.draftDetail(id);
    if (!draft) {
      return ctx.notFound("draft", id);
    }
    const to = await draftCommit(ctx.git, draft);
    const [diff, approvals] = await Promise.all([
      ctx.git && to ? ctx.git.diff(draft.baseSha, to) : [],
      ctx.dal.approvalList({ subjectId: id, limit: 200 }),
    ]);
    return {
      draft: toDraft(draft),
      changes: diff.map((change) => ({
        ...change,
        ...typeAndKey(change.path),
        beforeValue: valueOf(change.before),
        afterValue: valueOf(change.after),
      })),
      approvals,
    };
  },
});

export const draftFiles = defineQuery({
  name: "draft.files",
  description:
    "Every config file as a draft has it, with its YAML and its value, for editing it.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({
    files: z.array(
      z.object({
        path: z.string(),
        type: z.string(),
        key: z.string(),
        content: z.string(),
        value: z.unknown(),
      })
    ),
  }),
  handler: async (ctx, { id }) => {
    const draft = await ctx.dal.draftDetail(id);
    if (!draft) {
      return ctx.notFound("draft", id);
    }
    const at = await draftCommit(ctx.git, draft);
    if (!ctx.git || !at) {
      return ctx.invalid(noRemote);
    }
    const files = await ctx.git.files(at);
    return {
      files: files
        .filter((file) => configFile.safeParse(file.path).success)
        .map((file) => ({
          ...file,
          ...typeAndKey(file.path),
          value: valueOf(file.content),
        })),
    };
  },
});

/** Every draft action and query, which a system with config has. */
export const draftDefinitions = [
  draftOpen,
  draftSave,
  draftSubmit,
  draftPublish,
  draftList,
  draftGet,
  draftFiles,
] as const;
