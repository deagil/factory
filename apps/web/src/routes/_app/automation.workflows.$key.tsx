// One workflow: its name, whether it is code or config, the caller's draft
// beside live, and the file. The version, the selected step and the tab
// stay in the URL.
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import { useState } from "react";
import type { ReactNode } from "react";

import { useRoles } from "../../components/access.tsx";
import { ErrorText } from "../../components/activity.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { WorkflowForm } from "../../components/workflow-form.tsx";
import { WorkflowTab } from "../../components/workflow-view.tsx";
import { useWorkingDraft } from "../../components/working-draft.tsx";
import { describeSystem, readWorkflow } from "../../lib/api.ts";
import type { SystemDescription } from "../../lib/api.ts";
import type { WorkflowDescription } from "../../lib/forms.ts";
import {
  canReadWorkflows,
  draftChangesWorkflow,
  mayReadDrafts,
  mayReadRoles,
  presentWorkflow,
  readsAreReady,
  showsReadOnly,
  sourceLabel,
  workflowGetEnabled,
  workflowGetKey,
  workflowListKey,
  workflowMissing,
  workflowPageSearch,
  workflowReadInput,
} from "../../lib/workflows.ts";
import type {
  WorkflowListItem,
  WorkflowView,
  WorkflowWhy,
} from "../../lib/workflows.ts";

const trail = [
  { label: "Workflows", link: { to: "/automation/workflows" } },
] as const;

const Mark = ({ children }: { children: string }) => (
  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
    {children}
  </span>
);

const fetchList = async (draftId: string | undefined) => {
  const result = await readWorkflow<{ workflows: WorkflowListItem[] }>(
    workflowListKey,
    draftId ? { draft_id: draftId } : {}
  );
  return result.output;
};

const fetchOne = async (input: {
  key: string;
  draft_id?: string;
  sha?: string;
}) => {
  const result = await readWorkflow<WorkflowView>(workflowGetKey, input);
  return result.output;
};

const useWorkflowData = (key: string, version: string | undefined) => {
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });
  const draft = useWorkingDraft();
  const readsDrafts = mayReadDrafts(described.data?.queries);
  const ready = readsAreReady(described.isSuccess, readsDrafts, draft);
  const canRead = canReadWorkflows(described.data?.workflows);
  const listed = useQuery({
    queryKey: ["workflow_list", draft?.id ?? null],
    queryFn: () => fetchList(draft?.id),
    enabled: canRead && ready,
  });
  const item = listed.data?.workflows.find((workflow) => workflow.key === key);
  const missing = workflowMissing(item?.change, version);
  const readInput = workflowReadInput(key, version, draft?.id);
  const got = useQuery({
    queryKey: ["workflow_get", readInput],
    queryFn: () => fetchOne(readInput),
    enabled: workflowGetEnabled({
      described: described.isSuccess,
      ready,
      missing,
      canRead,
      listFetched: listed.isFetched,
    }),
    retry: false,
  });
  return { described, listed, got, item, missing };
};

const VersionToggle = ({
  version,
  onDraft,
  onLive,
}: {
  version: string | undefined;
  onDraft: () => void;
  onLive: () => void;
}) => (
  <fieldset className="flex gap-1">
    <legend className="sr-only">Version</legend>
    <Button
      size="sm"
      variant={version === "draft" ? "secondary" : "outline"}
      aria-pressed={version === "draft"}
      onClick={onDraft}
    >
      Your draft
    </Button>
    <Button
      size="sm"
      variant={version === undefined ? "secondary" : "outline"}
      aria-pressed={version === undefined}
      onClick={onLive}
    >
      Live
    </Button>
  </fieldset>
);

const WorkflowTabs = ({
  tab,
  content,
  onTab,
  children,
}: {
  tab: "workflow" | "file";
  content: string | null;
  onTab: (tab: "file" | undefined) => void;
  children: ReactNode;
}) => (
  <Tabs
    value={tab}
    onValueChange={(value) => {
      if (value === "workflow" || value === "file") {
        onTab(value === "file" ? "file" : undefined);
      }
    }}
  >
    <TabsList>
      <TabsTrigger value="workflow">Workflow</TabsTrigger>
      <TabsTrigger value="file">File</TabsTrigger>
    </TabsList>
    <TabsContent value="workflow" className="flex flex-col gap-4">
      {children}
    </TabsContent>
    <TabsContent value="file">
      <FileText content={content} />
    </TabsContent>
  </Tabs>
);

