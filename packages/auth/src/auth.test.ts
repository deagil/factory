import { createPipeline, defineAction } from "@workspace/actions";
import { closeDb, createDb, users } from "@workspace/db";
import type { Db } from "@workspace/db";
import { createTestDatabase } from "@workspace/testing";
import type { TestDatabase } from "@workspace/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createAuth } from "./auth.ts";
import type { Auth } from "./auth.ts";

const touch = defineAction({
  name: "test.touch",
  description: "Does nothing, as whoever calls it",
  input: z.object({}),
  output: z.object({}),
  handler: () => ({}),
});

describe("sign-in", () => {
  let database: TestDatabase;
  let db: Db;
  let auth: Auth;
  const codes = new Map<string, string>();

  /** Signs in with an emailed code; returns bearer headers, or the error. */
  const signIn = async (email: string) => {
    await auth.auth.api.sendVerificationOTP({
      body: { email, type: "sign-in" },
    });
    const code = codes.get(email);
    if (!code) {
      return { error: "no code was sent" };
    }
    try {
      const { headers } = await auth.auth.api.signInEmailOTP({
        body: { email, otp: code },
        returnHeaders: true,
      });
      const token = headers.get("set-auth-token");
      return { headers: new Headers({ authorization: `Bearer ${token}` }) };
    } catch (error) {
      return { error: String(error) };
    }
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    db = createDb(database.url);
    auth = createAuth({
      db,
      secret: "a-test-secret-that-is-at-least-32-characters",
      baseURL: "http://localhost:3000",
      sendCode: (email, code) => {
        codes.set(email, code);
        return Promise.resolve();
      },
    });
    await db.insert(users).values([
      { name: "Sarah", email: "sarah@example.com" },
      { name: "Gone", email: "gone@example.com", status: "disabled" },
    ]);
  });

  afterAll(async () => {
    await closeDb(db);
    await database?.drop();
  });

  it("signs in with a code, and actions run as the user's staff actor", async () => {
    const signedIn = await signIn("sarah@example.com");
    const caller = await auth.callerFrom(signedIn.headers ?? new Headers());
    const pipeline = createPipeline({
      db,
      config: { sha: null },
      clock: { now: () => new Date() },
    });
    const result = await pipeline.run(touch, {}, caller ?? { actorId: "" });
    const log = await db.query.actionLog.findFirst({
      where: (t, { eq }) => eq(t.id, result.actionId ?? ""),
    });
    const actor = await db.query.actors.findFirst({
      where: (t, { eq }) => eq(t.id, caller?.actorId ?? ""),
    });
    const user = await db.query.users.findFirst({
      where: (t, { eq }) => eq(t.email, "sarah@example.com"),
    });
    expect(result.ok).toBeTruthy();
    expect(actor).toMatchObject({
      kind: "staff",
      name: "Sarah",
      userId: user?.id,
    });
    expect(log).toMatchObject({ actorId: actor?.id, originUserId: user?.id });
  });

  it("finds the same staff actor on every sign-in", async () => {
    const first = await signIn("sarah@example.com");
    const second = await signIn("sarah@example.com");
    const a = await auth.callerFrom(first.headers ?? new Headers());
    const b = await auth.callerFrom(second.headers ?? new Headers());
    expect(a?.actorId).toBeTruthy();
    expect(a?.actorId).toBe(b?.actorId);
  });

  it("doesn't sign up unknown emails, or sign in disabled users", async () => {
    const stranger = await signIn("stranger@example.com");
    const gone = await signIn("gone@example.com");
    expect(stranger.headers).toBeUndefined();
    expect(gone.headers).toBeUndefined();
  });

  it("has no caller without a valid session", async () => {
    await expect(
      auth.callerFrom(new Headers({ authorization: "Bearer nonsense" }))
    ).resolves.toBeNull();
  });
});
