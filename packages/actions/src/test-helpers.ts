// Stand-in services for tests that run handlers without a database. The
// pipeline's tests (P1.07) use real ones, bound to a transaction.

import type { DraftStore, IdentityStore } from "@workspace/db";
import type { DataAccess, Repository } from "@workspace/objects";

import type { ActionServices } from "./context.ts";
import type { ApprovalService } from "./define-action.ts";
import type { Granted } from "./permissions.ts";

const unused = (name: string) =>
  new Proxy(
    {},
    {
      get: (_target, property) => {
        throw new Error(
          `This test's ${name} isn't connected; it was asked for ${String(property)}`
        );
      },
    }
  );

/** Services with a fixed clock and actor, and no database behind them. */
export const services = (
  overrides: Partial<ActionServices> = {}
): ActionServices => ({
  repo: unused("repo") as Repository,
  dal: unused("dal") as DataAccess,
  granted: unused("granted") as Granted,
  identity: unused("identity") as IdentityStore,
  drafts: unused("drafts") as DraftStore,
  approvals: unused("approvals") as ApprovalService,
  dryRun: false,
  config: { sha: null, roles: [] },
  git: undefined,
  clock: { now: () => new Date("2026-11-07T09:00:00Z") },
  actor: {
    id: "00000000-0000-7000-8000-000000000001",
    kind: "staff",
    name: "Sarah",
    userId: "00000000-0000-7000-8000-000000000002",
  },
  originUserId: "00000000-0000-7000-8000-000000000002",
  ...overrides,
});