const FileText = ({ content }: { content: string | null }) =>
  content === null ? null : (
    <pre className="overflow-x-auto rounded-2xl bg-muted/50 p-3 font-mono text-xs/relaxed whitespace-pre-wrap">
      {content}
    </pre>
  );

const RunButton = ({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) => (
  <Button variant="outline" aria-expanded={open} onClick={onToggle}>
    {open ? "Close" : "Run"}
  </Button>
);

const Marks = ({
  source,
  readOnly,
  why,
}: {
  source: "code" | "config" | undefined;
  readOnly: boolean;
  why: WorkflowWhy | null;
}) => (
  <>
    <SourceMark source={source} />
    <ReadOnlyMark show={showsReadOnly(readOnly, why)} />
  </>
);

const SourceMark = ({ source }: { source: "code" | "config" | undefined }) =>
  source ? <Mark>{sourceLabel(source)}</Mark> : null;

const ReadOnlyMark = ({ show }: { show: boolean }) =>
  show ? <Mark>Read only</Mark> : null;

const Notice = ({ text }: { text: string | null }) =>
  text ? <p className="text-sm">{text}</p> : null;

const RunPanel = ({
  open,
  workflow,
  description,
  onClose,
}: {
  open: boolean;
  workflow: WorkflowDescription | undefined;
  description: SystemDescription | undefined;
  onClose: () => void;
}) => {
  if (!open || !workflow) {
    return null;
  }
  return (
    <WorkflowForm
      workflow={workflow}
      description={description}
      onCancel={onClose}
    />
  );
};

const callableOf = (description: SystemDescription | undefined, key: string) =>
  description?.workflows.find((workflow) => workflow.key === key);

const WorkflowScreen = () => {
  const { key } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [running, setRunning] = useState(false);
  const { described, listed, got, item, missing } = useWorkflowData(
    key,
    search.v
  );
  const present = presentWorkflow({
    key,
    search,
    item,
    view: got.data,
    missing,
  });
  const callable = callableOf(described.data, key);
  const roles = useRoles(mayReadRoles(described.data?.queries));
  const setSearch = (next: { tab?: "file"; step?: string; v?: string }) => {
    void navigate({ search: (previous) => ({ ...previous, ...next }) });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title={present.label}
        trail={[...trail]}
        actions={
          <RunAction
            callable={callable}
            running={running}
            setRunning={setRunning}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{key}</span>
        <Marks
          source={present.source}
          readOnly={present.readOnly}
          why={present.why}
        />
      </div>
      <DraftToggle
        change={item?.change}
        version={search.v}
        onDraft={() => setSearch({ v: "draft" })}
        onLive={() => setSearch({ v: undefined })}
      />
      <Notice text={present.reason} />
      <RunPanel
        open={running}
        workflow={callable}
        description={described.data}
        onClose={() => setRunning(false)}
      />
      <ErrorText error={listed.error ?? got.error} />
      <Notice text={present.missingText} />
      <Loading show={got.isLoading} />
      <WorkflowTabs
        tab={present.tab}
        content={present.content}
        onTab={(tab) => setSearch({ tab })}
      >
        <WorkflowTab
          workflow={key}
          description={present.description}
          starts={present.starts}
          startsWhen={present.startsWhen}
          facts={present.facts}
          tree={present.tree}
          check={got.data?.check}
          roles={roles.data}
          selected={search.step}
          onSelect={(step) => setSearch({ step })}
        />
      </WorkflowTabs>
    </div>
  );
};

const RunAction = ({
  callable,
  running,
  setRunning,
}: {
  callable: WorkflowDescription | undefined;
  running: boolean;
  setRunning: (next: boolean) => void;
}) =>
  callable ? (
    <RunButton open={running} onToggle={() => setRunning(!running)} />
  ) : null;

const DraftToggle = ({
  change,
  version,
  onDraft,
  onLive,
}: {
  change: WorkflowListItem["change"] | undefined;
  version: string | undefined;
  onDraft: () => void;
  onLive: () => void;
}) => {
  if (!draftChangesWorkflow(change)) {
    return null;
  }
  return <VersionToggle version={version} onDraft={onDraft} onLive={onLive} />;
};

const Loading = ({ show }: { show: boolean }) =>
  show ? <p className="text-sm text-muted-foreground">Loading…</p> : null;

export const Route = createFileRoute("/_app/automation/workflows/$key")({
  staticData: { section: "automation" },
  validateSearch: workflowPageSearch,
  component: WorkflowScreen,
});
