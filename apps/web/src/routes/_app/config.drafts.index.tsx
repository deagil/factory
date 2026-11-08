// Config → Drafts (P2.10): every config draft, newest first, and a new one.
// A draft is a branch made from production (decision 0041); its own page
// edits, submits and publishes it.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

import { ErrorText, when } from "../../components/activity.tsx";
import { DraftStatus } from "../../components/drafts.tsx";
import type { Draft } from "../../components/drafts.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runAction, runQuery } from "../../lib/api.ts";

const NewDraft = ({ onCancel }: { onCancel: () => void }) => {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const open = useMutation({
    mutationFn: () => runAction<{ draft: Draft }>("draft.open", { title }),
    onSuccess: (result) =>
      navigate({
        to: "/config/drafts/$id",
        params: { id: result.output.draft.id },
      }),
  });
  return (
    <form
      className="flex max-w-lg flex-col gap-3 rounded-2xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        open.mutate();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">What is this draft for?</span>
        <Input
          required
          autoFocus
          placeholder="Add a negotiation stage"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <ErrorText error={open.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={open.isPending}>
          Start draft
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

const DraftsScreen = () => {
  const [starting, setStarting] = useState(false);
  const drafts = useQuery({
    queryKey: ["draft.list"],
    queryFn: () => runQuery<{ drafts: Draft[] }>("draft.list", { limit: 200 }),
  });
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Drafts"
        actions={
          starting ? null : (
            <Button onClick={() => setStarting(true)}>New draft</Button>
          )
        }
      />
      {starting ? <NewDraft onCancel={() => setStarting(false)} /> : null}
      <ErrorText error={drafts.error} />
      {drafts.data?.drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No drafts yet. Start one to change choices, roles or approval rules.
        </p>
      ) : null}
      {drafts.data && drafts.data.drafts.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-3 py-2 font-medium">Draft</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Files</th>
                <th className="px-3 py-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {drafts.data.drafts.map((draft) => (
                <tr key={draft.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <Link
                      to="/config/drafts/$id"
                      params={{ id: draft.id }}
                      className="font-medium hover:underline"
                    >
                      {draft.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <DraftStatus status={draft.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {draft.files.length === 0 ? "—" : draft.files.join(", ")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {draft.createdBy.name}, {when(draft.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/config/drafts/")({
  staticData: { section: "config" },
  component: DraftsScreen,
});
