// The HTTP API's error shape: every failure is
// `{ error: { code, message, ...details }, runId, requestId }`, with a
// status code chosen by `code`. See decision 0027.
import type { DeclaredError, RunError } from "@workspace/actions";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/** Errors the HTTP layer adds before the pipeline runs. */
export type HttpError =
  | { code: "unauthenticated"; message: string }
  | { code: "not_found"; message: string };

/** A workflow's own error codes (P2.18) answer 422 and carry `declared`. */
export type ApiError = RunError | HttpError | DeclaredError;

type BuiltIn = RunError | HttpError;

const statuses: Record<BuiltIn["code"], ContentfulStatusCode> = {
  validation: 400,
  unauthenticated: 401,
  permission: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  approval_required: 202,
  internal: 500,
};

export const statusFor = (error: ApiError): ContentfulStatusCode =>
  "declared" in error ? 422 : statuses[(error as BuiltIn).code];

/** The built-in codes; a workflow adds its own. */
export const errorCodes = Object.keys(statuses) as BuiltIn["code"][];

/** The documented error body, for the OpenAPI document. */
export const errorBodySchema = z.object({
  error: z.looseObject({
    code: z
      .string()
      .describe(
        `One of ${errorCodes.join(", ")}, or a workflow's declared code, which comes with \`declared: true\` and a 422.`
      ),
    message: z.string(),
  }),
  runId: z.string().nullable(),
  requestId: z.string(),
});

export interface ErrorBody {
  error: ApiError;
  runId: string | null;
  requestId: string;
}
