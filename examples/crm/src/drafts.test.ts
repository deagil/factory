// Drafts over git (P2.08): against a bare test remote, a draft that edits two
// files publishes in one commit, the loader picks it up, and main has the
// same changes. A draft the config-changes rule covers waits for an admin's
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
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();

/** A role file that can view deals. */
const role = (key: string) =>
  `key: ${key}\nlabel: ${key}\npermissions:\n  - object: deal\n    can: [view]\n    scope: all\n`;

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
          definition.name === "deal.create" ||
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
      path.join(configDir, "choices", "deal-stages.yaml"),
      "utf-8"
    );
    await save(
      id,
      "config/choices/deal-stages.yaml",
      stages.replace(
        "  - key: won",
        "  - key: negotiation\n    label: Negotiation\n    category: open\n  - key: won"
      )
    );
    const saved = await save(
      id,
      "config/roles/viewer.yaml",
      "key: viewer\nlabel: Viewer\npermissions:\n  - object: deal\n    can: [view]\n    scope: all\n"
    );
    expect(saved).toMatchObject({
      ok: true,
      output: {
        draft: {
          status: "valid",
          files: [
            "config/choices/deal-stages.yaml",
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
        .choices?.("deal-stages")
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
      (file) => file.path === "config/choices/deal-stages.yaml"
    )?.value as { key: string; options: object[] };
    const saved = await server.pipeline.run(
      action("draft.save"),
      {
        id,
        path: "config/choices/deal-stages.yaml",
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
              key: "deal-stages",
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
      "key: sales\nlabel: Sales\npermissions:\n  - object: invoice\n    can: [view]\n    scope: all\n"
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
          signOffs: [{ rule: "config-changes", approverRole: "admin" }],
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
        error: { code: "approval_required", rule: "config-changes" },
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
});
