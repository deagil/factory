import { createFileRoute } from "@tanstack/react-router";

/** An object's screen; P1.20 builds the list from system.describe. */
const ObjectScreen = () => {
  const { object } = Route.useParams();
  return <h1 className="text-xl font-medium">{object}</h1>;
};

export const Route = createFileRoute("/_app/o/$object")({
  component: ObjectScreen,
});
