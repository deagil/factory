// Choice lists edited in place (P2.10c, decision 0044): each list as the
// caller's working draft has it (or as production has it, before their first
// save), with the live version beside it. The live version of a list the
// draft changes is the change's before value; any other list is live as it
// stands.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { describeSystem, runQuery } from "../lib/api.ts";
import type { SystemDescription } from "../lib/api.ts";
import { canEditConfig, optionsOf, usesOf } from "../lib/choice-lists.ts";
import { humanise } from "../lib/forms.ts";
import { columnsOf } from "./config-editors.tsx";
import { useDraftDetail, useWorkingDraft } from "./working-draft.tsx";

export interface ChoiceFile {
  path: string;
  type: string;
  key: string;
  content: string;
  /** The file's git blob id. */
  revision: string;
  value: unknown;
}

/**
 * Every choice list, from the working draft or production, and for each one
 * the live value and whether the working draft changes it.
 */
export const useChoiceLists = () => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const working = useWorkingDraft();
  const detail = useDraftDetail(working?.id);
  const files = useQuery({
    queryKey: ["draft.files", "mine"],
    queryFn: () =>
      runQuery<{ draftId: string | null; files: ChoiceFile[] }>(
        "draft.files",
        {}
      ),
    enabled: canEditConfig(described.data),
  });
  const changes = detail.data?.changes ?? [];
  const lists = (files.data?.files ?? [])
    .filter((file) => file.type === "choices")
    .map((file) => {
      const change = changes.find((each) => each.path === file.path);
      return {
        file,
        edited: change !== undefined,
        live: change ? change.beforeValue : file.value,
      };
    });
  return {
    described,
    working,
    files,
    lists,
    waiting: working?.status === "awaiting_approval",
  };
};

/** Where each list is used, linking to the object's records. */
export const ListUses = ({
  description,
  list,
}: {
  description: SystemDescription | undefined;
  list: string;
}) => {
  const uses = usesOf(description, list);
  if (uses.length === 0) {
    return <span className="text-muted-foreground">No fields you can see</span>;
  }
  return (
    <span className="flex flex-wrap gap-x-2">
      {uses.map((use) => (
        <Link
          key={`${use.object}.${use.field}`}
          to="/o/$object"
          params={{ object: use.object }}
          className="hover:underline"
        >
          {use.objectLabel} · {use.fieldLabel}
        </Link>
      ))}
    </span>
  );
};

const cell = "px-3 py-2 align-middle";

/** A list's options, read-only: the live version. */
export const LiveOptions = ({
  list,
  value,
  description,
}: {
  list: string;
  value: unknown;
  description: SystemDescription | undefined;
}) => {
  const options = optionsOf(value);
  const columns = Object.keys(columnsOf(description, list)?.properties ?? {});
  return (
    <div className="overflow-x-auto rounded-2xl border">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className={`${cell} font-medium`}>Key</th>
            <th className={`${cell} font-medium`}>Label</th>
            <th className={`${cell} font-medium`}>Description</th>
            {columns.map((name) => (
              <th key={name} className={`${cell} font-medium`}>
                {humanise(name)}
              </th>
            ))}
            <th className={`${cell} font-medium`}>Archived</th>
          </tr>
        </thead>
        <tbody>
          {options.map((option) => (
            <tr key={String(option.key)} className="border-b last:border-0">
              <td className={`${cell} font-mono text-xs`}>
                {String(option.key)}
              </td>
              <td className={cell}>{String(option.label ?? "")}</td>
              <td className={`${cell} text-muted-foreground`}>
                {String(option.description ?? "")}
              </td>
              {columns.map((name) => (
                <td key={name} className={cell}>
                  {option[name] === undefined ? "" : String(option[name])}
                </td>
              ))}
              <td className={cell}>{option.archived === true ? "Yes" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
