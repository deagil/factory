import { createFileRoute } from "@tanstack/react-router";

/** A record's screen; P1.21 builds it from system.describe. */
const RecordScreen = () => {
  const { object, id } = Route.useParams();
  return (
    <h1 className="text-xl font-medium">
      {object} {id}
    </h1>
  );
};

export const Route = createFileRoute("/_app/o/$object/$id")({
  component: RecordScreen,
});
