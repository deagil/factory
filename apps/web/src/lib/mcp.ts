// The command that adds this system to Claude Code over MCP. The
// web app's origin proxies /mcp to the API server, like /api.

/** `claude mcp add` for an agent named `name`, with its key in a header. */
export const mcpCommand = (name: string, origin: string, key: string) => {
  const slug =
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-|-$/gu, "") || "factory";
  return `claude mcp add --transport http ${slug} ${origin}/mcp --header "Authorization: Bearer ${key}"`;
};
