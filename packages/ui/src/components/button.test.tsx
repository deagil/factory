import { describe, expect, it } from "vitest";

import { buttonVariants } from "./button.tsx";

describe(buttonVariants, () => {
  it("applies the default variant and size", () => {
    expect(buttonVariants()).toContain("bg-primary");
  });

  it("applies the requested variant", () => {
    const classes = buttonVariants({ variant: "destructive" });
    expect(classes).toContain("text-destructive");
    expect(classes).not.toContain("bg-primary ");
  });
});
