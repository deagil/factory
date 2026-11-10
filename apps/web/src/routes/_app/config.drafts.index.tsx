// Config → Drafts (P2.10, P2.10b): edit choice lists and roles straight
// away, into your working draft, which your first save opens and the header
// pill publishes (decision 0044); and every draft, newest first. P2.10c and
// P2.10d move editing to each setting's own page.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { ErrorText, when } from "../../components/activity.tsx";
import { ConfigFiles } from "../../components/config-files.tsx";
import { DraftStatus } from "../../components/drafts.tsx";
import type { Draft } from "../../components/drafts.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { useWorkingDraft } from "../../components/working-draft.tsx";
import { runQuery } from "../../lib/api.ts";

const DraftsScreen = () => {
  const navigate = useNavigate();
  const working = useWorkingDraft();
  const drafts = useQuery({
    queryKey: ["draft.list"],
    queryFn: () => runQuery<{ drafts: Draft[] }>("draft.list", { limit: 200 }),
  });
  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <PageHeader title="Drafts" />
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Change config</h2>
          <p className="text-sm text-muted-foreground">
            Your edits go into your own draft and aren’t live until you publish
            them from the header.
          </p>
        </div>
        <ConfigFiles waiting={working?.status === "awaiting_approval"} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">All drafts</h2>
        <ErrorText error={drafts.error} />
        {drafts.data?.drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drafts yet.</p>
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
                  <OpenRow
                    key={draft.id}
                    onOpen={() =>
                      navigate({
                        to: "/config/drafts/$id",
                        params: { id: draft.id },
                      })
                    }
                  >
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
                  </OpenRow>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
};

export const Route = createFileRoute("/_app/config/drafts/")({
  staticData: { section: "config" },
  component: DraftsScreen,
});
