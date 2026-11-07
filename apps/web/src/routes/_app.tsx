import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";

import { AppShell } from "../components/app-shell.tsx";
import { describeSystem } from "../lib/api.ts";
import { sessionQuery, signOut } from "../lib/auth.ts";
import { navFrom } from "../lib/nav.ts";

/** The signed-in app: navigation built from system.describe. */
const Shell = () => {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const described = useQuery({
    queryKey: ["system.describe"],
    queryFn: describeSystem,
  });

  const leave = async () => {
    await signOut();
    queryClient.clear();
    await navigate({ to: "/sign-in" });
  };

  return (
    <AppShell
      email={session.user.email}
      onSignOut={leave}
      items={described.data ? navFrom(described.data) : []}
      navPending={described.isPending}
      navError={described.isError ? described.error.message : null}
    >
      <Outlet />
    </AppShell>
  );
};

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) {
      throw redirect({ to: "/sign-in" });
    }
    return { session };
  },
  component: Shell,
});
