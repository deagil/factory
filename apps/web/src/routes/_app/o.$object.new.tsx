// The generated create screen: a form for `<object>.create` (P1.21).
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { PageHeader } from "../../components/page-header.tsx";
import { RecordForm } from "../../components/record-form.tsx";
import { describeSystem, runAction } from "../../lib/api.ts";
import {
  findAction,
  formFields,
  fromFormValues,
  toFormValues,
} from "../../lib/forms.ts";
import type { FormValues } from "../../lib/forms.ts";
import { plural } from "../../lib/nav.ts";
import { findObject } from "../../lib/records.ts";

const CreateScreen = () => {
  const { object: name } = Route.useParams();
  const navigate = useNavigate();
  // One key per form, so a double submit makes one record.
  const retryKey = useMemo(() => crypto.randomUUID(), []);
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const object = findObject(described.data, name);
  const action = findAction(described.data, `${name}.create`);
  const fields = object && action ? formFields(action, object) : [];
  const create = useMutation({
    mutationFn: (values: FormValues) =>
      runAction<{ record: { id: string } }>(
        `${name}.create`,
        fromFormValues(fields, values),
        { retryKey }
      ),
    onSuccess: ({ output, dryRun }) =>
      // A dry run made nothing to go to; the form shows its result.
      dryRun
        ? undefined
        : navigate({
            to: "/o/$object/$id",
            params: { object: name, id: output.record.id },
          }),
  });

  if (described.isPending) {
    return (
      <>
        <PageHeader title="Loading…" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (!(object && action)) {
    return (
      <>
        <PageHeader title={name} />
        <p role="alert">There is no way to create {name} records here.</p>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`New ${object.label.toLowerCase()}`}
        trail={[
          {
            label: plural(object.label),
            link: { to: "/o/$object", params: { object: name } },
          },
        ]}
      />
      <RecordForm
        fields={fields}
        initial={toFormValues(fields)}
        description={described.data}
        submitLabel="Create"
        pending={create.isPending}
        error={create.error}
        dryRun={create.data?.dryRun ? create.data : undefined}
        onSubmit={(values) => create.mutate(values)}
      />
    </div>
  );
};

export const Route = createFileRoute("/_app/o/$object/new")({
  staticData: { section: "data" },
  component: CreateScreen,
});
