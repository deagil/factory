// Pieces the drafts screens share: a draft as draft.list and
// draft.get return it, and its status.
import { cn } from "@workspace/ui/lib/utils";

export interface Draft {
  id: string;
  branch: string;
  title: string;
  files: string[];
  status:
    | "draft"
    | "valid"
    | "invalid"
    | "awaiting_approval"
    | "published"
    | "abandoned";
  baseSha: string;
  publishedSha: string | null;
  syncedSha: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  publishedAt: string | null;
}

export interface ConfigProblem {
  file: string;
  path: (string | number)[];
  line: number | null;
  message: string;
}

const statusStyles: Record<Draft["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  valid: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  invalid: "bg-destructive/10 text-destructive",
  awaiting_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  published: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  abandoned: "bg-muted text-muted-foreground",
};

export const DraftStatus = ({ status }: { status: Draft["status"] }) => (
  <span
    className={cn(
      "rounded-full px-2 py-0.5 text-xs font-medium",
      statusStyles[status]
    )}
  >
    {status.replaceAll("_", " ")}
  </span>
);
