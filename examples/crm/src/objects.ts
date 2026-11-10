// The CRM's objects. drizzle-kit loads this file on its own, so it exports
// the tables as well as the objects, and imports only from
// `@workspace/objects/define` and the CRM's choice lists.

import { defineObject, f } from "@workspace/objects/define";

import { dealStages, industries } from "./choices.ts";

export const organisation = defineObject({
  name: "organisation",
  description: "A company or other body the business works with.",
  fields: {
    name: f.text({ required: true, maxLength: 200 }),
    website: f.url(),
    employees: f.number({ integer: true, min: 0 }),
    industry: f.choice(industries),
    owner: f.ref("actor", { label: "Account owner" }),
  },
  customFields: true,
  list: ["name", "website", "owner"],
  owner: "owner",
});

export const contact = defineObject({
  name: "contact",
  description: "A person at an organisation.",
  fields: {
    firstName: f.text({ required: true, maxLength: 100 }),
    lastName: f.text({ maxLength: 100 }),
    fullName: f.computed({
      label: "Full name",
      type: "text",
      using: "concat",
      fields: ["firstName", "lastName"],
      displayField: true,
    }),
    email: f.email(),
    organisation: f.ref("organisation", { required: true }),
    active: f.boolean({ required: true }),
  },
  customFields: true,
  list: ["fullName", "firstName", "lastName", "email", "organisation"],
});

export const deal = defineObject({
  name: "deal",
  description: "A sale in progress with an organisation.",
  fields: {
    name: f.text({ required: true, maxLength: 200 }),
    organisation: f.ref("organisation", { required: true }),
    value: f.money(),
    owner: f.ref("actor"),
    stage: f.choice(dealStages, { required: true }),
  },
  list: ["name", "organisation", "value", "stage", "owner"],
  owner: "owner",
  // deal_create starts a deal in an open stage. Roles get no write on
  // stage, so deal.moveStage moves it after (config/roles/).
  actions: { create: "deal_create" },
});

/**
 * Something to do about a deal. Workflows add one when a deal is won or
 * changes owner (config/workflows/, P2.19).
 */
export const task = defineObject({
  name: "task",
  description: "Something to do about a deal.",
  fields: {
    title: f.text({ required: true, maxLength: 200 }),
    deal: f.ref("deal", { required: true }),
    done: f.boolean(),
  },
  list: ["title", "deal", "done"],
});

export const organisations = organisation.table;
export const contacts = contact.table;
export const deals = deal.table;
export const tasks = task.table;
