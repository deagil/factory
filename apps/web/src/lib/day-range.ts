// A calendar day as the log queries' inclusive `since` and `until`.

const parts = (day: string): [number, number, number] | undefined => {
  const match = /^(?<year>\d{4})-(?<month>\d{2})-(?<date>\d{2})$/u.exec(day);
  if (!match) {
    return;
  }
  const year = Number(match.groups?.year);
  const month = Number(match.groups?.month);
  const date = Number(match.groups?.date);
  const parsed = new Date(year, month - 1, date);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) {
    return;
  }
  return [year, month, date];
};

/** A `YYYY-MM-DD` day, or nothing. */
export const day = (value: unknown) =>
  typeof value === "string" && parts(value) ? value : undefined;

/** Local midnight at the start of a `YYYY-MM-DD` day, as an ISO timestamp. */
export const dayStart = (value: string | undefined) => {
  const found = value ? parts(value) : undefined;
  if (!found) {
    return;
  }
  const [year, month, date] = found;
  return new Date(year, month - 1, date).toISOString();
};

/** The last millisecond of a `YYYY-MM-DD` day, locally, as an ISO timestamp. */
export const dayEnd = (value: string | undefined) => {
  const found = value ? parts(value) : undefined;
  if (!found) {
    return;
  }
  const [year, month, date] = found;
  return new Date(year, month - 1, date, 23, 59, 59, 999).toISOString();
};
