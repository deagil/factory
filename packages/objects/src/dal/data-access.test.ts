import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createCrmDatabase,
  createStaffActor,
} from "../test-fixtures/crm-database.ts";
import type { CrmDatabase } from "../test-fixtures/crm-database.ts";
import { contact, organisation } from "../test-fixtures/crm-schema.ts";
import { createDataAccess } from "./data-access.ts";
import type { DataAccess, ReadAccess } from "./data-access.ts";
import type { ListInput } from "./list-input.ts";

const gbp = (amount: number) => ({ amount, currency: "GBP" });

/** Every page's names, following nextCursor to the end. */
const walkPages = async (dal: DataAccess, input: ListInput) => {
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    // Each page needs the cursor from the one before.
    // oxlint-disable-next-line no-await-in-loop
    const page = await dal.list(contact, { ...input, cursor });
    pages.push(page.records.map((r) => r.firstName));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
};

/** A data access layer whose reader may read only what `access` allows. */
const readerWith = (crm: CrmDatabase, access: Record<string, ReadAccess>) =>
  createDataAccess({
    executor: crm.db,
    canRead: (object) => access[object.name] ?? "all",
  });

describe("the data access layer", () => {
  let crm: CrmDatabase;
  let dal: DataAccess;
  const ids: Record<string, string> = {};

  const names = async (input: ListInput, reader: DataAccess = dal) => {
    const { records } = await reader.list(contact, input);
    return records.map((r) => r.firstName);
  };

  const sorted = async (input: ListInput) => {
    const found = await names(input);
    return found.toSorted();
  };

  const walk = (input: ListInput) => walkPages(dal, input);

  const readerFor = (access: Record<string, ReadAccess>) =>
    readerWith(crm, access);

  const orgNames = async (input: ListInput) => {
    const { records } = await dal.list(organisation, input);
    return records.map((r) => r.name).toSorted();
  };

  beforeAll(async () => {
    crm = await createCrmDatabase();
    const { db } = crm;
    dal = createDataAccess({ executor: db, canRead: () => "all" });

    const sarah = await createStaffActor(db, "Sarah");
    ids.sarah = sarah.id;
    const by = { createdBy: sarah.id, updatedBy: sarah.id };

    const insertOrg = async (values: Record<string, unknown>) => {
      const [row] = await db
        .insert(organisation.table)
        .values({ ...by, ...organisation.toRow(values) } as never)
        .returning();
      ids[values.name as string] = row?.id ?? "";
    };
    await insertOrg({ name: "Acme", employees: 50, owner: sarah.id });
    await insertOrg({ name: "Globex" });
    await insertOrg({ name: "Initech", employees: 10 });

    // Inserted one at a time, so each has a later created_at than the last.
    const insertContact = async (
      values: Record<string, unknown>,
      archived = false
    ) => {
      const [row] = await db
        .insert(contact.table)
        .values({
          ...by,
          ...contact.toRow(values),
          ...(archived ? { archivedAt: new Date() } : {}),
        } as never)
        .returning();
      ids[values.firstName as string] = row?.id ?? "";
    };
    await insertContact({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@acme.test",
      organisation: ids.Acme,
      active: true,
      birthday: "1990-12-10",
      lifetimeValue: gbp(1000),
    });
    await insertContact({
      firstName: "Grace",
      lastName: "Hopper",
      organisation: ids.Acme,
      active: false,
      birthday: "1985-01-01",
      lifetimeValue: gbp(5000),
    });
    await insertContact({
      firstName: "Alan",
      lastName: "Turing",
      email: "alan@globex.test",
      organisation: ids.Globex,
      active: true,
    });
    await insertContact({
      firstName: "Edsger",
      lastName: "50%_off",
      organisation: ids.Globex,
      active: true,
      birthday: "2000-06-15",
      lifetimeValue: gbp(250),
    });
    await insertContact(
      {
        firstName: "Barbara",
        lastName: "Liskov",
        organisation: ids.Acme,
        active: true,
      },
      true
    );
  }, 60_000);

  afterAll(async () => {
    await crm?.close();
  });

  describe("filters, one test per operator", () => {
    const cases: [string, () => ListInput, string[]][] = [
      // text
      ["text eq", () => ({ filter: { firstName: { eq: "Ada" } } }), ["Ada"]],
      [
        "text ne",
        () => ({ filter: { firstName: { ne: "Ada" } } }),
        ["Alan", "Edsger", "Grace"],
      ],
      [
        "text in",
        () => ({ filter: { firstName: { in: ["Ada", "Grace"] } } }),
        ["Ada", "Grace"],
      ],
      [
        "text contains, ignoring case",
        () => ({ filter: { lastName: { contains: "OPP" } } }),
        ["Grace"],
      ],
      [
        "text contains, % and _ literally",
        () => ({ filter: { lastName: { contains: "%_" } } }),
        ["Edsger"],
      ],
      [
        "text startsWith",
        () => ({ filter: { firstName: { startsWith: "a" } } }),
        ["Ada", "Alan"],
      ],
      [
        "text isNull",
        () => ({ filter: { email: { isNull: true } } }),
        ["Edsger", "Grace"],
      ],
      [
        "text isNull false",
        () => ({ filter: { email: { isNull: false } } }),
        ["Ada", "Alan"],
      ],
      // money
      [
        "money eq",
        () => ({ filter: { lifetimeValue: { eq: gbp(1000) } } }),
        ["Ada"],
      ],
      [
        "money ne",
        () => ({ filter: { lifetimeValue: { ne: gbp(1000) } } }),
        ["Edsger", "Grace"],
      ],
      [
        "money gt",
        () => ({ filter: { lifetimeValue: { gt: gbp(1000) } } }),
        ["Grace"],
      ],
      [
        "money gte",
        () => ({ filter: { lifetimeValue: { gte: gbp(1000) } } }),
        ["Ada", "Grace"],
      ],
      [
        "money lt",
        () => ({ filter: { lifetimeValue: { lt: gbp(1000) } } }),
        ["Edsger"],
      ],
      [
        "money lte",
        () => ({ filter: { lifetimeValue: { lte: gbp(1000) } } }),
        ["Ada", "Edsger"],
      ],
      [
        "money in another currency",
        () => ({
          filter: { lifetimeValue: { gt: { amount: 0, currency: "EUR" } } },
        }),
        [],
      ],
      [
        "money currency",
        () => ({ filter: { lifetimeValue: { currency: "GBP" } } }),
        ["Ada", "Edsger", "Grace"],
      ],
      [
        "money isNull",
        () => ({ filter: { lifetimeValue: { isNull: true } } }),
        ["Alan"],
      ],
      // date
      [
        "date eq",
        () => ({ filter: { birthday: { eq: "1990-12-10" } } }),
        ["Ada"],
      ],
      [
        "date ne",
        () => ({ filter: { birthday: { ne: "1990-12-10" } } }),
        ["Edsger", "Grace"],
      ],
      [
        "date gt",
        () => ({ filter: { birthday: { gt: "1990-12-10" } } }),
        ["Edsger"],
      ],
      [
        "date gte",
        () => ({ filter: { birthday: { gte: "1990-12-10" } } }),
        ["Ada", "Edsger"],
      ],
      [
        "date lt",
        () => ({ filter: { birthday: { lt: "1990-12-10" } } }),
        ["Grace"],
      ],
      [
        "date lte",
        () => ({ filter: { birthday: { lte: "1990-12-10" } } }),
        ["Ada", "Grace"],
      ],
      [
        "date in",
        () => ({ filter: { birthday: { in: ["1985-01-01", "2000-06-15"] } } }),
        ["Edsger", "Grace"],
      ],
      [
        "date isNull",
        () => ({ filter: { birthday: { isNull: true } } }),
        ["Alan"],
      ],
      // boolean
      ["boolean eq", () => ({ filter: { active: { eq: false } } }), ["Grace"]],
      [
        "boolean isNull",
        () => ({ filter: { active: { isNull: false } } }),
        ["Ada", "Alan", "Edsger", "Grace"],
      ],
      // ref
      [
        "ref eq",
        () => ({ filter: { organisation: { eq: ids.Acme } } }),
        ["Ada", "Grace"],
      ],
      [
        "ref ne",
        () => ({ filter: { organisation: { ne: ids.Acme } } }),
        ["Alan", "Edsger"],
      ],
      [
        "ref in",
        () => ({ filter: { organisation: { in: [ids.Globex ?? ""] } } }),
        ["Alan", "Edsger"],
      ],
      [
        "ref isNull",
        () => ({ filter: { organisation: { isNull: true } } }),
        [],
      ],
      // housekeeping columns
      [
        "id in",
        () => ({ filter: { id: { in: [ids.Ada ?? "", ids.Alan ?? ""] } } }),
        ["Ada", "Alan"],
      ],
      [
        "createdBy eq",
        () => ({ filter: { createdBy: { eq: ids.sarah } } }),
        ["Ada", "Alan", "Edsger", "Grace"],
      ],
      [
        "createdAt range",
        () => ({
          filter: {
            createdAt: {
              gte: "2000-01-01T00:00:00Z",
              lt: "2999-01-01T00:00:00Z",
            },
          },
        }),
        ["Ada", "Alan", "Edsger", "Grace"],
      ],
      // more than one field: all must hold
      [
        "two fields",
        () => ({
          filter: { active: { eq: true }, organisation: { eq: ids.Globex } },
        }),
        ["Alan", "Edsger"],
      ],
    ];

    it.each(cases)("%s", async (_name, input, expected) => {
      await expect(sorted(input())).resolves.toStrictEqual(expected);
    });

    const numberCases: [string, ListInput, string[]][] = [
      ["number eq", { filter: { employees: { eq: 50 } } }, ["Acme"]],
      ["number ne", { filter: { employees: { ne: 50 } } }, ["Initech"]],
      ["number gt", { filter: { employees: { gt: 10 } } }, ["Acme"]],
      [
        "number gte",
        { filter: { employees: { gte: 10 } } },
        ["Acme", "Initech"],
      ],
      ["number lt", { filter: { employees: { lt: 50 } } }, ["Initech"]],
      [
        "number lte",
        { filter: { employees: { lte: 50 } } },
        ["Acme", "Initech"],
      ],
      ["number in", { filter: { employees: { in: [10, 11] } } }, ["Initech"]],
      [
        "number isNull",
        { filter: { employees: { isNull: true } } },
        ["Globex"],
      ],
      [
        "actor ref isNull",
        { filter: { owner: { isNull: true } } },
        ["Globex", "Initech"],
      ],
    ];

    it.each(numberCases)("%s", async (_name, input, expected) => {
      await expect(orgNames(input)).resolves.toStrictEqual(expected);
    });

    it("refuses unknown fields and operators", async () => {
      await expect(
        dal.list(contact, { filter: { colour: { eq: "red" } } })
      ).rejects.toThrow(/colour/u);
      await expect(
        dal.list(contact, { filter: { active: { gt: true } } })
      ).rejects.toThrow(/gt/u);
    });
  });

  describe("sorting", () => {
    it("is newest first by default", async () => {
      await expect(names({})).resolves.toStrictEqual([
        "Edsger",
        "Alan",
        "Grace",
        "Ada",
      ]);
    });

    it("sorts by a field either way", async () => {
      await expect(names({ sort: "firstName" })).resolves.toStrictEqual([
        "Ada",
        "Alan",
        "Edsger",
        "Grace",
      ]);
      await expect(names({ sort: "-firstName" })).resolves.toStrictEqual([
        "Grace",
        "Edsger",
        "Alan",
        "Ada",
      ]);
    });

    it("puts empty values last both ways", async () => {
      await expect(names({ sort: "birthday" })).resolves.toStrictEqual([
        "Grace",
        "Ada",
        "Edsger",
        "Alan",
      ]);
      await expect(names({ sort: "-birthday" })).resolves.toStrictEqual([
        "Edsger",
        "Ada",
        "Grace",
        "Alan",
      ]);
    });

    it("sorts money by amount", async () => {
      await expect(names({ sort: "-lifetimeValue" })).resolves.toStrictEqual([
        "Grace",
        "Ada",
        "Edsger",
        "Alan",
      ]);
    });

    it("refuses keys it can't sort on", async () => {
      await expect(dal.list(contact, { sort: "organisation" })).rejects.toThrow(
        /sort/u
      );
    });
  });

  describe("paging", () => {
    it("pages through every record once, in order", async () => {
      await expect(walk({ limit: 3 })).resolves.toStrictEqual([
        ["Edsger", "Alan", "Grace"],
        ["Ada"],
      ]);
    });

    it("pages through empty sort values", async () => {
      await expect(walk({ sort: "birthday", limit: 1 })).resolves.toStrictEqual(
        [["Grace"], ["Ada"], ["Edsger"], ["Alan"]]
      );
    });

    it("pages through ties without losing or repeating any", async () => {
      const pages = await walk({ sort: "-active", limit: 1 });
      expect(pages.flat().toSorted()).toStrictEqual([
        "Ada",
        "Alan",
        "Edsger",
        "Grace",
      ]);
      expect(pages.at(-1)).toStrictEqual(["Grace"]);
    });

    it("refuses a cursor that isn't one, or is for another sort", async () => {
      const { nextCursor } = await dal.list(contact, { limit: 1 });
      await expect(dal.list(contact, { cursor: "nonsense" })).rejects.toThrow(
        /isn't a cursor from this list/u
      );
      await expect(
        dal.list(contact, { cursor: nextCursor ?? "", sort: "firstName" })
      ).rejects.toThrow(/This cursor is for the sort/u);
    });
  });

  describe("archived records", () => {
    it("are hidden unless asked for", async () => {
      await expect(names({})).resolves.not.toContain("Barbara");
      await expect(sorted({ archived: "include" })).resolves.toContain(
        "Barbara"
      );
      await expect(names({ archived: "only" })).resolves.toStrictEqual([
        "Barbara",
      ]);
    });

    it("are found by get only when asked for", async () => {
      await expect(dal.get(contact, ids.Barbara ?? "")).resolves.toBeNull();
      const found = await dal.get(contact, ids.Barbara ?? "", {
        archived: "include",
      });
      expect(found?.record.archivedAt).toMatch(/^\d{4}-\d\d-\d\dT/u);
    });
  });

  describe("get", () => {
    it("returns a record that matches the record schema", async () => {
      const found = await dal.get(contact, ids.Ada ?? "");
      expect(found?.record.firstName).toBe("Ada");
      expect(contact.schemas.record.parse(found?.record)).toStrictEqual(
        found?.record
      );
    });

    it("returns null for an id that isn't there", async () => {
      await expect(
        dal.get(contact, "019a5b3c-7d2e-7f00-8a1b-2c3d4e5f6a7b")
      ).resolves.toBeNull();
    });
  });

  describe("following refs", () => {
    it("returns the records refs point at, by id", async () => {
      const { related } = await dal.list(contact, { expand: ["organisation"] });
      expect(
        Object.values(related.organisation ?? {})
          .map((org) => (org as { name: string }).name)
          .toSorted()
      ).toStrictEqual(["Acme", "Globex"]);
    });

    it("shows actors by id, name and kind", async () => {
      const found = await dal.get(organisation, ids.Acme ?? "", {
        expand: ["owner"],
      });
      expect(found?.related.owner).toStrictEqual({
        [ids.sarah ?? ""]: { id: ids.sarah, name: "Sarah", kind: "staff" },
      });
    });

    it("refuses to follow a field that isn't a ref", async () => {
      await expect(
        dal.list(contact, { expand: ["firstName"] })
      ).rejects.toThrow(/expand/u);
    });
  });

  describe("the permission hook", () => {
    it("asks about each object it reads", async () => {
      const asked: string[] = [];
      const reader = createDataAccess({
        executor: crm.db,
        canRead: (object) => {
          asked.push(object.name);
          return "all";
        },
      });
      await reader.list(contact, { expand: ["organisation"] });
      expect(asked).toStrictEqual(["contact", "organisation"]);
    });

    it("returns nothing for an object the reader can't read", async () => {
      const reader = readerFor({ contact: "none" });
      await expect(names({}, reader)).resolves.toStrictEqual([]);
      await expect(reader.get(contact, ids.Ada ?? "")).resolves.toBeNull();
    });

    it("leaves out related records the reader can't read", async () => {
      const reader = readerFor({ organisation: "none" });
      const { records, related } = await reader.list(contact, {
        expand: ["organisation"],
      });
      expect(records).toHaveLength(4);
      expect(related).toStrictEqual({ organisation: {} });
    });
  });
});
