// The HTTP API's error shape: every failure is
// `{ error: { code, message, ...details }, actionId, requestId }`, with a
// status code chosen by `code`. See decision 0027.
import type { RunError } from "@workspace/actions";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

/** Errors the HTTP layer adds before the pipeline runs. */
export type HttpError =
  | { code: "unauthenticated"; message: string }
  | { code: "not_found"; message: string };

export type ApiError = RunError | HttpError;

const statuses: Record<ApiError["code"], ContentfulStatusCode> = {
  validation: 400,
  unauthenticated: 401,
  permission: 403,
  not_found: 404,
  conflict: 409,
  approval_required: 202,
  internal: 500,
};

export const statusFor = (error: ApiError) => statuses[error.code];

export const errorCodes = Object.keys(statuses) as ApiError["code"][];

/** The documented error body, for the OpenAPI document. */
export const errorBodySchema = z.object({
  error: z.looseObject({
    code: z.enum(errorCodes),
    message: z.string(),
  }),
  actionId: z.string().nullable(),
  requestId: z.string(),
});

export interface ErrorBody {
  error: ApiError;
  actionId: string | null;
  requestId: string;
}
