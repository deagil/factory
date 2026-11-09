// A small CRM for the objects tests. drizzle-kit loads this file on its own
// to generate a migration, so it exports the tables as well as the objects.

import { index } from "drizzle-orm/pg-core";

import { defineObject } from "../define-object.ts";
import { f } from "../fields/index.ts";

export const organisation = defineObject({
  name: "organisation",
  fields: {
    name: f.text({ required: true, maxLength: 200 }),
    website: f.text(),
    employees: f.number({ integer: true, min: 0 }),
    owner: f.ref("actor"),
  },
  customFields: true,
  list: ["name", "owner"],
  owner: "owner",
});

export const contact = defineObject({
  name: "contact",
  fields: {
    firstName: f.text({ required: true }),
    lastName: f.text(),
    email: f.text(),
    organisation: f.ref("organisation", { required: true }),
    active: f.boolean({ required: true }),
    birthday: f.date(),
    lifetimeValue: f.money({ currency: "GBP" }),
  },
  drizzle: (t) => [index("contacts_last_name_idx").on(t.lastName)],
});

export const organisations = organisation.table;
export const contacts = contact.table;
