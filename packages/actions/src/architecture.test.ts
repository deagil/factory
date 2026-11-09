import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  castProblems,
  commentFileProblems,
  commentProblems,
  dependencyOrder,
  dependencyProblems,
  readWorkspacePackages,
  sourceFiles,
  webImportProblems,
} from "./architecture.ts";
import type { WorkspacePackage } from "./architecture.ts";

const root = path.resolve(import.meta.dirname, "../../..");

/**
 * Files that still widen through a double cast. Choice fields use
 * `isChoiceField` instead. Remove an entry when the cast goes, and don't
 * add one without a reason a guard can't express.
 */
const castAllowlist = [
  "apps/web/src/lib/forms.test.ts",
  "apps/web/src/lib/records.test.ts",
  "examples/crm/src/create-deal.ts",
  "packages/actions/src/generated.ts",
  "packages/actions/src/identity-queries.ts",
  "packages/actions/src/logs.ts",
  "packages/actions/src/record-actions.ts",
  "packages/objects/src/dal/data-access.ts",
  "packages/objects/src/define-object.ts",
  "packages/objects/src/fields/base.ts",
  "packages/objects/src/fields/choice.ts",
  "packages/objects/src/fields/test-helpers.ts",
  "packages/objects/src/repository.ts",
  "packages/workflows/src/config-type.ts",
];

/**
 * Files whose comments still name a plan id, mark unfinished work, or
 * suppress a type error. Drawn from the tree as it is, including workflows.
 * A file not listed here has to stay clean; drop an entry when its comments
 * no longer match.
 */
