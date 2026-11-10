import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { defineAction, failures, isActionFailure } from "@workspace/actions";
import type { AnyActionDefinition } from "@workspace/actions";
import { createGitConfigService } from "@workspace/config";
import type { ConfigCatalog } from "@workspace/config";
import type { DraftEntry } from "@workspace/objects";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { coreStepActions, coreWorkflows } from "./code.ts";
import { defineWorkflow } from "./define-workflow.ts";
import { workflowEntries } from "./entries.ts";
import { getWorkflow, listWorkflows } from "./reading.ts";
import type { WorkflowReadContext } from "./reading.ts";

const ping = defineAction({
  name: "ping",
  kind: "internal",
  readOnly: true,
  description: "Ping.",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  handler: () => ({ ok: true }),
});

const coreActions = coreStepActions({
  objects: [],
  steps: new Map(),
  definitions: () => [],
  codeWorkflows: new Map(),
});

const catalog: ConfigCatalog = {
  objects: new Map(),
  actions: new Set(),
  objectActions: new Map(),
  owners: new Set(),
  events: new Set(),
  choiceLists: [],
  stepActions: new Map<string, AnyActionDefinition>([
    ...coreActions.map(
      (action) => [action.name, action] as [string, AnyActionDefinition]
    ),
    [ping.name, ping],
  ]),
  workflows: new Map(coreWorkflows.map((workflow) => [workflow.key, workflow])),
};

const flow = (key: string, description: string) =>
  defineWorkflow({
    key,
    description,
    starts_when: "called",
    read_only: true,
    steps: [{ id: "ping", action: "ping" }],
  });

const yaml = (key: string, description: string) =>
  `key: ${key}\ndescription: ${description}\nstarts_when: called\nread_only: true\nsteps:\n  - id: ping\n    action: ping\n`;

const actorId = "00000000-0000-4000-8000-000000000001";
const draftId = "00000000-0000-4000-8000-0000000000d1";

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Dev",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Dev",
  GIT_COMMITTER_EMAIL: "dev@example.com",
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, encoding: "utf-8" }).trim();

const reader = (
  over: Partial<WorkflowReadContext> & Pick<WorkflowReadContext, "config">
): WorkflowReadContext => ({
  git: undefined,
  draft: () => Promise.resolve(null),
  actor: () => Promise.resolve(null),
  invalid: (message) => failures.invalid(message),
  notFound: (object, id) => failures.notFound(object, id),
  ...over,
});

