// A record's history: each audit_log change, newest first, with who made
// it and through which action, from the `record.history` query (P1.21).
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { HistoryEntry } from "@workspace/actions";

import { runQuery } from "../lib/api.ts";
import type { SystemDescription } from "../lib/api.ts";
import { displayValue, findObject, titleOf } from "../lib/records.ts";
import type { ObjectDescription } from "../lib/records.ts";

/** The name of the record a ref points at, if the caller can read it. */
const RefName = ({
  target,
  id,
  description,
}: {
  target: string;
  id: string;
  description: SystemDescription | undefined;
}) => {
  const object = findObject(description, target);
  const found = useQuery({
    queryKey: ["ref", target, id],
    queryFn: () =>
      runQuery<{ record: Record<string, unknown> }>(`${target}.get`, {
        id,
        archived: "include",
      }),
    enabled: object !== undefined,
    retry: false,
  });
  return found.data ? titleOf(found.data.record, object) : id;
};

const Value = ({
  object,
  fieldKey,
  values,
  description,
}: {
  object: ObjectDescription;
  fieldKey: string;
  values: Record<string, unknown>;
  description: SystemDescription | undefined;
}) => {
  const value = values[fieldKey];
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">empty</span>;
  }
  const field = object.fields.find((each) => each.key === fieldKey);
  if (field?.type === "ref" && field.target) {
    return (
      <RefName
        target={field.target}
        id={String(value)}
        description={description}
      />
    );
  }
  return field
    ? displayValue(field, values, {}, description)
    : JSON.stringify(value);
};

const when = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const RecordHistory = ({
  object,
  id,
  description,
}: {
  object: ObjectDescription;
  id: string;
  description: SystemDescription | undefined;
}) => {
  const history = useQuery({
    queryKey: ["history", object.name, id],
    queryFn: () =>
      runQuery<{ entries: HistoryEntry[] }>("record.history", {
        object: object.name,
        id,
      }),
  });
  if (history.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (history.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {history.error.message}
      </p>
    );
  }
  const labelOf = (key: string) =>
    object.fields.find((field) => field.key === key)?.label ?? key;
  // Changed fields in the object's own order; custom fields after.
  const order = (key: string) => {
    const index = object.fields.findIndex((field) => field.key === key);
    return index === -1 ? object.fields.length : index;
  };
  return (
    <ol className="flex flex-col gap-3">
      {history.data.entries.map((entry) => {
        const created = Object.keys(entry.before).length === 0;
        return (
          <li key={entry.id} className="rounded-2xl border p-3 text-sm">
            <p>
              <span className="font-medium">{entry.actor.name}</span>
              {entry.onBehalfOf && ` for ${entry.onBehalfOf.name}`}{" "}
              {created ? "created it" : "changed it"}
              <span className="text-muted-foreground">
                {" "}
                ·{" "}
                <Link
                  to="/activity/actions/$id"
                  params={{ id: entry.actionId }}
                  className="hover:underline"
                >
                  {entry.action}
                </Link>{" "}
                · {when(entry.at)}
              </span>
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {Object.keys(entry.after)
                .toSorted((a, b) => order(a) - order(b))
                .map((key) => (
                  <li key={key}>
                    <span className="text-muted-foreground">
                      {labelOf(key)}:
                    </span>{" "}
                    {!created && (
                      <>
                        <Value
                          object={object}
                          fieldKey={key}
                          values={entry.before}
                          description={description}
                        />{" "}
                        →{" "}
                      </>
                    )}
                    <Value
                      object={object}
                      fieldKey={key}
                      values={entry.after}
                      description={description}
                    />
                  </li>
                ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
};
