import { describe, expect, it } from "vitest";

import { payloadLines } from "./payload-lines.ts";

describe(payloadLines, () => {
  it("names the changed fields and only the record's keys", () => {
    expect(
      payloadLines({
        after: { active: true, lastName: "Turing", firstName: "Alan" },
        before: { active: false, lastName: "Turing Esq." },
        record: {
          id: "01",
          email: "alan@globex.example",
          active: true,
          version: 4,
          fullName: "Alan Turing",
        },
      })
    ).toStrictEqual([
      "after: active true, lastName Turing, firstName Alan",
      "before: active false, lastName Turing Esq.",
      "record: id, email, active, version, …",
    ]);
  });

  it("stops after four top-level fields", () => {
    expect(payloadLines({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toStrictEqual([
      "a: 1",
      "b: 2",
      "c: 3",
      "d: 4",
      "…",
    ]);
  });

  it("reads a value that is not an object", () => {
    expect(payloadLines("created")).toStrictEqual(["created"]);
    expect(payloadLines(null)).toStrictEqual(["null"]);
  });
});