const commentAllowlist = [
  "apps/web/src/components/access.tsx",
  "apps/web/src/components/activity.tsx",
  "apps/web/src/components/app-shell.tsx",
  "apps/web/src/components/approvals.tsx",
  "apps/web/src/components/choice-lists.tsx",
  "apps/web/src/components/config-editors.tsx",
  "apps/web/src/components/config-files.tsx",
  "apps/web/src/components/drafts.tsx",
  "apps/web/src/components/record-form.tsx",
  "apps/web/src/components/record-history.tsx",
  "apps/web/src/components/workflow-form.tsx",
  "apps/web/src/components/working-draft.tsx",
  "apps/web/src/dev/api-menu.tsx",
  "apps/web/src/dev/api-tools.ts",
  "apps/web/src/dev/inspect-menu.tsx",
  "apps/web/src/dev/session-menu.tsx",
  "apps/web/src/dev/session.ts",
  "apps/web/src/lib/api.ts",
  "apps/web/src/lib/choice-lists.ts",
  "apps/web/src/lib/config-diff.ts",
  "apps/web/src/lib/forms.ts",
  "apps/web/src/lib/mcp.ts",
  "apps/web/src/lib/nav.ts",
  "apps/web/src/lib/records.ts",
  "apps/web/src/lib/roles.ts",
  "apps/web/src/lib/working-draft.ts",
  "apps/web/src/routes/_app/access.actors.$id.tsx",
  "apps/web/src/routes/_app/access.agents.tsx",
  "apps/web/src/routes/_app/access.integrations.tsx",
  "apps/web/src/routes/_app/access.roles.tsx",
  "apps/web/src/routes/_app/access.users.tsx",
  "apps/web/src/routes/_app/account.agents.tsx",
  "apps/web/src/routes/_app/activity.changes.tsx",
  "apps/web/src/routes/_app/activity.events.tsx",
  "apps/web/src/routes/_app/activity.runs.$id.tsx",
  "apps/web/src/routes/_app/activity.runs.index.tsx",
  "apps/web/src/routes/_app/automation.workflows.tsx",
  "apps/web/src/routes/_app/config.drafts.$id.tsx",
  "apps/web/src/routes/_app/config.drafts.index.tsx",
  "apps/web/src/routes/_app/inbox.approvals.tsx",
  "apps/web/src/routes/_app/o.$object.$id.tsx",
  "apps/web/src/routes/_app/o.$object.index.tsx",
  "apps/web/src/routes/_app/o.$object.new.tsx",
  "apps/web/src/routes/_app/settings.api.tsx",
  "apps/web/src/routes/_app/settings.choices.$list.tsx",
  "apps/web/src/routes/_app/settings.choices.index.tsx",
  "apps/web/src/routes/_app/settings.reference.tsx",
  "examples/crm/src/approvals.test.ts",
  "examples/crm/src/config.test.ts",
  "examples/crm/src/create-deal.ts",
  "examples/crm/src/drafts.test.ts",
  "examples/crm/src/events.test.ts",
  "examples/crm/src/main.ts",
  "examples/crm/src/move-stage.ts",
  "examples/crm/src/objects.ts",
  "examples/crm/src/workflow-endpoints.test.ts",
  "examples/crm/src/workflows.test.ts",
  "packages/actions/src/approval-rules.ts",
  "packages/actions/src/approvals.ts",
  "packages/actions/src/checks.ts",
  "packages/actions/src/context.ts",
  "packages/actions/src/define-action.test.ts",
  "packages/actions/src/define-action.ts",
  "packages/actions/src/describe.ts",
  "packages/actions/src/generated.ts",
  "packages/actions/src/history.ts",
  "packages/actions/src/identity-queries.ts",
  "packages/actions/src/identity-schemas.ts",
  "packages/actions/src/index.ts",
  "packages/actions/src/log-schemas.ts",
  "packages/actions/src/logs.ts",
  "packages/actions/src/permissions.ts",
  "packages/actions/src/pipeline.ts",
  "packages/actions/src/record-actions.ts",
  "packages/actions/src/registry.ts",
  "packages/actions/src/step.ts",
  "packages/actions/src/test-helpers.ts",
  "packages/actions/src/testing.ts",
  "packages/auth/src/actions.ts",
  "packages/auth/src/dev-outbox.ts",
  "packages/config/src/approvals.ts",
  "packages/config/src/choices.ts",
  "packages/config/src/config-type.ts",
  "packages/config/src/drafts.ts",
  "packages/config/src/git.ts",
  "packages/config/src/index.ts",
  "packages/config/src/loader.ts",
  "packages/config/src/roles.ts",
  "packages/config/src/validate.ts",
  "packages/db/src/approvals.ts",
  "packages/db/src/config-versions.ts",
  "packages/db/src/dispatch.ts",
  "packages/db/src/drafts.ts",
  "packages/db/src/identity.ts",
  "packages/db/src/run-trace.ts",
  "packages/db/src/schema-check.ts",
  "packages/db/src/schema/core.ts",
  "packages/events/src/dispatcher.ts",
  "packages/events/src/index.ts",
  "packages/objects/src/dal/approvals.ts",
  "packages/objects/src/dal/data-access.ts",
  "packages/objects/src/dal/drafts.ts",
  "packages/objects/src/dal/identity.ts",
  "packages/objects/src/dal/logs.ts",
  "packages/objects/src/define-object.ts",
  "packages/objects/src/fields/choice.ts",
  "packages/objects/src/fields/field.ts",
  "packages/objects/src/fields/filters.ts",
  "packages/objects/src/fields/index.ts",
  "packages/objects/src/fields/ref.ts",
  "packages/objects/src/migration.test.ts",
  "packages/objects/src/registry.ts",
  "packages/objects/src/repository.ts",
  "packages/server/src/api.ts",
  "packages/server/src/bin/validate-config.ts",
  "packages/server/src/catalog.ts",
  "packages/server/src/config.ts",
  "packages/server/src/errors.ts",
  "packages/server/src/mcp.ts",
  "packages/server/src/openapi.ts",
  "packages/server/src/server.ts",
  "packages/server/src/system.ts",
  "packages/server/src/testing/contract.ts",
  "packages/server/src/workflow-calls.ts",
  "packages/workflows/src/config-type.ts",
  "packages/workflows/src/cron.ts",
  "packages/workflows/src/define-workflow.ts",
  "packages/workflows/src/entries.ts",
  "packages/workflows/src/fields.ts",
  "packages/workflows/src/index.ts",
  "packages/workflows/src/run.ts",
  "packages/workflows/src/schema.ts",
  "packages/workflows/src/shapes.ts",
  "packages/workflows/src/trace.ts",
  "packages/workflows/src/validate.ts",
  "tools/fx/src/commands/describe.ts",
];

