// Seed data for local and preview databases: an admin, a salesperson, a
// support person, and a few organisations and contacts. People are
// bootstrapped (there is no actor to run an action as yet); everything else
// goes through actions. Running it twice changes nothing.
import type { Caller, Pipeline } from "@workspace/actions";
import { bootstrapStaff } from "@workspace/db";
import type { Db } from "@workspace/db";
import type { System } from "@workspace/server";

const organisations = [
  { name: "Acme Ltd", website: "https://acme.example", employees: 120 },
  { name: "Globex", website: "https://globex.example", employees: 45 },
  { name: "Initech", employees: 300 },
];

const contacts = [
  { firstName: "Ada", lastName: "Lovelace", email: "ada@acme.example", at: 0 },
  {
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@acme.example",
    at: 0,
  },
  {
    firstName: "Alan",
    lastName: "Turing",
    email: "alan@globex.example",
    at: 1,
  },
  { firstName: "Joan", lastName: "Clarke", at: 2 },
];

export interface Seeded {
  admin: Caller;
  sales: Caller;
  /** An agent key for the admin, if this run created the agent. */
  agentKey: string | null;
  /** A key for the Website integration, if this run created it. */
  integrationKey: string | null;
}

export const seed = async (
  system: System,
  db: Db,
  pipeline: Pipeline,
  adminEmail = "admin@example.com"
): Promise<Seeded> => {
  const boss = await bootstrapStaff(db, {
    name: "Admin",
    email: adminEmail,
    roles: ["admin"],
  });
  const sarah = await bootstrapStaff(db, {
    name: "Sarah Sales",
    email: "sarah@example.com",
    roles: ["sales"],
  });
  await bootstrapStaff(db, {
    name: "Sam Support",
    email: "sam@example.com",
    roles: ["support"],
  });
  const admin = { actorId: boss.id, originUserId: boss.userId };
  const sales = { actorId: sarah.id, originUserId: sarah.userId };

  const run = async (name: string, input: unknown) => {
    const definition = system.registry.get(name);
    const result =
      definition?.kind === "action"
        ? await pipeline.run(definition, input, admin, {
            retryKey: `seed:${name}:${JSON.stringify(input)}`,
          })
        : null;
    if (!result?.ok) {
      throw new Error(`Seeding ${name} failed: ${JSON.stringify(result)}`);
    }
    return result;
  };

  const ids: string[] = [];
  for (const values of organisations) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one at a time keeps the retry keys and log readable.
    const result = await run("organisation.create", {
      ...values,
      owner: boss.id,
    });
    ids.push((result.output as { record: { id: string } }).record.id);
  }
  for (const { at, ...values } of contacts) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above.
    await run("contact.create", {
      ...values,
      organisation: ids[at],
      active: true,
    });
  }

  /** A new key for the actor `create` makes; null if it already existed. */
  const keyFor = async (create: string, input: unknown) => {
    const made = await run(create, input);
    if (made.replayed) {
      return null;
    }
    const { actorId } = made.output as { actorId: string };
    const key = await run("apiKey.create", { actorId, label: "seed" });
    return (key.output as { key: string }).key;
  };

  return {
    admin,
    sales,
    agentKey: await keyFor("actor.createAgent", { name: "Claude" }),
    integrationKey: await keyFor("actor.createIntegration", {
      name: "Website",
      roles: ["website"],
    }),
  };
};
