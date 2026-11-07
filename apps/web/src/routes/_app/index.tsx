import { createFileRoute } from "@tanstack/react-router";

const Home = () => {
  const { session } = Route.useRouteContext();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-medium">Hello, {session.user.name}</h1>
      <p className="text-sm text-muted-foreground">
        Pick something from the menu.
      </p>
    </div>
  );
};

export const Route = createFileRoute("/_app/")({ component: Home });
