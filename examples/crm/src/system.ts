// The example CRM: organisations and contacts, with one hand-written action.
import path from "node:path";

import { defineSystem } from "@workspace/server";

import { moveToOrganisation } from "./move-to-organisation.ts";
import { contact, organisation } from "./objects.ts";
import { configDir, roles } from "./roles.ts";

export const crm = defineSystem({
  name: "example-crm",
  objects: [organisation, contact],
  actions: [moveToOrganisation],
  roles,
  migrations: path.resolve(import.meta.dirname, "../migrations"),
  config: configDir,
});

export default crm;
