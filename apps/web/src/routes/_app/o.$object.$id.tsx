// The generated record screen: one for every object, built from
// system.describe. Details are a form for `<object>.update` (read-only
// fields are shown, not edited); hand-written actions are buttons; the
// History tab reads `record.history` (P1.21).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { useState } from "react";

import { PageHeader, PageSupplement } from "../../components/page-header.tsx";
import { ErrorMessage, RecordForm } from "../../components/record-form.tsx";
import { RecordHistory } from "../../components/record-history.tsx";
import { describeSystem, runAction, runQuery } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
import {
  customActions,
  findAction,
  formFields,
  fromFormValues,
  humanise,
  toFormValues,
} from "../../lib/forms.ts";
import type { ActionDescription, FormValues } from "../../lib/forms.ts";
import {
  displayValue,
  expandable,
  findObject,
  titleOf,
} from "../../lib/records.ts";
import type { ObjectDescription, Related } from "../../lib/records.ts";

interface RecordSearch {
  tab?: "details" | "history";
}

interface Loaded {
  record: Record<string, unknown>;
  related: Related;
}

/** Refetches everything that shows this record after a change. */
const useRefresh = (name: string, id: string) => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["record", name, id] }),
      queryClient.invalidateQueries({ queryKey: ["history", name, id] }),
      queryClient.invalidateQueries({ queryKey: ["list", name] }),
    ]);
};

/** A hand-written action: a button that opens a form for its other inputs. */
const ActionButton = ({
  action,
  object,
  loaded,
  description,
}: {
  action: ActionDescription;
  object: ObjectDescription;
  loaded: Loaded;
  description: SystemDescription | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const id = String(loaded.record.id);
  const refresh = useRefresh(object.name, id);
  const fields = formFields(action, object);
  const run = useMutation({
    mutationFn: (values: FormValues) =>
      runAction(action.name, {
        ...fromFormValues(fields, values),
        id,
        version: loaded.record.version,
      }),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
  });
  const label = humanise(action.name.split(".")[1] ?? action.name);
  return (
    <>
      <Button
        variant="outline"
        aria-expanded={fields.length > 0 ? open : undefined}
        onClick={() =>
          fields.length > 0 ? setOpen((value) => !value) : run.mutate({})
        }
      >
        {label}
      </Button>
      {open && (
        <PageSupplement>
          <div className="w-full rounded-2xl border p-4">
            <h2 className="mb-1 font-medium">{label}</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {action.description}
            </p>
            <RecordForm
              fields={fields}
              initial={toFormValues(fields, loaded.record)}
              description={description}
              submitLabel={label}
              pending={run.isPending}
              error={run.error}
              onSubmit={(values) => run.mutate(values)}
              onCancel={() => setOpen(false)}
            />
          </div>
        </PageSupplement>
      )}
    </>
  );
};

const Details = ({
  object,
  loaded,
  description,
}: {
  object: ObjectDescription;
  loaded: Loaded;
  description: SystemDescription | undefined;
}) => {
  const id = String(loaded.record.id);
  const refresh = useRefresh(object.name, id);
  const updateAction = findAction(description, `${object.name}.update`);
  const fields = updateAction ? formFields(updateAction, object) : [];
  const editable = new Set(fields.map((field) => field.key));
  const save = useMutation({
    mutationFn: (values: FormValues) =>
      runAction(`${object.name}.update`, {
        ...fromFormValues(fields, values, loaded.record),
        id,
        version: loaded.record.version,
      }),
    onSuccess: refresh,
  });
  const fixed = object.fields.filter((field) => !editable.has(field.key));

  return (
    <div className="flex flex-col gap-6">
      {fixed.length > 0 && (
        <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {fixed.map((field) => (
            <div key={field.key} className="contents">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd>
                {displayValue(
                  field,
                  loaded.record,
                  loaded.related,
                  description
                ) || "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {updateAction && (
        <RecordForm
          // A new version resets the form to what was saved.
          key={String(loaded.record.version)}
          fields={fields}
          initial={toFormValues(fields, loaded.record)}
          description={description}
          submitLabel="Save"
          pending={save.isPending}
          error={save.error}
          onSubmit={(values) => save.mutate(values)}
        />
      )}
    </div>
  );
};

const tabs = [
  { key: "details", label: "Details" },
  { key: "history", label: "History" },
] as const;

const RecordScreen = () => {
  const { object: name, id } = Route.useParams();
  const { tab = "details" } = Route.useSearch();
  const navigate = useNavigate();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const object = findObject(described.data, name);
  const loaded = useQuery({
    queryKey: ["record", name, id],
    queryFn: () =>
      runQuery<Loaded>(`${name}.get`, {
        id,
        expand: expandable(object?.fields ?? []),
      }),
    enabled: object !== undefined,
  });
  const archive = useMutation({
    mutationFn: () => runAction(`${name}.archive`, { id }),
    onSuccess: () => navigate({ to: "/o/$object", params: { object: name } }),
  });

  if (described.isPending || (object && loaded.isPending)) {
    return (
      <>
        <PageHeader title="Loading…" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }
  if (!object) {
    return (
      <>
        <PageHeader title={name} />
        <p role="alert">There is nothing called {name} here.</p>
      </>
    );
  }
  if (loaded.isError) {
    return (
      <>
        <PageHeader title={object.label} />
        <p role="alert" className="text-sm text-destructive">
          {loaded.error.message}
        </p>
      </>
    );
  }
  if (!loaded.data) {
    return (
      <>
        <PageHeader title={object.label} />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  const record = loaded.data;
  const canArchive = findAction(described.data, `${name}.archive`);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={titleOf(record.record, object)}
        leading={
          <Link
            to="/o/$object"
            params={{ object: name }}
            className="shrink-0 text-sm text-muted-foreground hover:underline"
          >
            {`← ${object.label}s`}
          </Link>
        }
        actions={
          <>
            {customActions(described.data, name).map((action) => (
              <ActionButton
                key={action.name}
                action={action}
                object={object}
                loaded={record}
                description={described.data}
              />
            ))}
            {canArchive && (
              <Button
                variant="destructive"
                disabled={archive.isPending}
                onClick={() => archive.mutate()}
              >
                Archive
              </Button>
            )}
          </>
        }
      />
      <ErrorMessage error={archive.error} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value !== "details" && value !== "history") {
            return;
          }
          void navigate({
            to: "/o/$object/$id",
            params: { object: name, id },
            search: { tab: value === "history" ? "history" : undefined },
          });
        }}
      >
        <TabsList>
          {tabs.map((each) => (
            <TabsTrigger key={each.key} value={each.key}>
              {each.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "history" ? (
        <RecordHistory object={object} id={id} description={described.data} />
      ) : (
        <Details object={object} loaded={record} description={described.data} />
      )}
    </div>
  );
};

export const Route = createFileRoute("/_app/o/$object/$id")({
  validateSearch: (search: Record<string, unknown>): RecordSearch => ({
    tab: search.tab === "history" ? "history" : undefined,
  }),
  component: RecordScreen,
});
