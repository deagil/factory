// The generated record screen: one for every object, built from
// system.describe. Details are a form for `<object>.update` (read-only
// fields are shown, not edited); hand-written actions are buttons, and so
// is each workflow whose input takes this record (P2.18); the History tab
// reads `record.history` (P1.21).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { useState } from "react";

import { PageHeader, PageSupplement } from "../../components/page-header.tsx";
import { ErrorMessage, RecordForm } from "../../components/record-form.tsx";
import { RecordHistory } from "../../components/record-history.tsx";
import { RecordTitle, WithAvatar } from "../../components/record-title.tsx";
import { WorkflowForm } from "../../components/workflow-form.tsx";
import { describeSystem, objectApi, runAction } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
import {
  customActions,
  recordWorkflows,
  verbOf,
  findAction,
  formFields,
  fromFormValues,
  humanise,
  toFormValues,
} from "../../lib/forms.ts";
import type {
  ActionDescription,
  FormValues,
  WorkflowDescription,
} from "../../lib/forms.ts";
import { plural } from "../../lib/nav.ts";
import {
  readableFields,
  displayValue,
  expandable,
  findObject,
  leadingSrc,
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
  const label = humanise(verbOf(action.name, object.name) ?? action.name);
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
              record={loaded.record}
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

/** A workflow that takes this record: a button that opens its form. */
const WorkflowButton = ({
  workflow,
  recordKey,
  object,
  id,
  description,
}: {
  workflow: WorkflowDescription;
  recordKey: string;
  object: ObjectDescription;
  id: string;
  description: SystemDescription | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const refresh = useRefresh(object.name, id);
  return (
    <>
      <Button
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {workflow.label}
      </Button>
      {open && (
        <PageSupplement>
          <div className="w-full rounded-2xl border p-4">
            <h2 className="mb-1 font-medium">{workflow.label}</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              {workflow.description}
            </p>
            <WorkflowForm
              workflow={workflow}
              description={description}
              fixed={{ [recordKey]: id }}
              onDone={async () => {
                setOpen(false);
                await refresh();
              }}
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
  // An archived record can't be changed until it's restored.
  const updateAction = loaded.record.archivedAt
    ? undefined
    : findAction(description, `${object.name}_update`);
  const fields = updateAction ? formFields(updateAction, object) : [];
  const editable = new Set(fields.map((field) => field.key));
  const save = useMutation({
    mutationFn: (values: FormValues) =>
      objectApi(object.name, object.endpoints).update(
        id,
        Number(loaded.record.version),
        fromFormValues(fields, values, loaded.record)
      ),
    onSuccess: refresh,
  });
  const fixed = readableFields(object).filter(
    (field) => !editable.has(field.key)
  );

  return (
    <div className="flex max-w-lg flex-col gap-4">
      {fixed.map((field) => {
        const text =
          displayValue(field, loaded.record, loaded.related, description) ||
          "—";
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label id={`fixed-${field.key}-label`}>{field.label}</Label>
            <div
              aria-labelledby={`fixed-${field.key}-label`}
              className="flex min-w-0 items-center text-sm"
            >
              <WithAvatar
                src={leadingSrc(
                  field,
                  loaded.record,
                  loaded.related,
                  description,
                  object
                )}
              >
                {text}
              </WithAvatar>
            </div>
          </div>
        );
      })}
      {updateAction && (
        <RecordForm
          // A new version resets the form to what was saved.
          key={String(loaded.record.version)}
          fields={fields}
          initial={toFormValues(fields, loaded.record)}
          record={loaded.record}
          description={description}
          submitLabel="Save"
          pending={save.isPending}
          error={save.error}
          dryRun={save.data?.dryRun ? save.data : undefined}
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
      objectApi(name, object?.endpoints).get<Loaded>(id, {
        archived: "include",
        expand: expandable(object?.fields ?? []),
      }),
    enabled: object !== undefined,
  });
  const refresh = useRefresh(name, id);
  // Archiving stays on the record, so Restore is right there to undo it.
  const archive = useMutation({
    mutationFn: () => objectApi(name, object?.endpoints).archive(id),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: () => objectApi(name, object?.endpoints).restore(id),
    onSuccess: refresh,
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
  const archivedAt = record.record.archivedAt as string | null;
  const canArchive =
    !archivedAt && findAction(described.data, `${name}_archive`);
  const canRestore = findAction(described.data, `${name}_restore`);
  const workflows = archivedAt ? [] : recordWorkflows(described.data, name);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={<RecordTitle record={record.record} object={object} />}
        trail={[
          { label: "Objects", link: { to: "/data/objects" } },
          {
            label: plural(object.label),
            link: { to: "/o/$object", params: { object: name } },
          },
        ]}
        actions={
          <>
            {(archivedAt ? [] : customActions(described.data, name))
              // A workflow that does the same job replaces its button.
              .filter(
                (action) =>
                  !workflows.some(
                    ({ workflow }) =>
                      workflow.label ===
                      humanise(verbOf(action.name, name) ?? action.name)
                  )
              )
              .map((action) => (
                <ActionButton
                  key={action.name}
                  action={action}
                  object={object}
                  loaded={record}
                  description={described.data}
                />
              ))}
            {workflows.map(({ workflow, recordKey }) => (
              <WorkflowButton
                key={workflow.key}
                workflow={workflow}
                recordKey={recordKey}
                object={object}
                id={String(record.record.id)}
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
      {archivedAt ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span>
            This {object.label.toLowerCase()} was archived on{" "}
            {new Date(archivedAt).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            . It is hidden from lists and can&rsquo;t be changed.
          </span>
          {canRestore && (
            <Button
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
            >
              Restore
            </Button>
          )}
        </div>
      ) : null}
      <ErrorMessage error={archive.error ?? restore.error} />
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
  staticData: { section: "data" },
  validateSearch: (search: Record<string, unknown>): RecordSearch => ({
    tab: search.tab === "history" ? "history" : undefined,
  }),
  component: RecordScreen,
});
