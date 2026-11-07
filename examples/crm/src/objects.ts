// The CRM's objects. drizzle-kit loads this file on its own, so it exports
// the tables as well as the objects, and imports only from
// `@workspace/objects/define`.
import { defineObject, f } from "@workspace/objects/define";

export const organisation = defineObject({
  name: "organisation",
  description: "A company or other body the business works with.",
  fields: {
    name: f.text({ required: true, maxLength: 200 }),
    website: f.text(),
    employees: f.number({ integer: true, min: 0 }),
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

export const organisations = organisation.table;
export const contacts = contact.table;
