import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "../../components/page-header.tsx";

const Home = () => {
  const { session } = Route.useRouteContext();
  return (
    <div className="flex flex-col gap-2">
      <PageHeader title={`Hello, ${session.user.name}`} />
      <p className="text-sm text-muted-foreground">
        Open Data to see the records this system keeps.
      </p>
    </div>
  );
};

export const Route = createFileRoute("/_app/")({ component: Home });
