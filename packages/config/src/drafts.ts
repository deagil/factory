// Drafts (P2.08, decision 0041): staff change config in a draft, a branch
// made from production, and publish it as one commit. Each person has one
// working draft, which their first save opens (decision 0044). Publishing a
// draft whose files an approval rule covers asks for approval instead, and the
// last approval publishes it (P2.09). The actions and queries reach git only
// through `ctx.git`, and record each draft in the `drafts` table. A system that reads `config/` from its working tree has no
// `ctx.git`, and refuses them.
import {
  approvalEntrySchema,
  defineAction,
  defineQuery,
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

type Ctx = ActionContext<Record<never, never>>;

/** The remote, or why a draft action can't use it. */
const remoteFor = (ctx: Ctx) => {
  if (!ctx.git) {
    return ctx.invalid(noRemote);
  }
  if (ctx.dryRun) {
    return ctx.invalid(
      "Drafts write to the config remote, so they can't be dry-run."
    );
  }
  return { git: ctx.git };
};

/** `config/<type>/<key>.yaml` → its type and key. */
const typeAndKey = (file: string) => {
  const [, type = "", name = ""] = file.split("/");
  return { type, key: name.replace(configExtension, "") };
};

/** "Edit deal-stages and manager", from the files a draft changes. */
export const titleFor = (files: readonly string[]) => {
  const keys = files.map((file) => typeAndKey(file).key);
  if (keys.length === 0) {
    return "Unpublished edits";
  }
  const shown =
    keys.length > 3 ? [...keys.slice(0, 2), `${keys.length - 2} more`] : keys;
  const last = shown.pop();
  return `Edit ${shown.length > 0 ? `${shown.join(", ")} and ` : ""}${last}`;
};

/** Makes a draft branch and its row, and returns the draft. */
const start = async (
  ctx: Ctx,
  git: GitService,
  title: string,
  autoTitle: boolean
) => {
  const id = await ctx.drafts.newId();
  const branch = `draft/${id}`;
  const baseSha = await git.branch(branch);
  await ctx.drafts.create({
    id,
    branch,
    title,
    autoTitle,
    baseSha,
    createdBy: ctx.actor.id,
  });
  const draft = await ctx.dal.draftDetail(id);
  if (!draft) {
    throw new Error(`Draft ${id} wasn't saved.`);
  }
  return draft;
};

/** The caller's working draft: their newest one that can still change. */
const mine = async (ctx: QueryContext) => {
  const [draft] = await ctx.dal.draftList({
    createdBy: ctx.actor.id,
    open: true,
    limit: 1,
  });
  return draft ?? null;
};

/**
 * Ends a draft's request for approval, as a change to it does: what was
 * approved is no longer what would publish.
 */
const endRequest = async (ctx: Ctx, draft: DraftEntry) => {
  await ctx.approvals.cancelOpen("draft", draft.id, ctx.clock.now());
  if (draft.publishRunId) {
    await ctx.approvals.close(draft.publishRunId, "withdrawn");
    await ctx.drafts.update(draft.id, { publishRunId: null });
  }
};

/** The draft and the remote, or why the action can't go on. */
const openDraft = async (ctx: Ctx, id: string) => {
  const remote = remoteFor(ctx);
  if (!("git" in remote)) {
    return remote;
  }
  const draft = await ctx.dal.draftDetail(id);
  if (!draft) {
    return ctx.notFound("draft", id);
  }
  if (draft.status === "published" || draft.status === "abandoned") {
    return ctx.conflict(`This draft is ${draft.status}, so it can't change.`);
  }
  return { draft, git: remote.git };
};

/** The sign-offs the rules covering `files` ask of `ctx.actor`. */
const signOffs = (ctx: Ctx, files: readonly string[]) =>
  signOffsFor(
    rulesForFiles(ctx.config.approvals ?? [], files),
    ctx.actor,
    ctx.granted
  );

/** Re-checks a draft's whole set of files and records what it found. */
const recheck = async (ctx: Ctx, git: GitService, draft: DraftEntry) => {
  const head = await git.head(draft.branch);
  const [check, diff] = await Promise.all([
    git.check(head),
    git.diff(draft.baseSha, head),
  ]);
  const files = diff.map((each) => each.path);
  await ctx.drafts.update(draft.id, {
    files,
    status: check.problems.length > 0 ? "invalid" : "valid",
    ...(draft.autoTitle ? { title: titleFor(files) } : {}),
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
    "Open a new draft: a set of config changes made on a branch from production, published together. draft.save without an id saves into your working draft instead, opening one if you have none.",
  input: z.strictObject({ title: z.string().min(1).max(200) }),
  output: z.object({ draft: draftSchema }),
  handler: async (ctx, { title }) => {
    const remote = remoteFor(ctx);
    if (!("git" in remote)) {
      return remote;
    }
    return { draft: toDraft(await start(ctx, remote.git, title, false)) };
  },
});

export const draftMine = defineQuery({
  name: "draft.mine",
  description:
    "Your working draft: the newest of your drafts that isn't published or abandoned, which draft.save without an id saves into. Null when you have none.",
  input: z.strictObject({}),
  output: z.object({ draft: draftSchema.nullable() }),
  handler: async (ctx) => {
    const draft = await mine(ctx);
    return { draft: draft ? toDraft(draft) : null };
  },
});

export const draftSave = defineAction({
  name: "draft.save",
  description:
    "Save one config file in a draft: its YAML as content, or its value as an object, which is written as YAML; content null deletes it. Without an id it saves into your working draft, opening one if you have none. Each save is one commit, and checks the draft's whole set of files against the running system. Saving a draft that waits for approval withdraws the request.",
  input: z
    .strictObject({
      /** The draft; your working draft when left out. */
      id: z.uuid().optional(),
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
    let { id } = input;
    if (id === undefined) {
      const remote = remoteFor(ctx);
      if (!("git" in remote)) {
        return remote;
      }
      const working =
        (await mine(ctx)) ??
        (await start(ctx, remote.git, titleFor([input.path]), true));
      ({ id } = working);
    }
    const opened = await openDraft(ctx, id);
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
    await endRequest(ctx, draft);
    return recheck(ctx, git, draft);
  },
});

export const draftRevert = defineAction({
  name: "draft.revert",
  description:
    "Undo a draft's change to one file: it goes back to how it was when the draft began, so the draft no longer changes it. Withdraws a request for approval, like a save.",
  input: z.strictObject({ id: z.uuid(), path: configFile }),
  output: checkedSchema,
  handler: async (ctx, { id, path }) => {
    const opened = await openDraft(ctx, id);
    if (!("draft" in opened)) {
      return opened;
    }
    const { draft, git } = opened;
    const diff = await git.diff(draft.baseSha, await git.head(draft.branch));
    const changed = diff.find((each) => each.path === path);
    if (!changed) {
      return ctx.invalid(`This draft doesn't change ${path}.`);
    }
    const committed = await git.commit({
      branch: draft.branch,
      path,
      content: changed.before,
      message: `Revert ${path}${trailers(ctx, draft.id)}`,
      author: authorOf(ctx),
    });
    if (committed.status === "conflict") {
      return ctx.conflict(
        "Someone else saved this draft at the same moment. Read it again and retry."
      );
    }
    await endRequest(ctx, draft);
    return recheck(ctx, git, draft);
  },
});

export const draftDiscard = defineAction({
  name: "draft.discard",
  description:
    "Throw a draft away: it's abandoned, its branch is deleted and any request for approval is withdrawn. Nothing it changed is published.",
  input: z.strictObject({ id: z.uuid() }),
  output: z.object({ draft: draftSchema }),
  handler: async (ctx, { id }) => {
    const opened = await openDraft(ctx, id);
    if (!("draft" in opened)) {
      return opened;
    }
    const { draft, git } = opened;
    await endRequest(ctx, draft);
    await ctx.drafts.update(draft.id, { status: "abandoned" });
    await git.remove(draft.branch);
    const discarded = await ctx.dal.draftDetail(draft.id);
    if (!discarded) {
      throw new Error(`Draft ${draft.id} vanished while it was discarded.`);
    }
    return { draft: toDraft(discarded) };
  },
});

export const draftPublish = defineAction({
  name: "draft.publish",
  description:
    "Publish a valid draft: its files go onto production as one commit, which is copied to main, and the running system loads it. When an approval rule covers its files, it asks the rule's approvers instead and the draft waits in awaiting_approval; the last approval publishes it, as you. A title names the published commit.",
  input: z.strictObject({
    id: z.uuid(),
    title: z.string().min(1).max(200).optional(),
  }),
  output: z.object({ draft: draftSchema }),
  emits: {
    "draft.published": z.object({
      draftId: z.uuid(),
      sha: z.string(),
      files: z.array(z.string()),
    }),
  },
  handler: async (ctx, { id, title }) => {
    const opened = await openDraft(ctx, id);
    if (!("draft" in opened)) {
      return opened;
    }
    const { git } = opened;
    let { draft } = opened;
    if (title !== undefined && draft.status !== "awaiting_approval") {
      await ctx.drafts.update(draft.id, { title, autoTitle: false });
      draft = { ...draft, title, autoTitle: false };
    }
    if (draft.files.length === 0) {
      return ctx.invalid("This draft changes nothing yet. Save a file first.");
    }
    if (draft.status === "awaiting_approval") {
      const waiting = await ctx.approvals.forSubject("draft", draft.id);
      const rule =
        waiting.find((each) => each.status === "pending")?.ruleKey ?? "";
      return ctx.needsApproval(
        rule,
        "This draft is waiting for approval, and publishes once it's approved."
      );
    }
    if (draft.status !== "valid") {
      return ctx.invalid(
        "Only a valid draft can be published. Fix its problems and save again."
      );
    }
    // What the rules ask now. Approvals already given count only when they
    // cover all of it; otherwise a new round asks for every sign-off.
    const needed = signOffs(ctx, draft.files);
    if (
      unmetSignOff(needed, await ctx.approvals.forSubject("draft", draft.id))
    ) {
      await ctx.approvals.cancelOpen("draft", draft.id, ctx.clock.now());
      await ctx.approvals.request("draft", draft.id, needed, ctx.actor.id);
      // This same call runs again, as this actor, once it's approved.
      const publishRunId = await ctx.approvals.park();
      await ctx.drafts.update(draft.id, {
        status: "awaiting_approval",
        publishRunId,
      });
      const waiting = await ctx.dal.draftDetail(draft.id);
      if (!waiting) {
        throw new Error(`Draft ${draft.id} vanished while it was submitted.`);
      }
      return { draft: toDraft(waiting) };
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
      publishRunId: null,
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

/** The commit a draft's files are at: published, or its branch's head. */
const draftCommit = async (git: GitService | undefined, draft: DraftEntry) =>
  draft.publishedSha ?? (await branchHead(git, draft.branch));

export const draftGet = defineQuery({
  name: "draft.get",
  description:
    "One config draft: each file it changes before and after, as YAML and as values (null where the file doesn't exist), its approvals, and, when it's invalid, its problems.",
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
    problems: z.array(problemSchema),
  }),
  handler: async (ctx, { id }) => {
    const draft = await ctx.dal.draftDetail(id);
    if (!draft) {
      return ctx.notFound("draft", id);
    }
    const to = await draftCommit(ctx.git, draft);
    const [diff, approvals, check] = await Promise.all([
      ctx.git && to ? ctx.git.diff(draft.baseSha, to) : [],
      ctx.dal.approvalList({ subjectId: id, limit: 200 }),
      // Only an invalid draft has problems worth checking again for.
      ctx.git && to && draft.status === "invalid"
        ? ctx.git.check(to)
        : { files: 0, problems: [] },
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
      problems: problemsOf(check),
    };
  },
});

export const draftFiles = defineQuery({
  name: "draft.files",
  description:
    "Every config file as a draft has it, with its YAML and its value, for editing it. Without an id, as your working draft has it, or as production has it when you have none; draftId says which.",
  input: z.strictObject({ id: z.uuid().optional() }),
  output: z.object({
    /** The draft the files are from; null for production. */
    draftId: z.uuid().nullable(),
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
    if (!ctx.git) {
      return ctx.invalid(noRemote);
    }
    const draft =
      id === undefined ? await mine(ctx) : await ctx.dal.draftDetail(id);
    if (id !== undefined && !draft) {
      return ctx.notFound("draft", id);
    }
    const at = draft
      ? await draftCommit(ctx.git, draft)
      : await ctx.git.head(ctx.git.production);
    if (!at) {
      return ctx.invalid(noRemote);
    }
    const files = await ctx.git.files(at);
    return {
      draftId: draft?.id ?? null,
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
  draftMine,
  draftSave,
  draftRevert,
  draftDiscard,
  draftPublish,
  draftList,
  draftGet,
  draftFiles,
] as const;
