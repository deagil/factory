// Reviewing a config draft (P2.10b): what it changes in plain English, with
// Undo per file, its problems and its approvals, and Publish (or Request
// approval), Withdraw and Discard. Its name becomes the published commit's
// subject. Each save is a commit on the draft's branch and checks the whole
// draft against the running system (decisions 0041, 0044).
import { createFileRoute } from "@tanstack/react-router";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";
import type { ReactNode } from "react";

import { ErrorText, when } from "../../components/activity.tsx";
import { ApprovalRows } from "../../components/approvals.tsx";
import { ConfigFiles } from "../../components/config-files.tsx";
import { DraftStatus } from "../../components/drafts.tsx";
import type { ConfigProblem } from "../../components/drafts.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import {
  DraftActionError,
  DraftButtons,
  DraftEdits,
  DraftProblems,
  useDraftActions,
  useDraftDetail,
} from "../../components/working-draft.tsx";
import { approvalProgress } from "../../lib/working-draft.ts";

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

const DraftScreen = () => {
  const { id } = Route.useParams();
  const found = useDraftDetail(id);
  const actions = useDraftActions(id);
  // Problems from the latest save, until draft.get catches up.
  const [saved, setSaved] = useState<ConfigProblem[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);
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
  const { draft, approvals } = found.data;
  const open = draft.status !== "published" && draft.status !== "abandoned";
  const waiting = draft.status === "awaiting_approval";
  const live = approvals.filter((approval) => approval.status !== "cancelled");
  const progress = approvalProgress(approvals);
  const named = title?.trim() ?? "";
  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <PageHeader
        title={draft.title}
        trail={[...trail]}
        actions={
          <DraftButtons
            draft={draft}
            actions={actions}
            title={named === "" ? undefined : named}
          />
        }
      />
      <div className="flex flex-col gap-3 text-sm">
        <p className="flex flex-wrap items-center gap-2">
          <DraftStatus status={draft.status} />
          <span className="text-muted-foreground">
            Started by {draft.createdBy.name}, {when(draft.createdAt)}
            {draft.publishedAt ? `; published ${when(draft.publishedAt)}` : ""}
          </span>
        </p>
        {waiting ? (
          <p className="text-muted-foreground">
            Waiting for approval ({progress.approved} of {progress.needed}{" "}
            approved). It publishes as soon as it’s approved. Withdraw the
            request to change it.
          </p>
        ) : null}
        {open && !waiting ? (
          <label className="flex max-w-lg flex-col gap-1.5">
            <span className="font-medium">Name</span>
            <Input
              // A name typed here is kept for Publish; until then the draft's.
              value={title ?? draft.title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <span className="text-muted-foreground">
              Says what these edits are for in the config history. It’s saved
              when you publish.
            </span>
          </label>
        ) : null}
        <DraftActionError actions={actions} />
      </div>
      <DraftProblems problems={saved ?? found.data.problems} />
      <Section title="Edits">
        <DraftEdits detail={found.data} actions={actions} full />
      </Section>
      {live.length > 0 ? (
        <Section title="Approvals">
          <ApprovalRows approvals={live} />
        </Section>
      ) : null}
      {open ? (
        <Section title="Edit">
          <ConfigFiles
            draftId={id}
            waiting={waiting}
            onChecked={(checked) => setSaved(checked.problems)}
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
