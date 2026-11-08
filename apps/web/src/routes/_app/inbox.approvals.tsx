// Inbox → Approvals (P2.10): every pending action and config draft that
// waits for a sign-off, with what it would do, who asked, and Approve and
// Reject. "Decided" shows the ones settled lately.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ApprovalEntry } from "@workspace/actions";
import { Button } from "@workspace/ui/components/button";

import {
  ActionLink,
  ErrorText,
  Json,
  when,
} from "../../components/activity.tsx";
import { ApprovalRows, progress } from "../../components/approvals.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { runQuery } from "../../lib/api.ts";

interface Subject {
  id: string;
  approvals: ApprovalEntry[];
}

/** Approvals by what they're for, newest request first. */
const bySubject = (approvals: readonly ApprovalEntry[]): Subject[] => {
  const subjects = new Map<string, ApprovalEntry[]>();
  for (const approval of approvals) {
    subjects.set(approval.subjectId, [
      ...(subjects.get(approval.subjectId) ?? []),
      approval,
    ]);
  }
  return [...subjects].map(([id, list]) => ({ id, approvals: list }));
};

const waiting = (subject: Subject) =>
  subject.approvals.some((approval) => approval.status === "pending");

const SubjectCard = ({ subject }: { subject: Subject }) => {
  const [first] = subject.approvals;
  if (!first) {
    return null;
  }
  return (
    <article className="flex flex-col gap-3 rounded-2xl border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">
          {first.action ? (
            <>
              Run <span className="font-mono">{first.action.name}</span>
            </>
          ) : (
            <>
              Publish the draft{" "}
              <Link
                to="/config/drafts/$id"
                params={{ id: subject.id }}
                className="hover:underline"
              >
                “{first.draft?.title ?? subject.id}”
              </Link>
            </>
          )}
        </h2>
        <span className="text-sm text-muted-foreground">
          {progress(subject.approvals)}
        </span>
      </header>
      <p className="text-sm text-muted-foreground">
        Asked by {first.requestedBy.name}, {when(first.createdAt)}
        {first.action ? (
          <>
            {" · "}
            <ActionLink id={subject.id}>the pending action</ActionLink>
          </>
        ) : null}
      </p>
      {first.action ? <Json value={first.action.input} /> : null}
      {first.draft ? (
        <p className="text-sm">
          Changes{" "}
          {first.draft.files.map((file) => (
            <span key={file} className="mr-2 font-mono text-xs">
              {file}
            </span>
          ))}
        </p>
      ) : null}
      <ApprovalRows approvals={subject.approvals} />
    </article>
  );
};

const ApprovalsScreen = () => {
  const { show } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const found = useQuery({
    queryKey: ["approval.list"],
    queryFn: () =>
      runQuery<{ approvals: ApprovalEntry[] }>("approval.list", {
        limit: 200,
      }),
  });
  const subjects = bySubject(found.data?.approvals ?? []);
  const shown = subjects.filter((subject) =>
    show === "decided" ? !waiting(subject) : waiting(subject)
  );
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Approvals" />
      <div className="flex gap-2">
        {(["waiting", "decided"] as const).map((each) => (
          <Button
            key={each}
            size="sm"
            variant={(show ?? "waiting") === each ? "secondary" : "ghost"}
            onClick={() =>
              navigate({ search: each === "decided" ? { show: each } : {} })
            }
          >
            {each === "waiting" ? "Waiting" : "Decided"}
          </Button>
        ))}
      </div>
      <ErrorText error={found.error} />
      {found.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {found.isSuccess && shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {show === "decided"
            ? "Nothing has been decided yet."
            : "Nothing is waiting for approval."}
        </p>
      ) : null}
      {shown.map((subject) => (
        <SubjectCard key={subject.id} subject={subject} />
      ))}
    </div>
  );
};

export const Route = createFileRoute("/_app/inbox/approvals")({
  staticData: { section: "inbox" },
  validateSearch: (search: Record<string, unknown>): { show?: "decided" } =>
    search.show === "decided" ? { show: "decided" } : {},
  component: ApprovalsScreen,
});
