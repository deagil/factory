// One config draft (P2.10): what it changes in plain English, its
// approvals, editors for its choice lists and roles, and Submit and Publish.
// Each save is a commit on the draft's branch and checks the whole draft
// against the running system; problems show here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ApprovalEntry } from "@workspace/actions";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import type { ReactNode } from "react";

import { ErrorText, when } from "../../components/activity.tsx";
import { ApprovalRows, progress } from "../../components/approvals.tsx";
import { ConfigEditor, hasEditor } from "../../components/config-editors.tsx";
import { DraftStatus } from "../../components/drafts.tsx";
import type { ConfigProblem, Draft } from "../../components/drafts.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem, runAction, runQuery } from "../../lib/api.ts";
import { describeChange } from "../../lib/config-diff.ts";
import type { ConfigChange } from "../../lib/config-diff.ts";

interface DraftDetail {
  draft: Draft;
  changes: (ConfigChange & { before: string | null; after: string | null })[];
  approvals: ApprovalEntry[];
}

interface DraftFile {
  path: string;
  type: string;
  key: string;
  content: string;
  value: unknown;
}

interface Checked {
  draft: Draft;
  problems: ConfigProblem[];
}

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="font-medium">{title}</h2>
    {children}
  </section>
);

const kindStyles = {
  added: "text-emerald-700 dark:text-emerald-300",
  removed: "text-destructive",
  changed: "text-muted-foreground",
};

