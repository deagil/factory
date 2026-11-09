// Every object defined in this process, by name. defineObject adds to it, and
// refs find their target's table through it. defineSystem decides
// which objects a running system serves.

import type { AnyObjectDefinition } from "./define-object.ts";

const objects = new Map<string, AnyObjectDefinition>();

/** Adds an object. Fails if its name or table name is already taken. */
export const registerObject = (object: AnyObjectDefinition): void => {
  if (objects.has(object.name)) {
    throw new Error(
      `defineObject("${object.name}"): an object with this name is already defined. Object names must be unique.`
    );
  }
  for (const other of objects.values()) {
    if (other.tableName === object.tableName) {
      throw new Error(
        `defineObject("${object.name}"): the table "${object.tableName}" is already used by "${other.name}". Pass a different \`table\`.`
      );
    }
  }
  objects.set(object.name, object);
};

/** The object called `name`, if one is defined. */
export const getObject = (name: string): AnyObjectDefinition | undefined =>
  objects.get(name);

/** Every defined object, in the order they were defined. */
export const listObjects = (): AnyObjectDefinition[] => [...objects.values()];
