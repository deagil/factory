// Access → Agents: every person's agents (P1b.06). People make their own
// agents from My agents.
import { createFileRoute } from "@tanstack/react-router";

import { ActorListScreen } from "../../components/access.tsx";

const AgentsScreen = () => (
  <ActorListScreen
    kind="agent"
    showPerson="owner"
    create={null}
    title="Agents"
  />
);

export const Route = createFileRoute("/_app/access/agents")({
  staticData: { section: "access" },
  component: AgentsScreen,
});
