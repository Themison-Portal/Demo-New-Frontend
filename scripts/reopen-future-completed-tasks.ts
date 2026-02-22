import { and, desc, eq, inArray, like, notLike, or } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);
const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function parseDateValue(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isDoneStatus(status: MapTask["status"]) {
  return DONE_STATUSES.has(normalizeToken(status));
}

function modeFromTrialId(trialId: string): ModeFilter | "legacy" {
  if (trialId.startsWith("sample:")) return "sample";
  if (trialId.startsWith("full:")) return "full";
  if (trialId.startsWith("building:")) return "building";
  return "legacy";
}

function shouldIncludeTrialForMode(trialId: string, mode: ModeFilter) {
  if (mode === "all") return true;
  const trialMode = modeFromTrialId(trialId);
  if (trialMode === mode) return true;
  return mode === "sample" && trialMode === "legacy";
}

function pickPreferredMap(rows: ExecutionMap[]) {
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const rank = MAP_STATUS_PRIORITY[a.status] - MAP_STATUS_PRIORITY[b.status];
    if (rank !== 0) return rank;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const statusArg = argv.find((arg) => arg.startsWith("--status="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }
  const futureWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 26;
  if (!Number.isFinite(futureWeeks) || futureWeeks < 1 || futureWeeks > 52) {
    throw new Error("weeks must be between 1 and 52");
  }
  const restoreStatus = (statusArg ? statusArg.replace("--status=", "") : "todo").toLowerCase();
  if (!["todo", "in_progress"].includes(restoreStatus)) {
    throw new Error("status must be todo|in_progress");
  }
  return { apply, mode, futureWeeks: Math.floor(futureWeeks), restoreStatus: restoreStatus as "todo" | "in_progress" };
}

async function main() {
  const { apply, mode, futureWeeks, restoreStatus } = parseArgs(process.argv.slice(2));
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const prefixedTrials =
    mode === "all"
      ? await db.select().from(trials)
      : await db.select().from(trials).where(like(trials.id, `${mode}:%`));
  const legacySampleTrials =
    mode === "sample" || mode === "all"
      ? await db.select().from(trials).where(notLike(trials.id, "%:%"))
      : [];
  const trialRows = [...prefixedTrials, ...legacySampleTrials].filter((trial) =>
    shouldIncludeTrialForMode(trial.id, mode)
  );
  const trialIds = trialRows.map((trial) => trial.id);
  if (!trialIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No trials found." }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));
  const mapRowsByTrialId = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = mapRowsByTrialId.get(row.trialId) ?? [];
    list.push(row);
    mapRowsByTrialId.set(row.trialId, list);
  }

  const mapIdToTrialId = new Map<string, string>();
  for (const trial of trialRows) {
    const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
    if (preferredMap) mapIdToTrialId.set(preferredMap.id, trial.id);
  }
  const mapIds = Array.from(mapIdToTrialId.keys());
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No maps found." }, null, 2));
    return;
  }

  const rows = await db
    .select()
    .from(mapTasks)
    .where(
      and(
        inArray(mapTasks.mapId, mapIds),
        or(eq(mapTasks.status, "done"), eq(mapTasks.status, "skipped"), eq(mapTasks.status, "cancelled"))
      )
    );

  const now = new Date();
  const end = new Date(now.getTime());
  end.setDate(end.getDate() + futureWeeks * 7);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const candidates = rows.filter((task) => {
    if (!isDoneStatus(task.status)) return false;
    const due = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
    if (!due) return false;
    if (due.getTime() < todayStart.getTime() || due.getTime() > end.getTime()) return false;
    const completed = parseDateValue(task.completedDate);
    return completed ? completed.getTime() <= due.getTime() : true;
  });

  const trialCounts = new Map<string, number>();
  for (const task of candidates) {
    const trialId = mapIdToTrialId.get(task.mapId) ?? "unknown";
    trialCounts.set(trialId, (trialCounts.get(trialId) ?? 0) + 1);
  }

  if (apply) {
    for (const task of candidates) {
      await db
        .update(mapTasks)
        .set({
          status: restoreStatus,
          completedDate: null,
        })
        .where(eq(mapTasks.id, task.id));
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        futureWeeks,
        restoreStatus,
        candidates: candidates.length,
        perTrial: Object.fromEntries(Array.from(trialCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]))),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[reopen-future-completed-tasks] failed", error);
  process.exit(1);
});

