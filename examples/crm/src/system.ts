// The example CRM: organisations, contacts and deals.
import path from "node:path";

import { defineSystem } from "@workspace/server";

import { createDeal } from "./create-deal.ts";
import { moveStage } from "./move-stage.ts";
import { moveToOrganisation } from "./move-to-organisation.ts";
import { contact, deal, organisation, task } from "./objects.ts";

export const crm = defineSystem({
  name: "example-crm",
  objects: [organisation, contact, deal, task],
  actions: [moveToOrganisation, createDeal, moveStage],
  migrations: path.resolve(import.meta.dirname, "../migrations"),
  // Roles and, later, the rest of the CRM's config (decision 0037).
  config: path.resolve(import.meta.dirname, "../config"),
});

export default crm;