const Changes = ({ changes }: { changes: DraftDetail["changes"] }) =>
  changes.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      Nothing yet. Edit a file below and save it to the draft.
    </p>
  ) : (
    <ul className="flex flex-col gap-3">
      {changes.map((change) => {
        const described = describeChange(change);
        return (
          <li key={change.path} className="rounded-2xl border p-4 text-sm">
            <p className="font-medium">
              {described.title}{" "}
              <span className={cn("text-xs", kindStyles[described.kind])}>
                {described.kind}
              </span>
            </p>
            <ul className="mt-2 list-disc pl-5">
              {described.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground">
                YAML
              </summary>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {(["before", "after"] as const).map((side) => (
                  <div key={side} className="min-w-0">
                    <p className="text-xs text-muted-foreground capitalize">
                      {side}
                    </p>
                    <pre className="overflow-x-auto rounded-2xl bg-muted/50 p-3 font-mono text-xs/relaxed">
                      {change[side] ?? "(no file)"}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );

const Problems = ({ problems }: { problems: ConfigProblem[] }) =>
  problems.length === 0 ? null : (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-medium text-destructive">
        The draft doesn’t check out against the running system:
      </p>
      <ul className="mt-2 list-disc pl-5">
        {problems.map((problem) => (
          <li
            key={`${problem.file}:${problem.path.join(".")}:${problem.message}`}
          >
            <span className="font-mono text-xs">
              {problem.file}
              {problem.path.length > 0 ? ` ${problem.path.join(".")}` : ""}
            </span>
            : {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );

const typeLabels: Record<string, string> = {
  choices: "Choice lists",
  roles: "Roles",
};

const Editors = ({
  id,
  onChecked,
}: {
  id: string;
  onChecked: (checked: Checked) => void;
}) => {
  const client = useQueryClient();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const files = useQuery({
    queryKey: ["draft.files", id],
    queryFn: () => runQuery<{ files: DraftFile[] }>("draft.files", { id }),
  });
  const [path, setPath] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [created, setCreated] = useState<DraftFile | null>(null);
  const save = useMutation({
    mutationFn: (input: { path: string; value: Record<string, unknown> }) =>
      runAction<Checked>("draft.save", { id, ...input }),
    onSuccess: async (result) => {
      onChecked(result.output);
      setCreated(null);
      await Promise.all(
        ["draft.get", "draft.files", "draft.list"].map((key) =>
          client.invalidateQueries({ queryKey: [key] })
        )
      );
    },
  });
  const editable = (files.data?.files ?? []).filter((file) =>
    hasEditor(file.type)
  );
  const chosen =
    (created?.path === path ? created : null) ??
    editable.find((file) => file.path === path);
  const types = [...new Set(editable.map((file) => file.type))];
  const startRole = () => {
    const key = newRole.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(key)) {
      return;
    }
    const file = {
      path: `config/roles/${key}.yaml`,
      type: "roles",
      key,
      content: "",
      value: { key, label: key, permissions: [] },
    };
    setCreated(file);
    setPath(file.path);
    setNewRole("");
  };
  return (
    <div className="flex flex-col gap-4">
      <ErrorText error={files.error} />
      <div className="flex flex-wrap gap-6">
        {types.map((type) => (
          <div key={type} className="flex flex-col gap-1.5">
            <p className="text-sm text-muted-foreground">
              {typeLabels[type] ?? type}
            </p>
            <div className="flex flex-wrap gap-1">
              {editable
                .filter((file) => file.type === type)
                .map((file) => (
                  <Button
                    key={file.path}
                    size="sm"
                    variant={file.path === path ? "secondary" : "outline"}
                    onClick={() => setPath(file.path)}
                  >
                    {file.key}
                  </Button>
                ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">New role</p>
          <div className="flex gap-1">
            <Input
              aria-label="New role's key"
              className="h-7 w-36 font-mono"
              placeholder="support"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value)}
            />
            <Button size="sm" variant="outline" onClick={startRole}>
              Add
            </Button>
          </div>
        </div>
      </div>
      <ErrorText error={save.error} />
      {chosen ? (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-muted-foreground">
            {chosen.path}
          </p>
          <ConfigEditor
            type={chosen.type}
            // A save brings new content, which starts the editor afresh.
            key={`${chosen.path}:${chosen.content}`}
            value={(chosen.value ?? {}) as Record<string, unknown>}
            description={described.data}
            saving={save.isPending}
            onSave={(value) => save.mutate({ path: chosen.path, value })}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a file to edit it in this draft.
        </p>
      )}
    </div>
  );
};

const DraftScreen = () => {
  const { id } = Route.useParams();
  const client = useQueryClient();
  const [problems, setProblems] = useState<ConfigProblem[]>([]);
  const found = useQuery({
    queryKey: ["draft.get", id],
    queryFn: () => runQuery<DraftDetail>("draft.get", { id }),
    retry: false,
  });
  const refresh = () =>
    Promise.all(
      ["draft.get", "draft.files", "draft.list", "approval.list"].map((key) =>
        client.invalidateQueries({ queryKey: [key] })
      )
    );
  // Publishing a draft an approval rule covers asks for approval instead,
  // and the last approval publishes it (decision 0044).
  const publish = useMutation({
    mutationFn: () => runAction<{ draft: Draft }>("draft.publish", { id }),
    onSuccess: async () => {
      setProblems([]);
      await Promise.all([
        refresh(),
        // The published config changes what describe shows, such as options.
        client.invalidateQueries({ queryKey: ["system.describe"] }),
      ]);
    },
  });
  const withdraw = useMutation({
    mutationFn: () => runAction("approval.withdraw", { subjectId: id }),
    onSuccess: refresh,
  });
  const discard = useMutation({
    mutationFn: () => runAction("draft.discard", { id }),
    onSuccess: refresh,
  });
  const trail = [{ label: "Drafts", link: { to: "/config/drafts" } }] as const;
  if (found.isPending) {
    return <PageHeader title="Loading…" trail={[...trail]} />;
  }
  if (found.isError) {
    return (
      <>
        <PageHeader title="Draft" trail={[...trail]} />
        <ErrorText error={found.error} />
      </>
    );
  }
  const { draft, changes, approvals } = found.data;
  const open = draft.status !== "published" && draft.status !== "abandoned";
  const live = approvals.filter((approval) => approval.status !== "cancelled");
  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <PageHeader
        title={draft.title}
        trail={[...trail]}
        actions={
          open ? (
            <>
              <Button
                variant="ghost"
                disabled={discard.isPending}
                onClick={() => discard.mutate()}
              >
                Discard
              </Button>
              {draft.status === "awaiting_approval" ? (
                <Button
                  variant="outline"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate()}
                >
                  Withdraw request
                </Button>
              ) : (
                <Button
                  disabled={publish.isPending || draft.status !== "valid"}
                  onClick={() => publish.mutate()}
                >
                  Publish
                </Button>
              )}
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-2 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <DraftStatus status={draft.status} />
          <span className="text-muted-foreground">
            Started by {draft.createdBy.name}, {when(draft.createdAt)}
            {draft.publishedAt ? `; published ${when(draft.publishedAt)}` : ""}
          </span>
        </p>
        {draft.status === "awaiting_approval" ? (
          <p className="text-muted-foreground">
            Waiting for approval ({progress(approvals)}). It publishes once it’s
            approved.
          </p>
        ) : null}
        {open && draft.status !== "awaiting_approval" ? (
          <p className="text-muted-foreground">
            Publish checks the draft again. If an approval rule covers it, it
            asks for approval instead, and publishes once it’s approved.
          </p>
        ) : null}
        <ErrorText error={publish.error ?? withdraw.error ?? discard.error} />
      </div>
      <Problems problems={problems} />
      <Section title="What it changes">
        <Changes changes={changes} />
      </Section>
      {live.length > 0 ? (
        <Section title="Approvals">
          <ApprovalRows approvals={live} />
        </Section>
      ) : null}
      {open ? (
        <Section title="Edit">
          <Editors
            id={id}
            onChecked={(checked) => setProblems(checked.problems)}
          />
        </Section>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/config/drafts/$id")({
  staticData: { section: "config" },
  component: DraftScreen,
});
