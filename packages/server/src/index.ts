// The Hono service: the HTTP API with OpenAPI and the MCP server, generated
// from the action registry. See docs/SYSTEM_DESIGN.md section 4.9 and
// decisions 0026 and 0027.
export { createApi } from "./api.ts";
export type { Api, ApiOptions } from "./api.ts";
export { errorBodySchema, statusFor } from "./errors.ts";
export type { ApiError, ErrorBody, HttpError } from "./errors.ts";
export { openApiDocument } from "./openapi.ts";
