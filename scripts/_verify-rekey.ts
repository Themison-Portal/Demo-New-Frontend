/** Read-only: confirm child `trialId`s are now BE UUIDs (no prefixed FE ids left). */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const TABLES = [
  "taskScaffolds", "execution_maps", "map_telemetry_events", "map_task_status_history",
  "protocolChunks", "fileSearchStores", "ai_feature_snapshots", "ai_analytics_rollups",
  "ai_training_examples", "knowledge_graph_nodes", "knowledge_graph_edges",
  "conversations", "threads", "trial_inboxes", "collab_telemetry_events",
];

async function main() {
  const db = await getDb();
  if (!db) throw new Error("no db");
  console.log("DB host:", new URL(process.env.DATABASE_URL as string).hostname, "\n");
  let leftover = 0;
  for (const t of TABLES) {
    const r: any = await db.execute(
      sql.raw(
        "SELECT " +
          "SUM(CASE WHEN `trialId` LIKE '%:%' THEN 1 ELSE 0 END) AS prefixed, " +
          "SUM(CASE WHEN CHAR_LENGTH(`trialId`)=36 AND `trialId` NOT LIKE '%:%' THEN 1 ELSE 0 END) AS uuid, " +
          "COUNT(*) AS total FROM `" + t + "`"
      )
    );
    const row = (r?.[0]?.[0] ?? r?.[0]) || {};
    const pref = Number(row.prefixed ?? 0);
    leftover += pref;
    console.log(
      `${t.padEnd(26)} prefixed=${String(pref).padEnd(4)} uuid=${String(row.uuid ?? 0).padEnd(5)} total=${row.total ?? 0}`
    );
  }
  console.log(`\nLEFTOVER prefixed trialIds (should be 0): ${leftover}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
