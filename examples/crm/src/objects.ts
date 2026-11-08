import { defineObject, f } from "@workspace/objects/define";
// The CRM's objects. drizzle-kit loads this file on its own, so it exports
// the tables as well as the objects. Field imports stay on
// `@workspace/objects/define`.
import { index } from "drizzle-orm/pg-core";

export const organisation = defineObject({
  name: "organisation",
  description: "A company or other body the business works with.",
  fields: {
    name: f.text({ required: true, maxLength: 200 }),
    website: f.text(),
    employees: f.number({ integer: true, min: 0 }),
    // Staff own the industries: code acts on none of them (P2.06).
    industry: f.choice("industries", { control: "custom" }),
    owner: f.ref("actor", { label: "Account owner" }),
  },
  customFields: true,
  list: ["name", "website", "owner"],
});

export const contact = defineObject({
  name: "contact",
  description: "A person at an organisation.",
  fields: {
    firstName: f.text({ required: true, maxLength: 100 }),
    lastName: f.text({ maxLength: 100 }),
    email: f.text({ maxLength: 320 }),
    organisation: f.ref("organisation", { required: true }),
    active: f.boolean({ required: true }),
  },
  customFields: true,
  list: ["firstName", "lastName", "email", "organisation"],
  // contact.moveToOrganisation owns the organisation field.
  actions: { update: { readOnly: ["organisation"] } },
});

export const deal = defineObject({
  name: "deal",
  description: "A sale in progress with an organisation.",
  fields: {
    name: f.text({ required: true, maxLength: 200 }),
    organisation: f.ref("organisation", { required: true }),
    value: f.money(),
    owner: f.ref("actor"),
    // Staff add stages; code acts only on the category (P2.07).
    stage: f.choice("deal-stages", {
      control: "mapped",
      categories: ["open", "won", "lost"],
      required: true,
    }),
  },
  list: ["name", "organisation", "value", "stage", "owner"],
  // deal.moveStage owns stage.
  actions: { update: { readOnly: ["stage"] } },
  drizzle: (table) => [index("deals_stage_idx").on(table.stage)],
});

export const organisations = organisation.table;
export const contacts = contact.table;
export const deals = deal.table;