describe("reading workflows", () => {
  it("keeps each workflow's output aligned with its action", () => {
    for (const workflow of coreWorkflows) {
      const action = coreActions.find((item) => item.name === workflow.key);
      expect(workflow.read_only).toBeTruthy();
      expect(workflow.steps).toStrictEqual([
        expect.objectContaining({ id: "read", action: workflow.key }),
      ]);
      expect(Object.keys(workflow.output ?? {}).toSorted()).toStrictEqual(
        Object.keys(action?.output.shape ?? {}).toSorted()
      );
    }
  });

  it("reads live workflows without a config remote, and refuses a draft", async () => {
    const pingFlow = flow("ping_flow", "Ping something.");
    const ctx = reader({
      config: {
        sha: "abc",
        roles: [],
        catalog,
        workflows: workflowEntries([...coreWorkflows, pingFlow]),
      },
    });
    const listed = await listWorkflows(ctx, {});
    const got = await getWorkflow(ctx, { key: "ping_flow" });
    const code = await getWorkflow(ctx, { key: "workflow_list" });
    const refused = await getWorkflow(ctx, {
      key: "ping_flow",
      draft_id: draftId,
    });
    if (
      isActionFailure(listed) ||
      isActionFailure(got) ||
      isActionFailure(code)
    ) {
      throw new Error("a live read failed");
    }
    expect({
      keys: listed.workflows.map((workflow) => workflow.key),
      ping: listed.workflows.find((workflow) => workflow.key === "ping_flow"),
      got,
      code,
      hasKey: got.content.includes("key: ping_flow"),
    }).toMatchObject({
      keys: [
        "action_list",
        "event_list",
        "ping_flow",
        "workflow_get",
        "workflow_list",
      ],
      ping: {
        source: "config",
        path: "config/workflows/ping_flow.yaml",
        change: null,
      },
      got: {
        source: "config",
        editable: false,
        why: "no_config_remote",
        revision: null,
        behind: false,
        check: { problems: [], warnings: [] },
      },
      code: { source: "code", editable: false, why: "code", revision: null },
      hasKey: true,
    });
    expect(isActionFailure(refused) && refused.error).toMatchObject({
      code: "validation",
      message:
        "Drafts need a config remote. This system reads config/ from its working tree, so edit the files there.",
    });
  });

  it(
    "reads a draft and a past commit from the config remote",
    { timeout: 30_000 },
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "workflow-read-"));
      const bare = path.join(root, "remote.git");
      git(root, "init", "--quiet", "--bare", "--initial-branch=main", bare);
      const work = path.join(root, "work");
      git(root, "clone", "--quiet", bare, work);
      mkdirSync(path.join(work, "config", "workflows"), { recursive: true });
      writeFileSync(
        path.join(work, "config", "workflows", "ping_flow.yaml"),
        yaml("ping_flow", "Ping something.")
      );
      writeFileSync(
        path.join(work, "config", "workflows", "gone_flow.yaml"),
        yaml("gone_flow", "Going away.")
      );
      git(work, "add", ".");
      git(work, "commit", "--quiet", "-m", "seed");
      git(work, "push", "--quiet", "origin", "HEAD:main", "HEAD:production");
      const service = createGitConfigService({
        remote: bare,
        cacheDir: path.join(root, "cache.git"),
        types: [],
        catalog: () => catalog,
      });
      const base = await service.branch("draft/one");
      await service.commit({
        branch: "draft/one",
        path: "config/workflows/ping_flow.yaml",
        content: yaml("ping_flow", "Ping from the draft."),
        message: "Change ping",
        author: { name: "Sarah", email: "sarah@example.com" },
      });
      await service.commit({
        branch: "draft/one",
        path: "config/workflows/gone_flow.yaml",
        content: null,
        message: "Remove gone",
        author: { name: "Sarah", email: "sarah@example.com" },
      });
      await service.commit({
        branch: "draft/one",
        path: "config/workflows/new_flow.yaml",
        content: yaml("new_flow", "Just added."),
        message: `Add new\n\nActor-Id: ${actorId}\n`,
        author: { name: "Sarah", email: "sarah@example.com" },
      });
      writeFileSync(
        path.join(work, "config", "workflows", "ping_flow.yaml"),
        yaml("ping_flow", "Ping from production.")
      );
      git(work, "commit", "--quiet", "-am", "Production moves");
      git(work, "push", "--quiet", "origin", "HEAD:production");
      const liveSha = await service.head("production");
      const draft: DraftEntry = {
        id: draftId,
        branch: "draft/one",
        title: "Edit ping",
        autoTitle: false,
        files: [
          "config/workflows/ping_flow.yaml",
          "config/workflows/gone_flow.yaml",
          "config/workflows/new_flow.yaml",
        ],
        status: "draft",
        baseSha: base,
        headSha: null,
        publishedSha: null,
        syncedSha: null,
        publishRunId: null,
        createdBy: { id: actorId, name: "Sarah" },
        createdAt: "2026-11-10T00:00:00.000Z",
        publishedAt: null,
      };
      const ctx = reader({
        git: service,
        config: {
          sha: liveSha,
          roles: [],
          catalog,
          workflows: workflowEntries([
            ...coreWorkflows,
            flow("ping_flow", "Ping from production."),
            flow("gone_flow", "Going away."),
          ]),
        },
        draft: (id) => Promise.resolve(id === draftId ? draft : null),
        actor: (id) =>
          Promise.resolve(id === actorId ? { id, name: "Sarah" } : null),
      });
      const listed = await listWorkflows(ctx, { draft_id: draftId });
      const got = await getWorkflow(ctx, {
        key: "ping_flow",
        draft_id: draftId,
      });
      const past = await getWorkflow(ctx, { key: "ping_flow", sha: base });
      const both = await getWorkflow(ctx, {
        key: "ping_flow",
        draft_id: draftId,
        sha: base,
      });
      const missing = await getWorkflow(ctx, {
        key: "ping_flow",
        draft_id: "00000000-0000-4000-8000-0000000000d2",
      });
      if (
        isActionFailure(listed) ||
        isActionFailure(got) ||
        isActionFailure(past)
      ) {
        throw new Error(JSON.stringify({ listed, got, past }));
      }
      const change = (key: string) =>
        listed.workflows.find((workflow) => workflow.key === key)?.change;
      expect({
        ping: change("ping_flow"),
        gone: change("gone_flow"),
        added: change("new_flow"),
        code: change("workflow_list"),
      }).toStrictEqual({
        ping: "changed",
        gone: "removed",
        added: "added",
        code: null,
      });
      expect(got).toMatchObject({
        source: "config",
        editable: true,
        why: null,
        behind: true,
        revision: git(
          bare,
          "rev-parse",
          "draft/one:config/workflows/ping_flow.yaml"
        ),
        live_revision: git(
          bare,
          "rev-parse",
          "production:config/workflows/ping_flow.yaml"
        ),
        at: {
          kind: "draft",
          saved_by: { id: actorId, name: "Sarah" },
        },
      });
      expect({
        draft: got.content.includes("Ping from the draft."),
        savedAt: typeof got.at.saved_at,
        past,
        pastText: past.content.includes("Ping something."),
        both: isActionFailure(both) ? both.error.code : null,
        missing: isActionFailure(missing) ? missing.error.code : null,
      }).toMatchObject({
        draft: true,
        savedAt: "string",
        past: {
          editable: false,
          why: "past_version",
          behind: false,
          at: { kind: "version", sha: base },
        },
        pastText: true,
        both: "validation",
        missing: "not_found",
      });
    }
  );
});
