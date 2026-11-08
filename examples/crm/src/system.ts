// The example CRM: organisations and contacts, with one hand-written action.
import path from "node:path";

import { defineSystem } from "@workspace/server";

import { moveToOrganisation } from "./move-to-organisation.ts";
import { contact, organisation } from "./objects.ts";

export const crm = defineSystem({
  name: "example-crm",
  objects: [organisation, contact],
  actions: [moveToOrganisation],
  migrations: path.resolve(import.meta.dirname, "../migrations"),
  // Roles and, later, the rest of the CRM's config (decision 0037).
  config: path.resolve(import.meta.dirname, "../config"),
});

export default crm;
