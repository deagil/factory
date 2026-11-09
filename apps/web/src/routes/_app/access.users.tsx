// Access → Users: the people who sign in, with Invite.
import { createFileRoute } from "@tanstack/react-router";

import { ActorListScreen } from "../../components/access.tsx";

const UsersScreen = () => (
  <ActorListScreen
    kind="staff"
    showPerson="email"
    create={{ action: "user.invite", label: "Invite person" }}
    title="Users"
  />
);

export const Route = createFileRoute("/_app/access/users")({
  staticData: { section: "access" },
  component: UsersScreen,
});
