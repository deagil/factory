// A person's working draft (P2.10b, decision 0044): the header pill that says
// they have edits that aren't live yet, and the pieces the pill and the
// draft's review page share: its edits in plain English with Undo, and
// Publish (or Request approval), Withdraw and Discard.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ApprovalEntry } from "@workspace/actions";
import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

import { describeSystem, runAction, runQuery } from "../lib/api.ts";
import { describeChange } from "../lib/config-diff.ts";
import type { ConfigChange } from "../lib/config-diff.ts";
import {
  approvalProgress,
  pillFor,
  publishLabel,
} from "../lib/working-draft.ts";
import type { PillTone, SignOffNeeded } from "../lib/working-draft.ts";
import { ErrorText } from "./activity.tsx";
import type { ConfigProblem, Draft } from "./drafts.tsx";

export interface DraftDetail {
  draft: Draft;
  changes: (ConfigChange & { before: string | null; after: string | null })[];
  approvals: ApprovalEntry[];
  problems: ConfigProblem[];
}

/** Every query a change to a draft or its approvals can change. */
export const draftQueries = [
  "draft.mine",
  "draft.get",
  "draft.list",
  "draft.files",
  "approval.list",
  "approval.check",
];

export const useRefreshDrafts = () => {
  const client = useQueryClient();
  return () =>
    Promise.all(
      draftQueries.map((key) => client.invalidateQueries({ queryKey: [key] }))
    );
};

/** The caller's working draft, or null; undefined while it loads. */
export const useWorkingDraft = () => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const allowed =
    described.data?.queries.some((query) => query.name === "draft.mine") ??
    false;
  const mine = useQuery({
    queryKey: ["draft.mine"],
    queryFn: () => runQuery<{ draft: Draft | null }>("draft.mine"),
    enabled: allowed,
  });
  return allowed ? mine.data?.draft : null;
};

export const useDraftDetail = (id: string | undefined) =>
  useQuery({
    queryKey: ["draft.get", id],
    queryFn: () => runQuery<DraftDetail>("draft.get", { id }),
    enabled: id !== undefined,
    retry: false,
  });

/** Who publishing `draft` would ask, from approval.check. */
export const useSignOffs = (draft: Draft | null | undefined) => {
  const open = draft?.status === "valid";
  const checked = useQuery({
    queryKey: ["approval.check", draft?.id, draft?.files],
    queryFn: () =>
      runQuery<{ signOffs: SignOffNeeded[] }>("approval.check", {
        draftId: draft?.id,
      }),
    enabled: open,
  });
  return checked.data?.signOffs ?? [];
};

