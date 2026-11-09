// Local development only: keeps the last sign-in codes the server
// printed, so the web app's dev bar can sign in as anyone without reading
// the console. `createServer` uses it only when asked (`devOutbox: true`),
// and only then serves it, at `/dev/session`.
import { printCode } from "./auth.ts";
import type { SendCode } from "./auth.ts";

export interface OutboxEntry {
  email: string;
  code: string;
  at: string;
}

export const createDevOutbox = (keep = 20) => {
  const entries: OutboxEntry[] = [];
  const send: SendCode = async (email, code) => {
    entries.unshift({ email, code, at: new Date().toISOString() });
    entries.splice(keep);
    await printCode(email, code);
  };
  return { send, list: (): OutboxEntry[] => [...entries] };
};

export type DevOutbox = ReturnType<typeof createDevOutbox>;
