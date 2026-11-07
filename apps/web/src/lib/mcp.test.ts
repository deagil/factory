import { describe, expect, it } from "vitest";

import { mcpCommand } from "./mcp.ts";

describe(mcpCommand, () => {
  it("names the server after the agent and sends the key as a bearer", () => {
    expect(mcpCommand("Claude Code!", "http://localhost:3000", "fx_abc")).toBe(
      'claude mcp add --transport http claude-code http://localhost:3000/mcp --header "Authorization: Bearer fx_abc"'
    );
    expect(mcpCommand("!!", "https://crm.example", "fx_x")).toContain(
      " factory https://crm.example/mcp "
    );
  });
});
