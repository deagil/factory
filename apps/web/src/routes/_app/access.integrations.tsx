// Access → Integrations: other systems with their own keys and roles
//.
import { createFileRoute } from "@tanstack/react-router";

import { ActorListScreen } from "../../components/access.tsx";

const IntegrationsScreen = () => (
  <ActorListScreen
    kind="integration"
    showPerson={false}
    create={{ action: "actor.createIntegration", label: "New integration" }}
    title="Integrations"
  />
);

export const Route = createFileRoute("/_app/access/integrations")({
  staticData: { section: "access" },
  component: IntegrationsScreen,
});