/** Publish, Withdraw, Discard and Undo for one draft. */
export const useDraftActions = (id: string) => {
  const client = useQueryClient();
  const refresh = useRefreshDrafts();
  const publish = useMutation({
    mutationFn: (title?: string) =>
      runAction<{ draft: Draft }>("draft.publish", {
        id,
        ...(title ? { title } : {}),
      }),
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        // Published config changes what describe shows, such as options.
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
  const revert = useMutation({
    mutationFn: (path: string) => runAction("draft.revert", { id, path }),
    onSuccess: refresh,
  });
  return { publish, withdraw, discard, revert };
};

export type DraftActions = ReturnType<typeof useDraftActions>;

const isOpen = (draft: Draft) =>
  draft.status !== "published" && draft.status !== "abandoned";

const kindStyles = {
  added: "text-emerald-700 dark:text-emerald-300",
  removed: "text-destructive",
  changed: "text-muted-foreground",
};

/**
 * What a draft changes, file by file in plain English, with Undo while it
 * can change. `full` adds each file's YAML before and after.
 */
export const DraftEdits = ({
  detail,
  actions,
  full = false,
}: {
  detail: DraftDetail;
  actions: DraftActions;
  full?: boolean;
}) => {
  const { draft, changes } = detail;
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No edits yet. Change a setting and save it, and it shows here until it’s
        published.
      </p>
    );
  }
  // Undoing an edit while it waits for approval would withdraw the request.
  const undoable = isOpen(draft) && draft.status !== "awaiting_approval";
  return (
    <ul className={cn("flex flex-col", full ? "gap-3" : "divide-y")}>
      {changes.map((change) => {
        const described = describeChange(change);
        return (
          <li
            key={change.path}
            className={cn(
              "flex flex-col gap-1.5 text-sm",
              full ? "rounded-2xl border p-4" : "py-2.5 first:pt-0 last:pb-0"
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">
                {described.title}{" "}
                <span className={cn("text-xs", kindStyles[described.kind])}>
                  {described.kind}
                </span>
              </p>
              {undoable ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={actions.revert.isPending}
                  onClick={() => actions.revert.mutate(change.path)}
                >
                  Undo
                </Button>
              ) : null}
            </div>
            <ul
              className={cn(
                "list-disc pl-5",
                full ? "" : "text-muted-foreground"
              )}
            >
              {(full ? described.lines : described.lines.slice(0, 3)).map(
                (line) => (
                  <li key={line}>{line}</li>
                )
              )}
              {!full && described.lines.length > 3 ? (
                <li>And {described.lines.length - 3} more.</li>
              ) : null}
            </ul>
            {full ? (
              <details>
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
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};

/** A draft's problems against the running system, if it has any. */
export const DraftProblems = ({
  problems,
}: {
  problems: readonly ConfigProblem[];
}) =>
  problems.length === 0 ? null : (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
    >
      <p className="font-medium text-destructive">
        These edits don’t check out against the running system, so they can’t be
        published yet:
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

/** Discard, with a second click to confirm, since it can't be undone. */
const DiscardButton = ({ actions }: { actions: DraftActions }) => {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Discard
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="destructive"
        disabled={actions.discard.isPending}
        onClick={() => actions.discard.mutate()}
      >
        Discard all edits
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </>
  );
};

/**
 * Discard, and Publish (named for whoever it will ask) or Withdraw request.
 * `title` names the published commit.
 */
export const DraftButtons = ({
  draft,
  actions,
  title,
}: {
  draft: Draft;
  actions: DraftActions;
  title?: string;
}) => {
  const signOffs = useSignOffs(draft);
  if (!isOpen(draft)) {
    return null;
  }
  return (
    <>
      <DiscardButton actions={actions} />
      {draft.status === "awaiting_approval" ? (
        <Button
          variant="outline"
          disabled={actions.withdraw.isPending}
          onClick={() => actions.withdraw.mutate()}
        >
          Withdraw request
        </Button>
      ) : (
        <Button
          disabled={
            actions.publish.isPending ||
            draft.status !== "valid" ||
            draft.files.length === 0
          }
          onClick={() => actions.publish.mutate(title)}
        >
          {publishLabel(signOffs)}
        </Button>
      )}
    </>
  );
};

/** Why the last draft action failed, if one did. */
export const DraftActionError = ({ actions }: { actions: DraftActions }) => (
  <ErrorText
    error={
      actions.publish.error ??
      actions.withdraw.error ??
      actions.discard.error ??
      actions.revert.error
    }
  />
);

const toneStyles: Record<PillTone, string> = {
  edits: "bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:text-sky-300",
  waiting:
    "bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
  problems: "bg-destructive/10 text-destructive hover:bg-destructive/15",
};

const PillPanel = ({
  draft,
  onClose,
}: {
  draft: Draft;
  onClose: () => void;
}) => {
  const detail = useDraftDetail(draft.id);
  const actions = useDraftActions(draft.id);
  const waiting = draft.status === "awaiting_approval";
  return (
    <>
      <PopoverHeader>
        <PopoverTitle>{draft.title}</PopoverTitle>
        <PopoverDescription>
          {waiting
            ? "Waiting for approval. It publishes once it’s approved; withdraw the request to change it."
            : "Your edits aren’t live until you publish them."}
        </PopoverDescription>
      </PopoverHeader>
      {detail.data ? (
        <div className="max-h-80 overflow-y-auto">
          <DraftEdits detail={detail.data} actions={actions} />
        </div>
      ) : (
        <ErrorText error={detail.error} />
      )}
      {detail.data && detail.data.problems.length > 0 ? (
        <p className="text-sm text-destructive">
          {detail.data.problems.length === 1
            ? "1 problem"
            : `${detail.data.problems.length} problems`}{" "}
          to fix before it can be published. Review shows them.
        </p>
      ) : null}
      <DraftActionError actions={actions} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          nativeButton={false}
          render={
            <Link
              to="/config/drafts/$id"
              params={{ id: draft.id }}
              onClick={onClose}
            />
          }
        >
          Review
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <DraftButtons draft={draft} actions={actions} />
        </div>
      </div>
    </>
  );
};

/**
 * The header pill: how many of the caller's edits aren't live, or that they
 * wait for approval or have problems. Opens a panel to publish them.
 */
export const DraftPill = () => {
  const draft = useWorkingDraft();
  const detail = useDraftDetail(
    draft?.status === "awaiting_approval" ? draft.id : undefined
  );
  const [open, setOpen] = useState(false);
  const pill = pillFor(
    draft ?? null,
    approvalProgress(detail.data?.approvals ?? [])
  );
  if (!draft || !pill) {
    return null;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
          toneStyles[pill.tone]
        )}
      >
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-current opacity-80"
        />
        {pill.label}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // The popover's own w-72 wins over a plain width; sm: sorts later.
        className="max-w-[calc(100vw-2rem)] sm:w-96"
      >
        <PillPanel draft={draft} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};
