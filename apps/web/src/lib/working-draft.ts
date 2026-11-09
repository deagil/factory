// How a person's working draft reads in the header and on its review page
// (decision 0044): how many edits aren't live yet, whether it waits
// for approval or has problems, and what pressing Publish will do.

/** A draft's status, as draft.mine and draft.get return it. */
export type DraftStatus =
  | "draft"
  | "valid"
  | "invalid"
  | "awaiting_approval"
  | "published"
  | "abandoned";

/** One sign-off approval.check says publishing would need. */
export interface SignOffNeeded {
  rule: string;
  label: string;
  approverRole: string;
  approvals: number;
}

export type PillTone = "edits" | "waiting" | "problems";

/** What the header pill says, or null when there's nothing to show. */
export const pillFor = (
  draft: { status: DraftStatus; files: readonly string[] } | null,
  /** How far a request has got, for a draft waiting for approval. */
  approvals?: { approved: number; needed: number }
): { label: string; tone: PillTone } | null => {
  if (!draft) {
    return null;
  }
  if (draft.status === "awaiting_approval") {
    return {
      label: `Waiting for approval · ${approvals?.approved ?? 0} of ${approvals?.needed ?? 0}`,
      tone: "waiting",
    };
  }
  if (draft.files.length === 0) {
    return null;
  }
  if (draft.status === "invalid") {
    return { label: "Draft has problems", tone: "problems" };
  }
  const count = draft.files.length;
  return {
    label: `${count} unpublished ${count === 1 ? "edit" : "edits"}`,
    tone: "edits",
  };
};

/** "admin" → "Admin", "sales-lead" → "Sales lead". */
const roleName = (key: string) => {
  const words = key.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The Publish button's label: "Publish", or who it will ask, such as
 * "Request approval from Admin" or "Request 2 approvals from Manager and
 * Finance".
 */
export const publishLabel = (signOffs: readonly SignOffNeeded[]) => {
  if (signOffs.length === 0) {
    return "Publish";
  }
  const total = signOffs.reduce((sum, each) => sum + each.approvals, 0);
  const roles = [
    ...new Set(signOffs.map((each) => roleName(each.approverRole))),
  ];
  const last = roles.pop();
  const who = roles.length > 0 ? `${roles.join(", ")} and ${last}` : last;
  return total === 1
    ? `Request approval from ${who}`
    : `Request ${total} approvals from ${who}`;
};

/** Approvals still counting toward a request: pending or approved. */
export const approvalProgress = (approvals: readonly { status: string }[]) => {
  const live = approvals.filter(
    (each) => each.status === "pending" || each.status === "approved"
  );
  return {
    approved: live.filter((each) => each.status === "approved").length,
    needed: live.length,
  };
};
