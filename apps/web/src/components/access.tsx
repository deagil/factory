// Pieces the Access screens share (P1b.06): actor lists, role pickers, a
// form built from an action's input schema, and a key shown once.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

import { runAction, runQuery } from "../lib/api.ts";
import type { SystemDescription } from "../lib/api.ts";
import { findAction, humanise } from "../lib/forms.ts";
import type { Role } from "../lib/roles.ts";
import { ErrorText, when } from "./activity.tsx";
import { PageHeader } from "./page-header.tsx";

export interface ActorEntry {
  id: string;
  kind: "staff" | "agent" | "integration" | "automation";
  name: string;
  status: "active" | "disabled";
  at: string;
  user: { id: string; name: string; email: string; status: string } | null;
  roles: string[];
}

export interface ApiKeyEntry {
  id: string;
  label: string;
  at: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The system's roles, when the caller can read them. */
export const useRoles = (enabled = true) =>
  useQuery({
    queryKey: ["role.list"],
    queryFn: () => runQuery<{ roles: Role[] }>("role.list"),
    enabled,
    select: (data) => data.roles,
  });

export const RoleBadges = ({
  keys,
  roles,
}: {
  keys: string[];
  roles: Role[] | undefined;
}) =>
  keys.length === 0 ? (
    <span className="text-muted-foreground">none</span>
  ) : (
    <span className="flex flex-wrap gap-1">
      {keys.map((key) => (
        <span key={key} className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {roles?.find((role) => role.key === key)?.label ?? key}
        </span>
      ))}
    </span>
  );

export const StatusText = ({ status }: { status: string }) =>
  status === "active" ? (
    <span className="text-muted-foreground">active</span>
  ) : (
    <span className="text-destructive">{status}</span>
  );

/** Checkboxes for a set of role keys. */
export const RolePicker = ({
  roles,
  value,
  onChange,
}: {
  roles: Role[];
  value: string[];
  onChange: (value: string[]) => void;
}) => (
  <div className="flex flex-wrap gap-x-4 gap-y-2">
    {roles.map((role) => (
      <label key={role.key} className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.includes(role.key)}
          onChange={(event) =>
            onChange(
              event.target.checked
                ? [...value, role.key]
                : value.filter((key) => key !== role.key)
            )
          }
        />
        {role.label}
      </label>
    ))}
  </div>
);

interface JsonProperty {
  type?: string;
  format?: string;
  items?: { type?: string };
}

/**
 * A form for an action, built from its input schema in system.describe:
 * text for strings (email for emails), and a role picker for `roles`.
 */
