// One choice list (P2.10c): the fields that use it, and its options to edit
// into your working draft (decision 0044). Rows your draft changes are
// marked, and the live version is a toggle away; the header pill publishes.
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useState } from "react";

import { ErrorText } from "../../components/activity.tsx";
import {
  ListUses,
  LiveOptions,
  useChoiceLists,
} from "../../components/choice-lists.tsx";
import { ChoiceListEditor } from "../../components/config-editors.tsx";
import type { Checked } from "../../components/config-files.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { useRefreshDrafts } from "../../components/working-draft.tsx";
import { runAction } from "../../lib/api.ts";
import { canEditConfig, listLabel, optionsOf } from "../../lib/choice-lists.ts";

const trail = [
  { label: "Choices", link: { to: "/settings/choices" } },
] as const;

const ChoiceListScreen = () => {
  const { list } = Route.useParams();
  const { described, files, lists, waiting } = useChoiceLists();
  const refresh = useRefreshDrafts();
  const [showLive, setShowLive] = useState(false);
  const save = useMutation({
    mutationFn: (input: { path: string; value: Record<string, unknown> }) =>
      runAction<Checked>("draft.save", input),
    onSuccess: refresh,
  });
  const title = listLabel(list);
  if (described.data && !canEditConfig(described.data)) {
    return (
      <>
        <PageHeader title={title} trail={[...trail]} />
        <p className="text-sm text-muted-foreground">
          Your roles don’t let you change config.
        </p>
      </>
    );
  }
  const found = lists.find((each) => each.file.key === list);
  if (!found) {
    return (
      <>
        <PageHeader title={title} trail={[...trail]} />
        <ErrorText error={files.error} />
        {files.data ? (
          <p className="text-sm text-muted-foreground">
            There’s no choice list called {list}.
          </p>
        ) : null}
      </>
    );
  }
  const { file, edited, live } = found;
  const viewingLive = showLive && edited;
  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <PageHeader title={title} trail={[...trail]} />
      <p className="text-sm">
        <span className="text-muted-foreground">Used by </span>
        <ListUses description={described.data} list={list} />
      </p>
      {edited ? (
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="flex gap-1">
            <legend className="sr-only">Version</legend>
            <Button
              size="sm"
              variant={viewingLive ? "outline" : "secondary"}
              aria-pressed={!viewingLive}
              onClick={() => setShowLive(false)}
            >
              Your draft
            </Button>
            <Button
              size="sm"
              variant={viewingLive ? "secondary" : "outline"}
              aria-pressed={viewingLive}
              onClick={() => setShowLive(true)}
            >
              Live
            </Button>
          </fieldset>
          <span className="text-sm text-muted-foreground">
            Marked rows differ from the live list until you publish.
          </span>
        </div>
      ) : null}
      {waiting && !viewingLive ? (
        <p className="rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Your edits are waiting for approval. Saving another change withdraws
          the request, and you’ll need to ask again.
        </p>
      ) : null}
      <ErrorText error={save.error} />
      {viewingLive ? (
        <LiveOptions list={list} value={live} description={described.data} />
      ) : (
        <ChoiceListEditor
          // A save brings new content, which starts the editor afresh.
          key={file.content}
          value={(file.value ?? {}) as Record<string, unknown>}
          description={described.data}
          live={optionsOf(live)}
          saving={save.isPending}
          saveLabel={waiting ? "Save and withdraw request" : undefined}
          onSave={(value) => save.mutate({ path: file.path, value })}
        />
      )}
    </div>
  );
};

export const Route = createFileRoute("/_app/settings/choices/$list")({
  staticData: { section: "data" },
  component: ChoiceListScreen,
});
