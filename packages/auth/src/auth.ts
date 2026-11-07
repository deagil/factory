// Sign-in with Better Auth: a one-time code by email (printed to the console
// locally), sessions, and resolving a session to the user's staff actor for
// the pipeline's identify stage. SSO comes in phase 3. See
// docs/SYSTEM_DESIGN.md section 4.3 and decision 0023.

import type { Caller } from "@workspace/actions";
import {
  accounts,
  actorForApiKey,
  apiKeyPrefix,
  isActiveUser,
  sessions,
  staffActorFor,
  users,
  verifications,
} from "@workspace/db";
import type { Db } from "@workspace/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";

/** Sends a sign-in code to `email`. */
export type SendCode = (email: string, code: string) => Promise<void>;

/** Local delivery: the code goes to the server console. */
export const printCode: SendCode = (email, code) => {
  console.info(`Sign-in code for ${email}: ${code}`);
  return Promise.resolve();
};

export interface AuthOptions {
  db: Db;
  /** BETTER_AUTH_SECRET: signs sessions. At least 32 characters. */
  secret: string;
  /** BETTER_AUTH_URL: where the API serves `/auth`. */
  baseURL: string;
  /** Delivers codes. Defaults to the console. */
  sendCode?: SendCode;
  /** Web origins allowed to call `/auth`, such as the web app's. */
  trustedOrigins?: string[];
}

export const createAuth = ({
  db,
  secret,
  baseURL,
  sendCode = printCode,
  trustedOrigins,
}: AuthOptions) => {
  const auth = betterAuth({
    appName: "Factory",
    secret,
    baseURL,
    basePath: "/auth",
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    // Ids come from the tables' uuidv7() defaults.
    advanced: { database: { generateId: false } },
    telemetry: { enabled: false },
    plugins: [
      // Staff are added, not self-registered: unknown emails can't sign up.
      emailOTP({
        disableSignUp: true,
        sendVerificationOTP: ({ email, otp }) => sendCode(email, otp),
      }),
      // Lets API clients send the session as `Authorization: Bearer`.
      bearer(),
    ],
    databaseHooks: {
      session: {
        create: {
          // Disabled users can't sign in.
          before: (session) => isActiveUser(db, session.userId as string),
          // Signing in finds or creates the user's staff actor. That isn't an
          // action: there is no actor yet to run one as (decision 0023).
          after: async (session) => {
            await staffActorFor(db, session.userId as string);
          },
        },
      },
    },
  });

  /**
   * The caller a request is from. An `Authorization: Bearer fx_…` API key
   * gives its agent or integration actor (an agent's user is the origin); a
   * session gives the user's staff actor. Null if neither is valid.
   */
  const callerFrom = async (headers: Headers): Promise<Caller | null> => {
    const token = headers
      .get("authorization")
      ?.match(/^Bearer\s+(?<token>\S+)$/iu)?.groups?.token;
    if (token?.startsWith(apiKeyPrefix)) {
      const found = await actorForApiKey(db, token, new Date());
      return found
        ? { actorId: found.actorId, originUserId: found.userId }
        : null;
    }
    const session = await auth.api.getSession({ headers });
    if (!session) {
      return null;
    }
    const actor = await staffActorFor(db, session.user.id);
    // A disabled staff actor can't act, even with a session.
    if (actor.status !== "active") {
      return null;
    }
    return { actorId: actor.id, originUserId: session.user.id };
  };

  return { auth, callerFrom };
};

export type Auth = ReturnType<typeof createAuth>;
