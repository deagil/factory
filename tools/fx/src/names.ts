import { FxError } from "./errors.ts";

const maxSlugLength = 40;

/**
 * Turns a change name into a slug for its branch, worktree and database:
 * "Deal pipeline (v2)" becomes "deal-pipeline-v2".
 */
export const slugify = (name: string): string => {
  const slug = name
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, maxSlugLength)
    .replace(/-+$/u, "");
  if (slug === "") {
    throw new FxError(
      "usage",
      `"${name}" has no letters or digits to name a change with.`,
      'Try something like `fx start "deal pipeline"`.'
    );
  }
  return slug;
};

/** The branch for a change. */
export const branchName = (slug: string): string => `change/${slug}`;

/** The database for a change: `<repo>_<slug>`, as a safe Postgres name. */
export const databaseName = (repo: string, slug: string): string =>
  `${repo}_${slug}`.toLowerCase().replaceAll(/[^a-z0-9_]/gu, "_");
