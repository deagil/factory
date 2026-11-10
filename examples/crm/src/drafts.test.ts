// Drafts over git (P2.08): against a bare test remote, a draft that edits two
// files publishes in one commit, the loader picks it up, and main has the
// same changes. A draft the config_changes rule covers waits for an admin's
// approval (P2.09), and the last approval publishes it. Each person's saves
// go into their working draft, which they can undo or discard (decision 0044).
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AnyActionDefinition,
  AnyQueryDefinition,
} from "@workspace/actions";
import { runs, bootstrapStaff, drafts } from "@workspace/db";
import { createServer, defineSystem } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { crm } from "./system.ts";

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Dev",
  GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Dev",
  GIT_COMMITTER_EMAIL: "dev@example.com",
};
/** Added and removed lines of a unified diff, without the file headers. */
const changedLines = (diff: string) =>
  diff
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") || line.startsWith("-")) &&
        !line.startsWith("+++") &&
        !line.startsWith("---")
    );

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();

/** A role file that can view deals. */
const role = (key: string) =>
  `key: ${key}\nlabel: ${key}\nobjects:\n  deal:\n    endpoints: [list, get]\n    rows: all\n`;

// Each test runs dozens of git commands, slow when every suite runs at once.
describe("drafts over git", { timeout: 30_000 }, () => {
  const configDir = path.resolve(import.meta.dirname, "../config");
  // A bare remote whose main and production have the CRM's config.
  const root = mkdtempSync(path.join(tmpdir(), "crm-drafts-"));
  const bare = path.join(root, "remote.git");
  const work = path.join(root, "work");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", bare);
  git(root, "clone", "--quiet", bare, work);
  cpSync(configDir, path.join(work, "config"), { recursive: true });
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "seed");
  git(work, "push", "--quiet", "origin", "HEAD:main", "HEAD:production");

  const system = defineSystem({
    name: crm.name,
    objects: crm.objects,
    // The CRM's hand-written actions, which its roles grant.
    actions: crm.registry
      .list()
      .filter(
        (definition) =>
          definition.name === "contact.moveToOrganisation" ||
          definition.name === "deal_create" ||
          definition.name === "deal.moveStage"
      ),
    migrations: crm.migrations,
    config: configDir,
  });
  const action = (name: string) =>
    system.registry.get(name) as AnyActionDefinition;

  let database: SystemDatabase;
  let server: Server;
  let admin: { actorId: string };
  let bea: { actorId: string };

  beforeAll(async () => {
    database = await createSystemDatabase(system);
    server = await createServer(system, {
      databaseUrl: database.url,
      authSecret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:4000",
      log: () => {},
      configRemote: { url: bare, cacheDir: path.join(root, "cache.git") },
    });
    const ada = await bootstrapStaff(server.db, {
      name: "Ada Admin",
      email: "ada@example.com",
      roles: ["admin"],
    });
    admin = { actorId: ada.id };
    const second = await bootstrapStaff(server.db, {
      name: "Bea Admin",
      email: "bea@example.com",
      roles: ["admin"],
    });
    bea = { actorId: second.id };
  });

  afterAll(async () => {
    await server?.close();
    await database?.close();
  });

  const open = async (title: string, by = admin) => {
    const opened = await server.pipeline.run(
      action("draft.open"),
      { title },
      by
    );
    if (!opened.ok) {
      throw new Error(JSON.stringify(opened.error));
    }
    return (opened.output as { draft: { id: string } }).draft.id;
  };
  const save = (id: string, file: string, content: string, by = admin) =>
    server.pipeline.run(action("draft.save"), { id, path: file, content }, by);

  it("publishes two files in one commit, which the loader and main pick up", async () => {
    const id = await open("Add a negotiation stage");
    const stages = readFileSync(
      path.join(configDir, "choices", "deal_stages.yaml"),
      "utf-8"
    );
    await save(
      id,
      "config/choices/deal_stages.yaml",
      stages.replace(
        "  - key: won",
        "  - key: negotiation\n    label: Negotiation\n    category: open\n  - key: won"
      )
    );
    const saved = await save(
      id,
      "config/roles/viewer.yaml",
      "key: viewer\nlabel: Viewer\nobjects:\n  deal:\n    endpoints: [list, get]\n    rows: all\n"
    );
    expect(saved).toMatchObject({
      ok: true,
      output: {
        draft: {
          status: "valid",
          files: [
            "config/choices/deal_stages.yaml",
            "config/roles/viewer.yaml",
          ],
        },
        problems: [],
      },
    });

    const before = git(bare, "rev-parse", "production");
    const published = await server.pipeline.run(
      action("draft.publish"),
      { id },
      admin
    );
    expect(published).toMatchObject({
      ok: true,
      output: { draft: { status: "published" } },
    });
    expect({
      // One commit on production, by Ada.
      commits: git(bare, "rev-list", "--count", `${before}..production`),
      author: git(bare, "log", "-1", "--format=%an", "production"),
      // The loader runs it, with the new stage and role.
      live: server.config.current()?.sha,
      stages: server.config.service
        .choices?.("deal_stages")
        ?.map((each) => each.key),
      roles: server.config.service.roles.map((each) => each.key),
      // Main has the same changes.
      mainDiff: git(
        bare,
        "diff",
        "--stat",
        "production",
        "main",
        "--",
        "config"
      ),
    }).toMatchObject({
      commits: "1",
      author: "Ada Admin",
      live: git(bare, "rev-parse", "production"),
      stages: expect.arrayContaining(["negotiation"]),
      roles: expect.arrayContaining(["viewer"]),
      mainDiff: "",
    });
  });

  it("saves a file as a value and reads the draft back as values", async () => {
    const query = (name: string, input: object) =>
      server.pipeline.query(
        system.registry.get(name) as AnyQueryDefinition,
        input,
        admin
      );
    const id = await open("Add a closing stage");
    const listed = await query("draft.files", { id });
    const { files } = (
      listed as { output: { files: { path: string; value: unknown }[] } }
    ).output;
    const stages = files.find(
      (file) => file.path === "config/choices/deal_stages.yaml"
    )?.value as { key: string; options: object[] };
    const saved = await server.pipeline.run(
      action("draft.save"),
      {
        id,
        path: "config/choices/deal_stages.yaml",
        value: {
          ...stages,
          options: [
            ...stages.options,
            { key: "closing", label: "Closing", category: "open" },
          ],
        },
      },
      admin
    );
    const got = await query("draft.get", { id });
    expect({
      paths: files.map((file) => file.path),
      saved,
      got,
    }).toMatchObject({
      paths: expect.arrayContaining(["config/roles/sales.yaml"]),
      saved: { ok: true, output: { draft: { status: "valid" } } },
      got: {
        ok: true,
        output: {
          changes: [
            {
              type: "choices",
              key: "deal_stages",
              afterValue: {
                options: expect.arrayContaining([
                  expect.objectContaining({ key: "closing" }),
                ]),
              },
            },
          ],
          approvals: [],
        },
      },
    });
  });

  it("marks an invalid draft and won't publish it", async () => {
    const id = await open("Break sales");
    const saved = await save(
      id,
      "config/roles/sales.yaml",
      "key: sales\nlabel: Sales\nobjects:\n  invoice:\n    endpoints: [list]\n    rows: all\n"
    );
    expect(saved).toMatchObject({
      ok: true,
      output: {
        draft: { status: "invalid" },
        problems: [
          expect.objectContaining({ file: "config/roles/sales.yaml" }),
        ],
      },
    });
    await expect(
      server.pipeline.run(action("draft.publish"), { id }, admin)
    ).resolves.toMatchObject({ ok: false, error: { code: "validation" } });
    // draft.get finds the problems again, for the review page (P2.10b).
    await expect(
      server.pipeline.query(
        system.registry.get("draft.get") as AnyQueryDefinition,
        { id },
        admin
      )
    ).resolves.toMatchObject({
      ok: true,
      output: {
        problems: [
          expect.objectContaining({ file: "config/roles/sales.yaml" }),
        ],
      },
    });
  });

  const query = (name: string, input: object, by = admin) =>
    server.pipeline.query(
      system.registry.get(name) as AnyQueryDefinition,
      input,
      by
    );
  const agentFor = async (name: string) => {
    const created = await server.pipeline.run(
      action("actor.createAgent"),
      { name },
      admin
    );
    return {
      actorId: (created as { output: { actorId: string } }).output.actorId,
    };
  };
  const pendingOn = async (id: string) => {
    const listed = await query("approval.list", { subjectId: id });
    return (
      listed as { output: { approvals: { id: string; status: string }[] } }
    ).output.approvals;
  };
  const statusOf = async (runId: string) => {
    const [row] = await server.db
      .select({ status: runs.status, actorId: runs.actorId })
      .from(runs)
      .where(eq(runs.id, runId));
    return row;
  };

  it("saves into each person's working draft, and undoes or discards it", async () => {
    // Before Bea's first save, her files are production's.
    const live = await query("draft.files", {}, bea);
    const first = await server.pipeline.run(
      action("draft.save"),
      { path: "config/roles/clerk.yaml", content: role("clerk") },
      bea
    );
    const second = await server.pipeline.run(
      action("draft.save"),
      { path: "config/roles/reader.yaml", content: role("reader") },
      bea
    );
    const { id } = (first as { output: { draft: { id: string } } }).output
      .draft;
    const mine = await query("draft.mine", {}, bea);
    const files = await query("draft.files", {}, bea);
    const reverted = await server.pipeline.run(
      action("draft.revert"),
      { id, path: "config/roles/clerk.yaml" },
      bea
    );
    const notChanged = await server.pipeline.run(
      action("draft.revert"),
      { id, path: "config/roles/clerk.yaml" },
      bea
    );
    const branches = () => git(bare, "branch", "--list", `draft/${id}`);
    const before = branches();
    const discarded = await server.pipeline.run(
      action("draft.discard"),
      { id },
      bea
    );
    expect({
      live,
      files,
      first,
      second,
      mine,
      reverted,
      notChanged,
      before,
      discarded,
      after: branches(),
      gone: await query("draft.mine", {}, bea),
    }).toMatchObject({
      live: {
        ok: true,
        output: {
          draftId: null,
          files: expect.not.arrayContaining([
            expect.objectContaining({ path: "config/roles/clerk.yaml" }),
          ]),
        },
      },
      files: {
        ok: true,
        output: {
          draftId: id,
          files: expect.arrayContaining([
            expect.objectContaining({ path: "config/roles/clerk.yaml" }),
          ]),
        },
      },
      first: {
        ok: true,
        output: { draft: { title: "Edit clerk", status: "valid" } },
      },
      second: {
        ok: true,
        output: {
          draft: {
            id,
            title: "Edit clerk and reader",
            files: ["config/roles/clerk.yaml", "config/roles/reader.yaml"],
          },
        },
      },
      mine: { ok: true, output: { draft: { id } } },
      reverted: {
        ok: true,
        output: {
          draft: { title: "Edit reader", files: ["config/roles/reader.yaml"] },
        },
      },
      notChanged: { ok: false, error: { code: "validation" } },
      before: expect.stringContaining(`draft/${id}`),
      discarded: { ok: true, output: { draft: { status: "abandoned" } } },
      after: "",
      gone: { ok: true, output: { draft: null } },
    });
  });

  it("asks for approval when an agent publishes, and the last approval publishes it as the agent", async () => {
    // Ada's agent acts for her, but agents always need a person's approval,
    // and not Ada's: it's her request.
    const agent = await agentFor("Ada's agent");
    const id = await open("Add an auditor role", agent);
    await save(id, "config/roles/auditor.yaml", role("auditor"), agent);
    const check = await query("approval.check", { draftId: id }, agent);
    const asked = await server.pipeline.run(
      action("draft.publish"),
      { id, title: "Add an auditor" },
      agent
    );
    const again = await server.pipeline.run(
      action("draft.publish"),
      { id },
      agent
    );
    const [approval] = await pendingOn(id);
    const parked = await query("draft.get", { id });
    const byAda = await server.pipeline.run(
      action("approval.approve"),
      { id: approval?.id },
      admin
    );
    const before = git(bare, "rev-parse", "production");
    const approved = await server.pipeline.run(
      action("approval.approve"),
      { id: approval?.id },
      bea
    );
    const { ran } = (approved as { output: { ran: { runId: string } } }).output;
    expect({
      check,
      asked,
      again,
      byAda,
      approved,
      run: await statusOf(ran.runId),
      draft: await query("draft.get", { id }),
      commits: git(bare, "rev-list", "--count", `${before}..production`),
      author: git(bare, "log", "-1", "--format=%an %s", "production"),
      roles: server.config.service.roles.map((each) => each.key),
      parked,
    }).toMatchObject({
      check: {
        ok: true,
        output: {
          signOffs: [{ rule: "config_changes", approverRole: "admin" }],
        },
      },
      asked: {
        ok: true,
        output: {
          draft: { status: "awaiting_approval", title: "Add an auditor" },
        },
      },
      again: {
        ok: false,
        error: { code: "approval_required", rule: "config_changes" },
      },
      byAda: { ok: false, error: { code: "permission" } },
      approved: {
        ok: true,
        output: { approval: { status: "approved" }, ran: { ok: true } },
      },
      run: { status: "succeeded", actorId: agent.actorId },
      draft: { output: { draft: { status: "published" } } },
      commits: "1",
      author: "Ada's agent Add an auditor",
      roles: expect.arrayContaining(["auditor"]),
      parked: { output: { draft: { status: "awaiting_approval" } } },
    });
  });

  it("lets the person an agent asked for withdraw, and a save or a rejection ends a request", async () => {
    const agent = await agentFor("Ada's other agent");
    const publish = (id: string) =>
      server.pipeline.run(action("draft.publish"), { id }, agent);
    const parkedOf = async (id: string) => {
      const found = await server.db
        .select({ id: drafts.publishRunId })
        .from(drafts)
        .where(eq(drafts.id, id));
      return found[0]?.id ?? "";
    };

    // Withdrawn by Ada, whom the agent acts for; Bea can't.
    const one = await open("Add a counter role", agent);
    await save(one, "config/roles/counter.yaml", role("counter"), agent);
    await publish(one);
    const firstParked = await parkedOf(one);
    const byBea = await server.pipeline.run(
      action("approval.withdraw"),
      { subjectId: one },
      bea
    );
    const withdrawn = await server.pipeline.run(
      action("approval.withdraw"),
      { subjectId: one },
      admin
    );

    // A save while it waits withdraws the request.
    await publish(one);
    const secondParked = await parkedOf(one);
    const resaved = await save(
      one,
      "config/roles/counter.yaml",
      role("counter").replace("label: counter", "label: Counter"),
      agent
    );

    // A rejection closes the parked publish.
    await publish(one);
    const thirdParked = await parkedOf(one);
    const rows = await pendingOn(one);
    const approval = rows.find((each) => each.status === "pending");
    const rejected = await server.pipeline.run(
      action("approval.reject"),
      { id: approval?.id },
      bea
    );
    expect({
      byBea,
      withdrawn,
      first: await statusOf(firstParked),
      resaved,
      second: await statusOf(secondParked),
      rejected,
      third: await statusOf(thirdParked),
      draft: await query("draft.get", { id: one }),
    }).toMatchObject({
      byBea: { ok: false, error: { code: "permission" } },
      withdrawn: { ok: true, output: { withdrawn: 1 } },
      first: { status: "withdrawn" },
      resaved: { ok: true, output: { draft: { status: "valid" } } },
      second: { status: "withdrawn" },
      rejected: { ok: true },
      third: { status: "rejected" },
      draft: { output: { draft: { status: "valid" } } },
    });
  });

  it("saves with a revision, refuses a stale one, and keeps the file's comments", async () => {
    const id = await open("Revise a workflow");
    const opened = await query("draft.get", { id });
    const workflow = "config/workflows/deal_move_stage.yaml";
    const read = await query("draft.files", { id, path: workflow });
    const { files } = (
      read as {
        output: {
          files: {
            revision: string;
            value: {
              steps: { id?: string; with?: Record<string, unknown> }[];
            };
          }[];
        };
      }
    ).output;
    const [file] = files;
    if (!file) {
      throw new Error("deal_move_stage wasn't in the draft");
    }
    const update = file.value.steps.find((step) => step.id === "update");
    if (!update?.with) {
      throw new Error("update has no with");
    }
    update.with = { id: { from: "input.deal" }, stage: { value: "won" } };
    const saved = await server.pipeline.run(
      action("draft.save"),
      { id, path: workflow, value: file.value, revision: file.revision },
      admin
    );
    const stale = await server.pipeline.run(
      action("draft.save"),
      {
        id,
        path: workflow,
        value: file.value,
        revision: file.revision,
      },
      admin
    );
    const without = await server.pipeline.run(
      action("draft.save"),
      {
        id,
        path: workflow,
        value: {
          ...file.value,
          description: "Move a deal, and say why.",
        },
      },
      admin
    );
    const { draft } = (
      saved as {
        output: {
          draft: { baseSha: string; headSha: string };
          revision: string;
        };
      }
    ).output;
    const diff = git(
      bare,
      "diff",
      draft.baseSha,
      draft.headSha,
      "--",
      workflow
    );
    const shown = git(bare, "show", `${draft.headSha}:${workflow}`);
    const stagesPath = "config/choices/deal_stages.yaml";
    const stages = await query("draft.files", { id, path: stagesPath });
    const [stageFile] = (
      stages as {
        output: {
          files: {
            revision: string;
            value: { options: { key: string; label: string }[] };
          }[];
        };
      }
    ).output.files;
    if (!stageFile) {
      throw new Error("deal_stages wasn't in the draft");
    }
    const lead = stageFile.value.options.find(
      (option) => option.key === "lead"
    );
    if (!lead) {
      throw new Error("no lead stage");
    }
    lead.label = "New lead";
    const stagesSaved = await server.pipeline.run(
      action("draft.save"),
      {
        id,
        path: stagesPath,
        value: stageFile.value,
        revision: stageFile.revision,
      },
      admin
    );
    const rolePath = "config/roles/sales.yaml";
    const roles = await query("draft.files", { id, path: rolePath });
    const [roleFile] = (
      roles as {
        output: { files: { revision: string; value: { label: string } }[] };
      }
    ).output.files;
    if (!roleFile) {
      throw new Error("sales wasn't in the draft");
    }
    roleFile.value.label = "Sales team";
    await server.pipeline.run(
      action("draft.save"),
      {
        id,
        path: rolePath,
        value: roleFile.value,
        revision: roleFile.revision,
      },
      admin
    );
    const head = git(bare, "rev-parse", `draft/${id}`);
    const stageDiff = git(
      bare,
      "diff",
      `${draft.headSha}..${head}`,
      "--",
      stagesPath
    );
    const roleDiff = git(
      bare,
      "diff",
      `${draft.headSha}..${head}`,
      "--",
      rolePath
    );
    const stageShown = git(bare, "show", `${head}:${stagesPath}`);
    const roleShown = git(bare, "show", `${head}:${rolePath}`);
    const reverted = await server.pipeline.run(
      action("draft.revert"),
      { id, path: workflow },
      admin
    );
    const savedRevision = (saved as { output: { revision: string } }).output
      .revision;
    const revertedHead = (
      reverted as { output: { draft: { headSha: string } } }
    ).output.draft.headSha;
    expect({
      opened,
      oneFile: files.length,
      saved,
      stale,
      without,
      blob: git(bare, "rev-parse", `${draft.headSha}:${workflow}`),
      changed: changedLines(diff),
      stagesSaved,
      stageChanged: changedLines(stageDiff),
      roleChanged: changedLines(roleDiff),
      reverted,
      keptHeader: shown.startsWith("# Moving a deal's stage"),
      keptStageHeader: stageShown.startsWith("# deal.stage."),
      keptRoleComment: roleShown.includes(
        "write: { except: [organisation] } # contact.moveToOrganisation moves it"
      ),
      keptOwnComment: roleShown.includes(
        "rows: own # the deal's owner is them"
      ),
      headMoved: revertedHead !== draft.headSha,
      // The stale save changed nothing: the description save is what moved the file on.
      described: git(bare, "show", `${head}:${workflow}`).includes(
        "description: Move a deal, and say why."
      ),
    }).toMatchObject({
      opened: { output: { draft: { headSha: null } } },
      oneFile: 1,
      saved: {
        ok: true,
        output: {
          revision: savedRevision,
          draft: { headSha: expect.any(String) },
        },
      },
      stale: {
        ok: false,
        error: { code: "conflict", revision: savedRevision },
      },
      without: { ok: true },
      blob: savedRevision,
      changed: [
        "-      stage: { from: input.stage }",
        "+      stage: { value: won }",
      ],
      stagesSaved: { ok: true },
      stageChanged: ["-    label: Lead", "+    label: New lead"],
      roleChanged: ["-label: Sales", "+label: Sales team"],
      reverted: { ok: true, output: { draft: { headSha: revertedHead } } },
      keptHeader: true,
      keptStageHeader: true,
      keptRoleComment: true,
      keptOwnComment: true,
      headMoved: true,
      described: true,
    });
  });

  it("lets an agent save into its person's draft, and refuses a stranger", async () => {
    const agent = await agentFor("Ada's editor");
    const id = await open("Ada's working edits");
    const byAgent = await save(
      id,
      "config/roles/auditor.yaml",
      role("auditor"),
      agent
    );
    const byStranger = await save(
      id,
      "config/roles/intruder.yaml",
      role("intruder"),
      bea
    );
    const agentsDraft = await open("The agent's own draft", agent);
    const byPerson = await save(
      agentsDraft,
      "config/roles/helper.yaml",
      role("helper"),
      admin
    );
    const byOtherAgent = await agentFor("Ada's other editor");
    const bySibling = await save(
      agentsDraft,
      "config/roles/sibling.yaml",
      role("sibling"),
      byOtherAgent
    );
    const mine = await query("draft.mine", {}, admin);
    expect({ byAgent, byStranger, byPerson, bySibling, mine }).toMatchObject({
      byAgent: {
        ok: true,
        output: { draft: { id, headSha: expect.any(String) } },
      },
      byStranger: { ok: false, error: { code: "permission" } },
      byPerson: { ok: true, output: { draft: { id: agentsDraft } } },
      bySibling: { ok: false, error: { code: "permission" } },
      mine: { ok: true, output: { draft: { headSha: expect.any(String) } } },
    });
  });
});
