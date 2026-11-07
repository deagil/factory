// The dev bar's API menu (P1b.10): what the web app's calls did, and ways
// to make the next ones misbehave. It plugs into `lib/api.ts` through
// `setApiDevHooks`, which only the dev bar calls.
import type { ApiError } from "@workspace/server";

import type { ApiCallRecord, ApiDevHooks } from "../lib/api.ts";

export type ErrorCode = ApiError["code"];

/** Each typed error the API returns, with its status (decision 0027). */
export const ERROR_CODES: {
  code: ErrorCode;
  status: number;
  message: string;
}[] = [
  {
    code: "validation",
    status: 400,
    message: "Forced by the dev bar: the input isn’t valid.",
  },
  {
    code: "unauthenticated",
    status: 401,
    message: "Forced by the dev bar: sign in first.",
  },
  {
    code: "permission",
    status: 403,
    message: "Forced by the dev bar: you can’t do that.",
  },
  {
    code: "not_found",
    status: 404,
    message: "Forced by the dev bar: there is no such record.",
  },
  {
    code: "conflict",
    status: 409,
    message: "Forced by the dev bar: the record changed since you loaded it.",
  },
  {
    code: "approval_required",
    status: 202,
    message: "Forced by the dev bar: this needs approval.",
  },
  {
    code: "internal",
    status: 500,
    message: "Forced by the dev bar: the server failed.",
  },
];

export const LATENCIES = [0, 250, 1000, 3000] as const;

export interface ApiToolsState {
  dryRun: boolean;
  latency: number;
  failNext: ErrorCode | null;
  calls: ApiCallRecord[];
}

const KEEP = 25;

let state: ApiToolsState = {
  dryRun: false,
  latency: 0,
  failNext: null,
  calls: [],
};
const listeners = new Set<() => void>();

const set = (next: Partial<ApiToolsState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
};

export const apiTools = {
  read: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setDryRun: (dryRun: boolean) => set({ dryRun }),
  setLatency: (latency: number) => set({ latency }),
  setFailNext: (failNext: ErrorCode | null) => set({ failNext }),
  clear: () => set({ calls: [] }),
};

/** The forced failure for `code`, shaped like the API's own. */
export const forcedError = (code: ErrorCode) => {
  const known = ERROR_CODES.find((item) => item.code === code);
  return {
    error: { code, message: known?.message ?? code } as ApiError,
    status: known?.status ?? 500,
  };
};

const pause = (ms: number) =>
  // oxlint-disable-next-line promise/avoid-new -- the browser has no promise timer
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** The hooks `lib/api.ts` calls around every request. */
export const apiDevHooks: ApiDevHooks = {
  before: async (path) => {
    if (state.latency > 0) {
      await pause(state.latency);
    }
    if (state.failNext) {
      const failure = forcedError(state.failNext);
      set({ failNext: null });
      return { fail: failure };
    }
    return { dryRun: state.dryRun && path.startsWith("/actions/") };
  },
  after: (call) => set({ calls: [call, ...state.calls].slice(0, KEEP) }),
};
