import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";

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
    <div className="flex min-h-svh">
      <aside className="flex w-56 shrink-0 flex-col gap-4 border-r p-4">
        <Link to="/" className="px-2 font-medium">
          Factory
        </Link>
        <nav aria-label="Objects" className="flex flex-col gap-1">
          {described.isPending && (
            <p className="px-2 text-sm text-muted-foreground">Loading…</p>
          )}
          {described.isError && (
            <p role="alert" className="px-2 text-sm text-destructive">
              {`Couldn't load the system: ${described.error.message}`}
            </p>
          )}
          {described.data &&
            navFrom(described.data).map((item) => (
              <Link
                key={item.object}
                to="/o/$object"
                params={{ object: item.object }}
                className="rounded-xl px-2 py-1.5 text-sm hover:bg-muted"
                activeProps={{ className: "bg-muted font-medium" }}
              >
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 px-2 text-sm">
          <span className="truncate text-muted-foreground">
            {session.user.email}
          </span>
          <Button variant="outline" size="sm" onClick={leave}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
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
