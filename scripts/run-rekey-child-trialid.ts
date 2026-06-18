/**
 * Phase E runner for `scripts/rekey-child-trialid.sql` — executes the child-table
 * `trialId` re-key (prefixed FE id -> BE trial UUID) over the existing mysql2
 * connection (`DATABASE_URL`), so no `mysql` CLI is required.
 *
 * Targets whatever `DATABASE_URL` points to — POINT IT AT STAGING TIDB before
 * running for staging. Run the trials backfill FIRST so `coreBackendTrialId` is
 * populated; this script is idempotent (already-migrated UUID rows won't join).
 *
 * Run from the FE repo:
 *   corepack pnpm exec tsx scripts/run-rekey-child-trialid.ts
 * Requires env: DATABASE_URL (FE MySQL/TiDB).
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseStatements(raw: string): string[] {
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--")) // drop SQL comments
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL not set / DB unavailable — aborting.");

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL as string).hostname;
    } catch {
      return "<unknown>";
    }
  })();
  console.log(`[rekey] target DB host: ${host}`);

  const sqlPath = join(__dirname, "rekey-child-trialid.sql");
  const statements = parseStatements(readFileSync(sqlPath, "utf8"));
  console.log(`[rekey] ${statements.length} statement(s) to run\n`);

  let totalAffected = 0;
  for (const statement of statements) {
    const table = statement.match(/UPDATE\s+`?(\w+)`?/i)?.[1] ?? "?";
    try {
      const res: any = await db.execute(sql.raw(statement));
      // mysql2 returns a ResultSetHeader (possibly wrapped in an array).
      const affected = res?.affectedRows ?? res?.[0]?.affectedRows ?? 0;
      totalAffected += affected;
      console.log(`[rekey] ${table.padEnd(26)} -> ${affected} row(s) re-keyed`);
    } catch (err) {
      console.error(
        `[rekey] ${table.padEnd(26)} -> FAILED:`,
        err instanceof Error ? err.message : err
      );
      throw err;
    }
  }

  console.log(`\n[rekey] done. Total rows re-keyed: ${totalAffected}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[rekey] aborted:", err);
  process.exit(1);
});