export const ActionForm = ({
  action,
  description,
  submitLabel,
  onDone,
  onCancel,
}: {
  action: string;
  description: SystemDescription | undefined;
  submitLabel: string;
  onDone: (output: Record<string, unknown>) => void;
  onCancel: () => void;
}) => {
  const definition = findAction(description, action);
  const schema = definition?.input as {
    properties?: Record<string, JsonProperty>;
    required?: string[];
  };
  const properties = Object.entries(schema?.properties ?? {});
  const roles = useRoles(properties.some(([key]) => key === "roles"));
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const run = useMutation({
    mutationFn: () => runAction(action, values),
    onSuccess: (result) => onDone(result.output),
  });
  if (!definition) {
    return null;
  }
  return (
    <form
      className="flex max-w-lg flex-col gap-4 rounded-2xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        run.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">{definition.description}</p>
      {properties.map(([key, property]) => {
        const required = schema.required?.includes(key) ?? false;
        if (property.type === "array" && key === "roles") {
          return (
            <fieldset key={key} className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Roles</legend>
              <RolePicker
                roles={roles.data ?? []}
                value={(values.roles as string[] | undefined) ?? []}
                onChange={(roleKeys) =>
                  setValues((previous) => ({ ...previous, roles: roleKeys }))
                }
              />
            </fieldset>
          );
        }
        if (property.type !== "string") {
          return null;
        }
        return (
          <label key={key} className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              {humanise(key)}
              {required ? " *" : ""}
            </span>
            <Input
              type={property.format === "email" ? "email" : "text"}
              required={required}
              value={(values[key] as string | undefined) ?? ""}
              onChange={(event) =>
                setValues((previous) => ({
                  ...previous,
                  [key]: event.target.value,
                }))
              }
            />
          </label>
        );
      })}
      <ErrorText error={run.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={run.isPending}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

/** A new API key: shown this once, to copy. */
export const KeyReveal = ({
  apiKey,
  children,
  onDismiss,
}: {
  apiKey: string;
  children?: React.ReactNode;
  onDismiss: () => void;
}) => (
  <div className="flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
    <p className="font-medium">
      Copy this key now. It won&rsquo;t be shown again.
    </p>
    <code className="rounded-xl bg-background px-3 py-2 font-mono text-xs break-all">
      {apiKey}
    </code>
    {children}
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => navigator.clipboard?.writeText(apiKey)}
      >
        Copy key
      </Button>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Done
      </Button>
    </div>
  </div>
);

/** An actor's keys, with New key and Revoke where the caller may. */
export const KeyList = ({
  actorId,
  keys,
  canCreate,
  canRevoke,
}: {
  actorId: string;
  keys: ApiKeyEntry[];
  canCreate: boolean;
  canRevoke: boolean;
}) => {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["actor.get", actorId] });
  const create = useMutation({
    mutationFn: () =>
      runAction<{ key: string }>("apiKey.create", { actorId, label }),
    onSuccess: async (result) => {
      setCreated(result.output.key);
      setLabel("");
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => runAction("apiKey.revoke", { id }),
    onSuccess: refresh,
  });
  return (
    <div className="flex flex-col gap-3">
      {created ? (
        <KeyReveal apiKey={created} onDismiss={() => setCreated(null)} />
      ) : null}
      {keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No keys yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">Made</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b last:border-0">
                  <td className="px-3 py-2">{key.label}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {when(key.at)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {key.lastUsedAt ? when(key.lastUsedAt) : "never"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {key.revokedAt ? (
                      <span className="text-muted-foreground">revoked</span>
                    ) : null}
                    {!key.revokedAt && canRevoke ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(key.id)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canCreate ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Input
            className="h-8 w-56"
            placeholder="Label, such as laptop"
            required
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <Button size="sm" type="submit" disabled={create.isPending}>
            New key
          </Button>
        </form>
      ) : null}
      <ErrorText error={create.error ?? revoke.error} />
    </div>
  );
};

/** A table of actors, each linking to its screen. */
export const ActorTable = ({
  actors,
  roles,
  showPerson,
}: {
  actors: ActorEntry[];
  roles: Role[] | undefined;
  showPerson: "email" | "owner" | false;
}) => (
  <div className="overflow-x-auto rounded-2xl border">
    <table className="w-full text-left text-sm">
      <thead className="border-b bg-muted/50">
        <tr>
          <th className="px-3 py-2 font-medium">Name</th>
          {showPerson === "email" && (
            <th className="px-3 py-2 font-medium">Email</th>
          )}
          {showPerson === "owner" && (
            <th className="px-3 py-2 font-medium">For</th>
          )}
          <th className="px-3 py-2 font-medium">Roles</th>
          <th className="px-3 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {actors.map((actor) => (
          <tr
            key={actor.id}
            className="border-b last:border-0 hover:bg-muted/30"
          >
            <td className="px-3 py-2">
              <Link
                to="/access/actors/$id"
                params={{ id: actor.id }}
                className="font-medium hover:underline"
              >
                {actor.name}
              </Link>
            </td>
            {showPerson === "email" && (
              <td className="px-3 py-2">{actor.user?.email}</td>
            )}
            {showPerson === "owner" && (
              <td className="px-3 py-2">{actor.user?.name}</td>
            )}
            <td className="px-3 py-2">
              <RoleBadges keys={actor.roles} roles={roles} />
            </td>
            <td className="px-3 py-2">
              <StatusText status={actor.status} />
            </td>
          </tr>
        ))}
        {actors.length === 0 && (
          <tr>
            <td
              colSpan={4}
              className="px-3 py-6 text-center text-muted-foreground"
            >
              None yet.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

/** Actors of one kind, every page of them (lists here are short). */
export const useActors = (kind: ActorEntry["kind"]) =>
  useQuery({
    queryKey: ["actor.list", kind],
    queryFn: async () => {
      const entries: ActorEntry[] = [];
      let cursor: string | undefined;
      do {
        // oxlint-disable-next-line eslint/no-await-in-loop -- pages follow one another
        const page = await runQuery<{
          entries: ActorEntry[];
          nextCursor: string | null;
        }>("actor.list", { kind, cursor, limit: 200 });
        entries.push(...page.entries);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return entries;
    },
  });

/**
 * A list screen of one kind of actor, with a button that opens the
 * action that makes one (P1b.06).
 */
export const ActorListScreen = ({
  kind,
  create,
  showPerson,
  title,
}: {
  kind: ActorEntry["kind"];
  create: { action: string; label: string } | null;
  showPerson: "email" | "owner" | false;
  title: string;
}) => {
  const queryClient = useQueryClient();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: () => runQuery<SystemDescription>("system.describe"),
  });
  const actors = useActors(kind);
  const roles = useRoles(
    described.data?.queries.some((query) => query.name === "role.list") ?? false
  );
  const [open, setOpen] = useState(false);
  const canCreate = create && findAction(described.data, create.action);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        actions={
          canCreate && !open ? (
            <Button onClick={() => setOpen(true)}>{create.label}</Button>
          ) : null
        }
      />
      {open && create ? (
        <ActionForm
          action={create.action}
          description={described.data}
          submitLabel={create.label}
          onCancel={() => setOpen(false)}
          onDone={async () => {
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["actor.list"] });
          }}
        />
      ) : null}
      <ErrorText error={actors.error} />
      <ActorTable
        actors={actors.data ?? []}
        roles={roles.data}
        showPerson={showPerson}
      />
    </div>
  );
};
