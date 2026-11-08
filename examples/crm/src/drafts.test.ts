// Drafts over git (P2.08): against a bare test remote, a draft that edits two
// files publishes in one commit, the loader picks it up, and main has the
// same changes. A draft the config-changes rule covers waits for an admin's
// approval (P2.09).
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AnyActionDefinition,
  AnyQueryDefinition,
} from "@workspace/actions";
import { bootstrapStaff } from "@workspace/db";
import { createServer, defineSystem } from "@workspace/server";
import type { Server } from "@workspace/server";
import { createSystemDatabase } from "@workspace/server/testing";
import type { SystemDatabase } from "@workspace/server/testing";
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
  });

  it("waits for another admin to approve a draft an agent submits", async () => {
    // Ada's agent acts for her, but agents always need a person's approval,
    // and not Ada's: it's her request.
    const created = await server.pipeline.run(
      action("actor.createAgent"),
      { name: "Ada's agent" },
      admin
    );
    const agent = {
      actorId: (created as { output: { actorId: string } }).output.actorId,
    };
    const id = await open("Add an auditor role", agent);
    await save(
      id,
      "config/roles/auditor.yaml",
      "key: auditor\nlabel: Auditor\npermissions:\n  - object: deal\n    can: [view]\n    scope: all\n",
      agent
    );
    const submitted = await server.pipeline.run(
      action("draft.submit"),
      { id },
      agent
    );
    const early = await server.pipeline.run(
      action("draft.publish"),
      { id },
      agent
    );
    const listed = await server.pipeline.query(
      system.registry.get("approval.list") as AnyQueryDefinition,
      { status: "pending" },
      admin
    );
    const approval = (
      listed as { output: { approvals: { id: string; subjectId: string }[] } }
    ).output.approvals.find((each) => each.subjectId === id);
    const byAda = await server.pipeline.run(
      action("approval.approve"),
      { id: approval?.id },
      admin
    );
    const approved = await server.pipeline.run(
      action("approval.approve"),
      { id: approval?.id },
      bea
    );
    const published = await server.pipeline.run(
      action("draft.publish"),
      { id },
      agent
    );
    expect({ submitted, early, byAda, approved, published }).toMatchObject({
      submitted: {
        ok: true,
        output: { draft: { status: "awaiting_approval" } },
      },
      early: {
        ok: false,
        error: { code: "approval_required", rule: "config-changes" },
      },
      byAda: { ok: false, error: { code: "permission" } },
      approved: { ok: true, output: { approval: { status: "approved" } } },
      published: { ok: true, output: { draft: { status: "published" } } },
    });
  });
});
