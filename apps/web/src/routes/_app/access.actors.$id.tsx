// One actor (P1b.06): who it is, its roles (editable with actor.setRoles),
// its keys, Disable or Enable, and a link to everything it did.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import { useState } from "react";

import {
  KeyList,
  RoleBadges,
  RolePicker,
  StatusText,
  useRoles,
} from "../../components/access.tsx";
import type { ActorEntry, ApiKeyEntry } from "../../components/access.tsx";
import { ErrorText, when } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runAction, runQuery } from "../../lib/api.ts";
import { findAction } from "../../lib/forms.ts";
import type { NavLink } from "../../lib/nav.ts";

type ActorDetail = ActorEntry & { keys: ApiKeyEntry[] };

const listOf: Record<string, { label: string; link: NavLink }> = {
  staff: { label: "Users", link: { to: "/access/users" } },
  agent: { label: "Agents", link: { to: "/access/agents" } },
  integration: { label: "Integrations", link: { to: "/access/integrations" } },
};

const Roles = ({ actor, canSet }: { actor: ActorDetail; canSet: boolean }) => {
  const queryClient = useQueryClient();
  const roles = useRoles();
  const [editing, setEditing] = useState<string[] | null>(null);
  const save = useMutation({
    mutationFn: (keys: string[]) =>
      runAction("actor.setRoles", { id: actor.id, roles: keys }),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({
        queryKey: ["actor.get", actor.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["actor.list"] });
    },
  });
  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <RolePicker
          roles={roles.data ?? []}
          value={editing}
          onChange={setEditing}
        />
        {actor.kind === "agent" && (
          <p className="text-sm text-muted-foreground">
            An agent&rsquo;s roles must be among {actor.user?.name}&rsquo;s.
            With none, it can do everything they can.
          </p>
        )}
        <ErrorText error={save.error} />
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate(editing)}
          >
            Save roles
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <RoleBadges keys={actor.roles} roles={roles.data} />
      {canSet && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing(actor.roles)}
        >
          Change
        </Button>
      )}
    </div>
  );
};

const ActorScreen = () => {
  const { id } = Route.useParams();
  const { session } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const found = useQuery({
    queryKey: ["actor.get", id],
    queryFn: () => runQuery<{ actor: ActorDetail }>("actor.get", { id }),
    retry: false,
  });
  const toggle = useMutation({
    mutationFn: (disable: boolean) =>
      runAction(disable ? "actor.disable" : "actor.enable", { id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["actor.get", id] });
      await queryClient.invalidateQueries({ queryKey: ["actor.list"] });
    },
  });

  if (found.isPending) {
    return (
      <>
        <PageHeader title="Loading…" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (found.isError) {
    return (
      <>
        <PageHeader title="Actor" />
        <ErrorText error={found.error} />
      </>
    );
  }
  const { actor } = found.data;
  const can = (name: string) => Boolean(findAction(described.data, name));
  const own = actor.user?.id === session.user.id;
  const disabled = actor.status !== "active";
  const isYou = actor.kind === "staff" && own;
  const toggleName = disabled ? "actor.enable" : "actor.disable";
  const list = listOf[actor.kind];
  // Only an agent's own person makes its keys; anyone with the permission
  // makes an integration's.
  const keyHolder = actor.kind === "agent" || actor.kind === "integration";
  const canCreateKey =
    keyHolder && can("apiKey.create") && (actor.kind === "integration" || own);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={actor.name}
        trail={list ? [list] : []}
        actions={
          <>
            <Link
              to="/activity/runs"
              search={{ actor: actor.id }}
              className={buttonVariants({ variant: "outline" })}
            >
              Runs
            </Link>
            {can(toggleName) && !isYou && (
              <Button
                variant={disabled ? "outline" : "destructive"}
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(!disabled)}
              >
                {disabled ? "Enable" : "Disable"}
              </Button>
            )}
          </>
        }
      />
      <ErrorText error={toggle.error} />
      <dl className="grid max-w-lg grid-cols-[8rem_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Kind</dt>
        <dd className="capitalize">{actor.kind}</dd>
        {actor.user && (
          <>
            <dt className="text-muted-foreground">
              {actor.kind === "agent" ? "Acts for" : "Email"}
            </dt>
            <dd>
              {actor.kind === "agent"
                ? `${actor.user.name} (${actor.user.email})`
                : actor.user.email}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusText status={actor.status} />
        </dd>
        <dt className="text-muted-foreground">Since</dt>
        <dd>{when(actor.at)}</dd>
      </dl>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Roles</h2>
        <Roles actor={actor} canSet={can("actor.setRoles") && !isYou} />
      </section>
      {keyHolder && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">API keys</h2>
          <KeyList
            actorId={actor.id}
            keys={actor.keys}
            canCreate={canCreateKey}
            canRevoke={can("apiKey.revoke")}
          />
        </section>
      )}
    </div>
  );
};

export const Route = createFileRoute("/_app/access/actors/$id")({
  staticData: { section: "access" },
  component: ActorScreen,
});
