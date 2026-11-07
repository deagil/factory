// The CRM's roles, until phase 2 loads them from config.
import type { Role } from "@workspace/actions";

export const roles: Role[] = [
  {
    key: "admin",
    label: "Admin",
    permissions: [
      {
        object: "*",
        can: ["view", "create", "update", "archive"],
        scope: "all",
      },
      { action: "*", scope: "all" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    permissions: [
      {
        object: "organisation",
        can: ["view", "create", "update"],
        scope: "all",
      },
      { object: "contact", can: ["view", "create", "update"], scope: "all" },
      { action: "contact.moveToOrganisation", scope: "all" },
      { action: "actor.createAgent", scope: "all" },
      { action: "apiKey.create", scope: "all" },
      { action: "apiKey.revoke", scope: "all" },
    ],
  },
];
