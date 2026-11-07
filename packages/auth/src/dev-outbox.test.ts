import { describe, expect, it } from "vitest";

import { createDevOutbox } from "./dev-outbox.ts";

describe(createDevOutbox, () => {
  it("keeps the newest codes first, up to its limit", async () => {
    const outbox = createDevOutbox(2);
    await outbox.send("a@example.com", "111111");
    await outbox.send("b@example.com", "222222");
    await outbox.send("c@example.com", "333333");
    expect(outbox.list().map((entry) => entry.code)).toStrictEqual([
      "333333",
      "222222",
    ]);
  });
});
