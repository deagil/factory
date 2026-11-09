// The dev bar's Session menu: sign in as anyone who can, through
// the normal code flow, reading the code from the server's dev outbox at
// /dev/session. The server serves it only under `pnpm dev`.
import { sendCode, signIn } from "../lib/auth.ts";

export interface DevSession {
  users: { name: string; email: string }[];
  outbox: { email: string; code: string; at: string }[];
}

export const readDevSession = async (): Promise<DevSession> => {
  const response = await fetch("/dev/session", { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("The server has no dev outbox. Start it with pnpm dev.");
  }
  return (await response.json()) as DevSession;
};

/** The newest code for `email` sent at or after `since`. */
export const codeFor = (
  session: DevSession,
  email: string,
  since: Date
): string | undefined =>
  session.outbox.find(
    (entry) =>
      entry.email.toLowerCase() === email.toLowerCase() &&
      new Date(entry.at).getTime() >= since.getTime() - 1000
  )?.code;

/** Asks for a code, reads it from the outbox, and signs in with it. */
export const signInAs = async (email: string) => {
  const since = new Date();
  await sendCode(email);
  const code = codeFor(await readDevSession(), email, since);
  if (!code) {
    throw new Error(`No code arrived for ${email}.`);
  }
  await signIn(email, code);
};
