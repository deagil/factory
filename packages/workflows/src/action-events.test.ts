import type { GitService } from "@workspace/actions";
import { stepActions } from "@workspace/actions";
import { noRemote } from "@workspace/config";
import { organisation } from "@workspace/objects/testing";
import { describe, expect, it } from "vitest";

import { collectEvents, listEvents, listStepActions } from "./action-events.ts";
import { defineWorkflow } from "./define-workflow.ts";
import { workflowEntries } from "./entries.ts";

const objects = [organisation];
const steps = new Map(
  stepActions(objects).map((action) => [action.name, action])
);

const deps = {
  objects,
  definitions: [],
  steps,
  codeWorkflows: new Map(),
};

const git = (files: { path: string; content: string }[]): GitService => ({
  production: "production",
  head: () => Promise.resolve("abc"),
  branch: () => Promise.reject(new Error("unused")),
  commit: () => Promise.reject(new Error("unused")),
  diff: () => Promise.reject(new Error("unused")),
  remove: () => Promise.reject(new Error("unused")),
  files: () => Promise.resolve(files),
  blob: () => Promise.resolve(null),
  show: () => Promise.resolve(null),
  check: () => Promise.reject(new Error("unused")),
  publish: () => Promise.reject(new Error("unused")),
});

const onPing = `key: on_ping
description: Starts when pinged.
starts_when:
  event: pinged
errors:
  missing: It is missing.
events:
  pinged:
    n: { type: number }
steps:
  - id: stop
    fail: missing
`;

describe("action and event lists", () => {
  it("describes record actions with their object, and checks as read-only", () => {
    const actions = listStepActions(steps, objects);
    const update = actions.find(
      (action) => action.name === "organisation_update"
    );
    const check = actions.find(
      (action) => action.name === "record_belongs_to_caller"
    );
    expect(update).toMatchObject({
      kind: "internal",
      object: "organisation",
      input: { type: "object" },
    });
    expect(update?.input.properties).toMatchObject({
      id: expect.any(Object),
    });
    expect(update?.read_only).toBeUndefined();
    expect(check).toMatchObject({ kind: "internal", read_only: true });
    expect(check?.object).toBeUndefined();
  });

  it("attributes a generated event to its object", () => {
    const events = listEvents(objects, [], steps, []);
    expect(
      events.find((event) => event.type === "organisation_created")
    ).toMatchObject({
      from: { kind: "object", name: "organisation" },
      payload: { kind: "schema" },
      workflows: [],
    });
  });

  it("reads a draft's declared event, and refuses a draft without a remote", async () => {
    const draft = await collectEvents(
      {
        config: {},
        git: git([
          { path: "config/workflows/on_ping.yaml", content: onPing },
          { path: "config/roles/admin.yaml", content: "key: admin\n" },
        ]),
        dal: {
          draftDetail: () =>
            Promise.resolve({ branch: "draft/1", publishedSha: null }),
        },
      },
      { draft_id: "00000000-0000-7000-8000-000000000099" },
      deps
    );
    const missing = await collectEvents(
      {
        config: {},
        git: undefined,
        dal: { draftDetail: () => Promise.resolve(null) },
      },
      { draft_id: "00000000-0000-7000-8000-000000000099" },
      deps
    );
    const gone = await collectEvents(
      {
        config: {},
        git: git([]),
        dal: { draftDetail: () => Promise.resolve(null) },
      },
      { draft_id: "00000000-0000-7000-8000-000000000099" },
      deps
    );
    const pinged = draft.ok
      ? draft.events.find((event) => event.type === "pinged")
      : undefined;
    expect(pinged).toMatchObject({
      from: { kind: "workflow", name: "on_ping" },
      payload: { kind: "fields", fields: { n: { type: "number" } } },
      workflows: ["on_ping"],
    });
    expect(missing).toStrictEqual({
      ok: false,
      code: "validation",
      message: noRemote,
    });
    expect(gone).toStrictEqual({
      ok: false,
      code: "not_found",
      id: "00000000-0000-7000-8000-000000000099",
    });
  });

  it("uses the live workflows, including one an event starts", async () => {
    const started = defineWorkflow({
      key: "on_ping",
      description: "Starts when pinged.",
      starts_when: { event: "pinged" },
      errors: { missing: "It is missing." },
      steps: [{ id: "stop", fail: "missing" }],
    });
    const declared = defineWorkflow({
      key: "emit_ping",
      description: "Declares pinged.",
      starts_when: "called",
      events: { pinged: { n: { type: "number" } } },
      errors: { missing: "It is missing." },
      steps: [{ id: "stop", fail: "missing" }],
    });
    const found = await collectEvents(
      {
        config: { workflows: workflowEntries([declared, started]) },
        git: undefined,
        dal: { draftDetail: () => Promise.resolve(null) },
      },
      {},
      deps
    );
    const pinged = found.ok
      ? found.events.find((event) => event.type === "pinged")
      : undefined;
    expect(pinged).toMatchObject({
      from: { kind: "workflow", name: "emit_ping" },
      workflows: ["on_ping"],
    });
  });
});
