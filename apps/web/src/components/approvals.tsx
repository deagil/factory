// Pieces the approvals inbox and the draft view share: a subject's
// approvals, one row per sign-off it needs, with Approve and Reject on the
// ones still pending. The server decides who may decide (decision 0043), so
// a refusal shows as the error it returns.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApprovalEntry } from "@workspace/actions";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

import { runAction } from "../lib/api.ts";
import { ErrorText, when } from "./activity.tsx";

const statusStyles: Record<ApprovalEntry["status"], string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-destructive/10 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export const ApprovalStatus = ({
  status,
}: {
  status: ApprovalEntry["status"];
}) => (
  <span
    className={cn(
      "rounded-full px-2 py-0.5 text-xs font-medium",
      statusStyles[status]
    )}
  >
    {status}
  </span>
);

/** "1 of 2 approved". */
export const progress = (approvals: readonly ApprovalEntry[]) => {
  const live = approvals.filter(
    (approval) =>
      approval.status === "pending" || approval.status === "approved"
  );
  const approved = live.filter((approval) => approval.status === "approved");
  return `${approved.length} of ${live.length} approved`;
};

/** Every query an approval decision can change. */
const refresh = (client: ReturnType<typeof useQueryClient>) =>
  Promise.all(
    // Approving a draft can publish it, which changes what describe shows.
    [
      "approval.list",
      "draft.get",
      "draft.list",
      "actionLog.list",
      "system.describe",
    ].map((key) => client.invalidateQueries({ queryKey: [key] }))
  );

const Decide = ({ approval }: { approval: ApprovalEntry }) => {
  const client = useQueryClient();
  const [comment, setComment] = useState("");
  const decide = useMutation({
    mutationFn: (verdict: "approve" | "reject") =>
      runAction(`approval.${verdict}`, {
        id: approval.id,
        ...(comment.trim() === "" ? {} : { comment: comment.trim() }),
      }),
    onSuccess: () => refresh(client),
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 max-w-xs"
          placeholder="Comment (optional)"
          aria-label="Comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <Button
          size="sm"
          disabled={decide.isPending}
          onClick={() => decide.mutate("approve")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={decide.isPending}
          onClick={() => decide.mutate("reject")}
        >
          Reject
        </Button>
      </div>
      <ErrorText error={decide.error} />
    </div>
  );
};

/** A subject's approvals, oldest first, deciding the pending ones here. */
export const ApprovalRows = ({
  approvals,
}: {
  approvals: readonly ApprovalEntry[];
}) => (
  <ul className="flex flex-col divide-y rounded-2xl border">
    {approvals.toReversed().map((approval) => (
      <li key={approval.id} className="flex flex-col gap-2 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ApprovalStatus status={approval.status} />
          <span>
            Sign-off from the{" "}
            <span className="font-medium">{approval.approverRole}</span> role,
            under rule{" "}
            <span className="font-mono text-xs">{approval.rule}</span>
          </span>
        </div>
        {approval.decidedBy ? (
          <p className="text-muted-foreground">
            {approval.status === "cancelled" ? "Closed" : approval.status} by{" "}
            {approval.decidedBy.name}
            {approval.decidedAt ? `, ${when(approval.decidedAt)}` : ""}
            {approval.comment ? `: “${approval.comment}”` : ""}
          </p>
        ) : null}
        {approval.status === "pending" ? <Decide approval={approval} /> : null}
      </li>
    ))}
  </ul>
);
