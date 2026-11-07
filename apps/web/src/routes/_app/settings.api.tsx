// Settings → API & MCP (P1b.08): how to reach this system from code or an
// AI agent. Every route and tool is generated from the same registry.
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PageHeader } from "../../components/page-header.tsx";

const Code = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-2xl bg-muted/50 p-3 font-mono text-xs/relaxed">
    {children}
  </pre>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-2 text-sm">
    <h2 className="font-medium">{title}</h2>
    {children}
  </section>
);

const ApiScreen = () => {
  const { origin } = window.location;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="API & MCP" />
      <Section title="HTTP API">
        <p>
          Every action is <code>POST {origin}/api/actions/&lt;name&gt;</code>{" "}
          and every query <code>POST {origin}/api/queries/&lt;name&gt;</code>,
          with the input as JSON. The{" "}
          <a
            href="/api/openapi.json"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI document
          </a>{" "}
          describes them all;{" "}
          <Link to="/settings/reference" className="underline">
            Reference
          </Link>{" "}
          lists the ones you can use.
        </p>
        <Code>{`curl ${origin}/api/actions/organisation.create \\
  -H "Authorization: Bearer fx_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 7d1c…" \\
  -d '{"name": "Acme Ltd"}'`}</Code>
        <ul className="list-disc pl-5">
          <li>
            <code>Idempotency-Key</code> makes a retry return the first result
            instead of running again.
          </li>
          <li>
            <code>?dryRun=true</code> runs an action and rolls it back,
            returning what it would have changed.
          </li>
          <li>
            Errors are <code>{"{ error: { code, message }, actionId }"}</code>,
            where <code>code</code> is validation, permission,
            approval_required, conflict, not_found or internal.
          </li>
        </ul>
      </Section>
      <Section title="MCP">
        <p>
          The MCP endpoint is <code>{origin}/mcp</code> (streamable HTTP). Each
          action and query is a tool, named with <code>_</code> for{" "}
          <code>.</code>, and an agent sees only the ones it may use.
        </p>
      </Section>
      <Section title="Authenticating">
        <p>
          In the browser you&rsquo;re signed in. Code and agents send an API key
          as <code>Authorization: Bearer fx_…</code>. An agent&rsquo;s key acts
          for you and can never do more than you can: make one in{" "}
          <Link to="/account/agents" className="underline">
            My agents
          </Link>
          , which also gives the command to add it to Claude Code. Keys for
          other systems belong to an integration, in Access → Integrations.
        </p>
      </Section>
    </div>
  );
};

export const Route = createFileRoute("/_app/settings/api")({
  staticData: { section: "settings" },
  component: ApiScreen,
});
