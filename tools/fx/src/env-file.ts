/**
 * Sets `key=value` in the text of a `.env` file: replaces the first line that
 * sets the key, or appends one.
 */
export const setEnvValue = (
  text: string,
  key: string,
  value: string
): string => {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, "mu");
  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }
  const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${base}${line}\n`;
};
