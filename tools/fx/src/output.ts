import { FxError } from "./errors.ts";

export interface Output {
  /** Writes human-readable text (ignored in --json mode). */
  readonly text: (line: string) => void;
}

/** Writes a command's result: JSON on stdout for agents, or text for people. */
export const writeResult = (
  json: boolean,
  data: unknown,
  text: string
): void => {
  process.stdout.write(
    json
      ? `${JSON.stringify({ ok: true, ...(data as object) }, null, 2)}\n`
      : text
  );
};

/** Writes an error, as JSON on stdout in --json mode so agents can parse it. */
export const writeError = (json: boolean, error: unknown): void => {
  const fxError =
    error instanceof FxError
      ? error
      : new FxError(
          "command_failed",
          error instanceof Error ? error.message : String(error)
        );
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: fxError.code, message: fxError.message, hint: fxError.hint ?? null } }, null, 2)}\n`
    );
    return;
  }
  process.stderr.write(
    `fx: ${fxError.message}\n${fxError.hint ? `${fxError.hint}\n` : ""}`
  );
};
