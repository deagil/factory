// How object and field names become table names, column names and labels.

/** Object names and field keys: camelCase, starting with a letter. */
export const identifierPattern = /^[a-z][a-zA-Z0-9]*$/u;

/** `expectedClose` → `expected_close`. */
export const snakeCase = (name: string): string =>
  name.replaceAll(/[A-Z]/gu, (char) => `_${char.toLowerCase()}`);

/** `deal` → `deals`, `activity` → `activities`, `bookingClass` → `booking_classes`. */
export const tableNameFor = (objectName: string): string => {
  const name = snakeCase(objectName);
  if (/[^aeiou]y$/u.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  if (/(?:s|x|z|ch|sh)$/u.test(name)) {
    return `${name}es`;
  }
  return `${name}s`;
};

/** `expectedClose` → `Expected close`. */
export const labelFor = (name: string): string => {
  const words = snakeCase(name).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
