// `pnpm db:lint-migrations [folder]`: refuses destructive statements in
// migrations that are not marked as a contract step. See migration-lint.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { migrationsFolder } from "../migrate.ts";
import { lintMigration } from "../migration-lint.ts";

const folder = process.argv[2]
  ? path.resolve(process.argv[2])
  : migrationsFolder;
const files = readdirSync(folder)
  .filter((file) => file.endsWith(".sql"))
  .toSorted();

const report = files.flatMap((file) =>
  lintMigration(readFileSync(path.join(folder, file), "utf-8")).map(
    (finding) =>
      `${file}, statement ${finding.statement} [${finding.rule}]\n  ${finding.sql.split("\n")[0]}\n  ${finding.message}`
  )
);

if (report.length > 0) {
  process.stderr.write(
    `${report.join("\n\n")}\n\nMigrations expand, then contract (AGENTS.md rule 10). If this really is the contract step, start the file with:\n  -- contract-step: <why it is safe now>\n`
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Checked ${files.length} migration(s): no destructive statements outside contract steps.\n`
  );
}
