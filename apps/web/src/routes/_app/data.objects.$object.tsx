// Data → Objects → one object: its fields, and the choice lists those
// fields take their options from.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ErrorText } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem } from "../../lib/api.ts";
import { listLabel } from "../../lib/choice-lists.ts";
import { findObject } from "../../lib/records.ts";
import type { FieldDescription } from "../../lib/records.ts";

const cell = "px-3 py-2 align-middle";

const FieldOptions = ({ field }: { field: FieldDescription }) => {
  if (field.computed) {
    return (
      <span className="font-mono text-xs">
        {field.computed.fields.join(", ")}
        {field.avatar ? ` · avatar ${field.avatar}` : ""}
      </span>
    );
  }
  if (field.list) {
    return (
      <Link
        to="/settings/choices/$list"
        params={{ list: field.list }}
        className="font-medium hover:underline"
      >
        {listLabel(field.list)}
      </Link>
    );
  }
  return <span className="text-muted-foreground">—</span>;
};

const ObjectScreen = () => {
  const { object: name } = Route.useParams();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const object = findObject(described.data, name);
  const trail = [{ label: "Objects", link: { to: "/data/objects" } }] as const;

  if (described.isPending) {
    return (
      <>
        <PageHeader title="Loading…" trail={[...trail]} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (!object) {
    return (
      <>
        <PageHeader title={name} trail={[...trail]} />
        <p role="alert">There is nothing called {name} here.</p>
      </>
    );
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title={object.label} trail={[...trail]} />
      <p className="text-sm text-muted-foreground">
        {object.description ??
          `Every ${object.label.toLowerCase()} in the system.`}{" "}
        A choice field takes its options from a choice list.
      </p>
      <ErrorText error={described.error} />
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className={`${cell} font-medium`}>Field</th>
              <th className={`${cell} font-medium`}>Type</th>
              <th className={`${cell} font-medium`}>Options</th>
            </tr>
          </thead>
          <tbody>
            {object.fields.map((field) => (
              <tr key={field.key} className="border-b last:border-0">
                <td className={cell}>
                  <p className="font-medium">{field.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {field.key}
                  </p>
                </td>
                <td className={cell}>
                  {field.type}
                  {field.computed ? ` ${field.computed.type}` : ""}
                  {field.target ? ` → ${field.target}` : ""}
                  {field.computed ? ` · ${field.computed.using}` : ""}
                  {field.display ? (
                    <span className="text-muted-foreground"> display</span>
                  ) : null}
                  {field.required ? (
                    <span className="text-muted-foreground"> required</span>
                  ) : null}
                </td>
                <td className={cell}>
                  <FieldOptions field={field} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_app/data/objects/$object")({
  staticData: { section: "data" },
  component: ObjectScreen,
});
