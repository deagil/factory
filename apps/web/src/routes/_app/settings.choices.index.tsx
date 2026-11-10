// Settings → Choice lists (P2.10c): every list, the fields that use it and
// how many live options it has, marked when your working draft changes it.
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { ErrorText } from "../../components/activity.tsx";
import { ListUses, useChoiceLists } from "../../components/choice-lists.tsx";
import { OptionBadge } from "../../components/config-editors.tsx";
import { OpenRow } from "../../components/open-row.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { canEditConfig, listLabel, optionsOf } from "../../lib/choice-lists.ts";

const cell = "px-3 py-2 align-middle";

const ChoiceListsScreen = () => {
  const navigate = useNavigate();
  const { described, files, lists } = useChoiceLists();
  if (described.data && !canEditConfig(described.data)) {
    return (
      <>
        <PageHeader title="Choices" />
        <p className="text-sm text-muted-foreground">
          Your roles don’t let you change config.
        </p>
      </>
    );
  }
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title="Choices" />
      <p className="text-sm text-muted-foreground">
        The options people pick from in choice fields. Edits go into your own
        draft and aren’t live until you publish them from the header.
      </p>
      <ErrorText error={files.error} />
      {files.data && lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">No choice lists.</p>
      ) : null}
      {lists.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className={`${cell} font-medium`}>List</th>
                <th className={`${cell} font-medium`}>Used by</th>
                <th className={`${cell} font-medium`}>Live options</th>
              </tr>
            </thead>
            <tbody>
              {lists.map(({ file, edited, live }) => (
                <OpenRow
                  key={file.path}
                  onOpen={() =>
                    navigate({
                      to: "/settings/choices/$list",
                      params: { list: file.key },
                    })
                  }
                >
                  <td className={cell}>
                    <span className="flex items-center gap-2">
                      <Link
                        to="/settings/choices/$list"
                        params={{ list: file.key }}
                        className="font-medium hover:underline"
                      >
                        {listLabel(file.key)}
                      </Link>
                      {edited ? <OptionBadge mark="changed" /> : null}
                    </span>
                  </td>
                  <td className={cell}>
                    <ListUses description={described.data} list={file.key} />
                  </td>
                  <td className={cell}>
                    {
                      optionsOf(live).filter((option) => !option.archived)
                        .length
                    }
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

export const Route = createFileRoute("/_app/settings/choices/")({
  staticData: { section: "data" },
  component: ChoiceListsScreen,
});
