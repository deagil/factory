// When a schedule is due (P2.19): five cron fields (minute, hour, day of the
// month, month, day of the week), each `*`, a number, a range `a-b`, a step
// `*/n` or `a-b/n`, or a comma list of those. Times are UTC. As in cron, when
// both day fields are restricted a day matching either is due.

const limits = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
] as const;

/** The values one field allows, or null when it allows any. */
const valuesOf = (field: string, [low, high]: readonly [number, number]) => {
  if (field === "*") {
    return null;
  }
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range = "", stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    const [from, to] =
      range === "*"
        ? [low, high]
        : (() => {
            const [start = "", end] = range.split("-");
            return [
              Number(start),
              end === undefined ? Number(start) : Number(end),
            ];
          })();
    if (![from, to, step].every(Number.isInteger) || step < 1) {
      throw new Error(`"${field}" isn't a cron field.`);
    }
    for (let value = from; value <= to; value += step) {
      values.add(value);
    }
  }
  return values;
};

const inSet = (set: Set<number> | null | undefined, value: number) =>
  !set || set.has(value);

/** Whether the schedule `expression` is due in the minute `date` falls in. */
export const cronMatches = (expression: string, date: Date) => {
  const fields = expression.trim().split(/\s+/u);
  const [minutes, hours, days, months, weekdays] = fields.map((field, index) =>
    valuesOf(field, limits[index] ?? [0, 0])
  );
  const weekday = date.getUTCDay();
  const dayOfMonth = inSet(days, date.getUTCDate());
  const dayOfWeek =
    inSet(weekdays, weekday) || (weekday === 0 && inSet(weekdays, 7));
  const day =
    days && weekdays ? dayOfMonth || dayOfWeek : dayOfMonth && dayOfWeek;
  return (
    inSet(minutes, date.getUTCMinutes()) &&
    inSet(hours, date.getUTCHours()) &&
    inSet(months, date.getUTCMonth() + 1) &&
    day
  );
};
