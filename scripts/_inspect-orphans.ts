/** Read-only: what do the leftover prefixed child trialIds reference? */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const q = async (label: string, query: string) => {
    const r: any = await db.execute(sql.raw(query));
    console.log("\n== " + label + " ==");
    console.log(JSON.stringify(r?.[0] ?? r, null, 0));
  };

  // How many DISTINCT prefixed trial ids do the orphans reference, in protocolChunks?
  await q("protocolChunks: distinct orphan trialIds (sample 25)",
    "SELECT `trialId`, COUNT(*) c FROM `protocolChunks` WHERE `trialId` LIKE '%:%' " +
    "GROUP BY `trialId` ORDER BY c DESC LIMIT 25");

  // Do those orphan ids exist in the trials table at all?
  await q("orphan trialIds that ARE NOT in trials (protocolChunks)",
    "SELECT COUNT(DISTINCT pc.`trialId`) missing FROM `protocolChunks` pc " +
    "LEFT JOIN `trials` t ON pc.`trialId` = t.`id` " +
    "WHERE pc.`trialId` LIKE '%:%' AND t.`id` IS NULL");

  // The 36 current trials ids (for comparison)
  await q("current trials ids (all)",
    "SELECT `id`, `coreBackendTrialId` IS NOT NULL hasCb FROM `trials` ORDER BY `id`");

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
