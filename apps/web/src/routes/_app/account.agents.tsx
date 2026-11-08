// Account menu → My agents (P1b.06): your agents and their keys, and
// Connect an agent, which makes one with a key and shows the command that
// adds this system to Claude Code over MCP.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

import { KeyReveal, StatusText, useActors } from "../../components/access.tsx";
import { ErrorText, when } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runAction } from "../../lib/api.ts";
import { mcpCommand } from "../../lib/mcp.ts";

const Connect = ({ onDone }: { onDone: () => void }) => {
  const [name, setName] = useState("Claude Code");
  const [connected, setConnected] = useState<{
    name: string;
    key: string;
  } | null>(null);
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: async () => {
      const agent = await runAction<{ actorId: string }>("actor.createAgent", {
        name,
      });
      const key = await runAction<{ key: string }>("apiKey.create", {
        actorId: agent.output.actorId,
        label: name,
      });
      return { name, key: key.output.key };
    },
    onSuccess: async (result) => {
      setConnected(result);
      // The list below shows the new agent while its key is on screen.
      await queryClient.invalidateQueries({ queryKey: ["actor.list"] });
    },
  });
  if (connected) {
    const command = mcpCommand(
      connected.name,
      window.location.origin,
      connected.key
    );
    return (
      <KeyReveal apiKey={connected.key} onDismiss={onDone}>
        <p>Add it to Claude Code with:</p>
        <code className="rounded-xl bg-background px-3 py-2 font-mono text-xs break-all">
          {command}
        </code>
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => navigator.clipboard?.writeText(command)}
        >
          Copy command
        </Button>
      </KeyReveal>
    );
  }
  return (
    <form
      className="flex max-w-lg flex-col gap-3 rounded-2xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        connect.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">
        An agent acts for you over MCP and can never do more than you can. This
        makes one with a key, and shows the command to add it.
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Name</span>
        <Input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <ErrorText error={connect.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={connect.isPending}>
          Connect
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

const MyAgentsScreen = () => {
  const { session } = Route.useRouteContext();
  const agents = useActors("agent");
  const [connecting, setConnecting] = useState(false);
  // An admin's list has everyone's agents; this page is only yours.
  const mine = (agents.data ?? []).filter(
    (agent) => agent.user?.id === session.user.id
  );
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My agents"
        actions={
          connecting ? null : (
            <Button onClick={() => setConnecting(true)}>
              Connect an agent
            </Button>
          )
        }
      />
      {connecting && <Connect onDone={() => setConnecting(false)} />}
      <ErrorText error={agents.error} />
      <ul className="flex flex-col gap-2">
        {mine.map((agent) => (
          <li
            key={agent.id}
            className="flex items-center justify-between rounded-2xl border px-4 py-3 text-sm"
          >
            <Link
              to="/access/actors/$id"
              params={{ id: agent.id }}
              className="font-medium hover:underline"
            >
              {agent.name}
            </Link>
            <span className="flex items-center gap-3 text-muted-foreground">
              since {when(agent.at)} · <StatusText status={agent.status} />
            </span>
          </li>
        ))}
        {agents.data && mine.length === 0 && (
          <li className="text-sm text-muted-foreground">
            You have no agents yet.
          </li>
        )}
      </ul>
    </div>
  );
};

export const Route = createFileRoute("/_app/account/agents")({
  component: MyAgentsScreen,
});
