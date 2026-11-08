// Editing config files (P2.10, P2.10b): pick a choice list or role, or start
// a new role, and edit it as a form. With a draft id it edits that draft;
// without one it edits the caller's working draft, or the live config until
// their first save opens one (decision 0044). A save while the draft waits
// for approval withdraws the request, so the editor says so first.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

import { describeSystem, runAction, runQuery } from "../lib/api.ts";
import { ErrorText } from "./activity.tsx";
import { ConfigEditor, hasEditor } from "./config-editors.tsx";
import type { ConfigProblem, Draft } from "./drafts.tsx";
import { useRefreshDrafts } from "./working-draft.tsx";

interface DraftFile {
  path: string;
  type: string;
  key: string;
  content: string;
  value: unknown;
}

export interface Checked {
  draft: Draft;
  problems: ConfigProblem[];
}

const typeLabels: Record<string, string> = {
  choices: "Choice lists",
  roles: "Roles",
};

export const ConfigFiles = ({
  draftId,
  waiting,
  onChecked,
}: {
  /** The draft to edit; the caller's working draft when left out. */
  draftId?: string;
  /** Whether that draft waits for approval, which a save withdraws. */
  waiting: boolean;
  onChecked?: (checked: Checked) => void;
}) => {
  const refresh = useRefreshDrafts();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const files = useQuery({
    queryKey: ["draft.files", draftId ?? "mine"],
    queryFn: () =>
      runQuery<{ draftId: string | null; files: DraftFile[] }>(
        "draft.files",
        draftId ? { id: draftId } : {}
      ),
  });
  const [path, setPath] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [created, setCreated] = useState<DraftFile | null>(null);
  const save = useMutation({
    mutationFn: (input: { path: string; value: Record<string, unknown> }) =>
      runAction<Checked>("draft.save", {
        ...(draftId ? { id: draftId } : {}),
        ...input,
      }),
    onSuccess: async (result) => {
      onChecked?.(result.output);
      setCreated(null);
      await refresh();
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
      {waiting ? (
        <p className="rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          These edits are waiting for approval. Saving another change withdraws
          the request, and you’ll need to ask again.
        </p>
      ) : null}
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
            saveLabel={waiting ? "Save and withdraw request" : undefined}
            onSave={(value) => save.mutate({ path: chosen.path, value })}
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Pick a file to edit it.</p>
      )}
    </div>
  );
};
