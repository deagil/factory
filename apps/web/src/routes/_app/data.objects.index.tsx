// Data → Objects: the kinds of record the caller can see, each opening
// that object's list.
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { ErrorText } from "../../components/activity.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { describeSystem } from "../../lib/api.ts";
import { plural } from "../../lib/nav.ts";

const cell = "px-3 py-2 align-middle";

const ObjectsScreen = () => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const navigate = useNavigate();
  const objects = [...(described.data?.objects ?? [])].toSorted((a, b) =>
    a.label.localeCompare(b.label)
  );
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Objects" />
      <p className="text-sm text-muted-foreground">
        The kinds of record this system keeps. Open a row to see its records.
        The name opens its fields.
      </p>
      <ErrorText error={described.error} />
      {described.isSuccess && objects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None of your roles lets you see an object.
        </p>
      ) : null}
      {objects.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className={`${cell} font-medium`}>Object</th>
                <th className={`${cell} font-medium`}>About</th>
                <th className={`${cell} font-medium`}>Fields</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((object) => (
                <OpenRow
                  key={object.name}
                  onOpen={() =>
                    navigate({
                      to: "/o/$object",
                      params: { object: object.name },
                    })
                  }
                >
                  <td className={cell}>
                    <Link
                      to="/data/objects/$object"
                      params={{ object: object.name }}
                      className="font-medium hover:underline"
                    >
                      {plural(object.label)}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">
                      {object.name}
                    </p>
                  </td>
                  <td className={`${cell} text-muted-foreground`}>
                    {object.description ??
                      `Every ${object.label.toLowerCase()} in the system.`}
                  </td>
                  <td className={`${cell} tabular-nums`}>
                    {object.fields.length}
                  </td>
                </OpenRow>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

export const Route = createFileRoute("/_app/data/objects/")({
  staticData: { section: "data" },
  component: ObjectsScreen,
});