const pkg = (
  name: string,
  directory: string,
  dependencies: readonly string[]
): WorkspacePackage => ({ name, directory, dependencies });

const sources = (dir: string) =>
  sourceFiles(dir).map((file) => ({
    file,
    source: readFileSync(file, "utf-8"),
  }));

const tree = () =>
  ["packages", "apps", "modules", "examples", "tools"].flatMap((dir) =>
    sourceFiles(path.join(root, dir))
  );

describe("dependency direction", () => {
  it("allows a downward dependency and refuses one that points up or at a module", () => {
    const problems = dependencyProblems([
      pkg("@workspace/db", "packages/db", ["@workspace/actions"]),
      pkg("@workspace/auth", "packages/auth", [
        "@workspace/actions",
        "@workspace/db",
        "@workspace/objects",
      ]),
      pkg("@workspace/workflows", "packages/workflows", ["@workspace/events"]),
      pkg("@workspace/objects", "packages/objects", ["@workspace/comms"]),
      pkg("@workspace/comms", "modules/comms", []),
    ]);
    expect(problems).toStrictEqual([
      `@workspace/db depends on @workspace/actions, which is not below it. ${dependencyOrder}`,
      `@workspace/workflows depends on @workspace/events, which is not below it. ${dependencyOrder}`,
      "@workspace/objects depends on @workspace/comms. Packages must not depend on modules.",
    ]);
  });

  it("matches the repo, including auth's dependencies", () => {
    const packages = readWorkspacePackages(root);
    const auth = packages.find((item) => item.name === "@workspace/auth");
    expect(auth?.dependencies.toSorted()).toStrictEqual([
      "@workspace/actions",
      "@workspace/db",
      "@workspace/objects",
      "@workspace/testing",
    ]);
    expect(dependencyProblems(packages)).toStrictEqual([]);
  });
});

describe("web imports", () => {
  it("allows type imports and refuses values, drizzle and pg", () => {
    const source = [
      'import type { ApiError } from "@workspace/server";',
      'import { createDb } from "@workspace/db";',
      'import { eq } from "drizzle-orm";',
      'import type { Client } from "pg";',
      'const loaded = await import("@workspace/objects");',
    ].join("\n");
    expect(
      webImportProblems(source).map((problem) => problem.message)
    ).toStrictEqual([
      "imports @workspace/db as a value. The web app may only import type from it.",
      "imports drizzle-orm. The web app does not talk to the database.",
      "imports pg. The web app does not talk to the database.",
      "imports @workspace/objects. The web app may only import type from the core, and never the database driver.",
    ]);
  });

  it("holds apps/web/src to that rule", () => {
    const problems = sources(path.join(root, "apps", "web", "src")).flatMap(
      ({ file, source }) =>
        webImportProblems(source).map(
          (problem) =>
            `${path.relative(root, file)}:${problem.line} ${problem.message}`
        )
    );
    expect(problems).toStrictEqual([]);
  });
});

describe("casts and comments", () => {
  it("reports a plan id, a TODO and a suppressed error", () => {
    const slash = "/";
    const sample = [
      `${slash}${slash} Shipped in P2.04.`,
      `${slash}${slash} TODO: later`,
      `${slash}${slash} @ts-expect-error no`,
      "const ok = 1;",
    ].join("\n");
    expect(
      commentProblems(sample).map((problem) => problem.message)
    ).toStrictEqual([
      "Plan ids belong in docs/plans, not in source comments.",
      "TODO, HACK and workaround comments are not allowed.",
      "Use a type that checks, not @ts-ignore or @ts-expect-error.",
    ]);
  });

  it("keeps double casts and existing comment bans to their allowlists", () => {
    const files = tree();
    expect(castProblems(root, files, castAllowlist)).toStrictEqual([]);
    expect(commentFileProblems(root, files, commentAllowlist)).toStrictEqual(
      []
    );
  });
});
