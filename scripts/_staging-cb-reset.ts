/**
 * TEMP remediation helper: assess (and optionally reset) `trials.coreBackendTrialId`
 * on whatever DATABASE_URL points to. Read-only unless RESET=1.
 *   assess: corepack pnpm exec tsx scripts/_staging-cb-reset.ts
 *   reset : RESET=1 corepack pnpm exec tsx scripts/_staging-cb-reset.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL not set / DB unavailable");
  console.log("DB host:", new URL(process.env.DATABASE_URL as string).hostname);

  const run = async (label: string, q: string) => {
    const r: any = await db.execute(sql.raw(q));
    console.log(label, JSON.stringify(r?.[0] ?? r));
  };
  await run("total trials        :", "SELECT COUNT(*) AS n FROM `trials`");
  await run("with coreBackendId  :", "SELECT COUNT(*) AS n FROM `trials` WHERE `coreBackendTrialId` IS NOT NULL");
  await run("sample (id -> cb)   :", "SELECT `id`,`coreBackendTrialId` FROM `trials` WHERE `coreBackendTrialId` IS NOT NULL LIMIT 5");

  if (process.env.RESET === "1") {
    const r: any = await db.execute(
      sql.raw("UPDATE `trials` SET `coreBackendTrialId` = NULL WHERE `coreBackendTrialId` IS NOT NULL")
    );
    console.log("RESET -> rows nulled:", r?.affectedRows ?? r?.[0]?.affectedRows ?? "?");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
