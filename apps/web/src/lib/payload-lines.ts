// A short reading of a payload for a list. The event page keeps the full JSON.

const shownKeys = 4;
const shownLines = 4;
const shownText = 48;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => {
  if (typeof value === "string") {
    return value.length > shownText ? `${value.slice(0, shownText)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return String(value.length);
  }
  return "—";
};

const line = (key: string, value: unknown) => {
  if (Array.isArray(value)) {
    return `${key}: ${value.length}`;
  }
  if (!record(value)) {
    return `${key}: ${text(value)}`;
  }
  const entries = Object.entries(value);
  const head = entries.slice(0, shownKeys);
  if (entries.length > shownKeys) {
    return `${key}: ${head.map(([name]) => name).join(", ")}, …`;
  }
  const parts = head.map(([name, item]) =>
    record(item) || Array.isArray(item) ? name : `${name} ${text(item)}`
  );
  return `${key}: ${parts.join(", ") || "—"}`;
};

/** Up to four lines. Nested objects name their fields instead of expanding. */
export const payloadLines = (value: unknown): string[] => {
  if (!record(value)) {
    return [text(value)];
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return ["—"];
  }
  const lines = entries
    .slice(0, shownLines)
    .map(([key, item]) => line(key, item));
  return entries.length > shownLines ? [...lines, "…"] : lines;
};
