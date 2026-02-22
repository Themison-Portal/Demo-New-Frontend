import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapPhases, mapTasks, trials, type ExecutionMap } from "../drizzle/schema";
import { getDb } from "../server/db";

type Mode = "sample" | "full" | "building";

const WEEKS = 12;
const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);
const EXCLUDED_VISIT_TYPES = new Set(["screen_fail", "early_termination"]);

const PHASE_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function startOfIsoWeek(source: Date) {
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function firstDate(...dates: Array<Date | null | undefined>) {
  for (const date of dates) {
    if (date instanceof Date && Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function weekIndex(baseWeekStart: Date, date: Date | null) {
  if (!date) return null;
  const normalized = startOfIsoWeek(date);
  const baseUtc = Date.UTC(baseWeekStart.getFullYear(), baseWeekStart.getMonth(), baseWeekStart.getDate());
  const normalizedUtc = Date.UTC(normalized.getFullYear(), normalized.getMonth(), normalized.getDate());
  const week = Math.floor((normalizedUtc - baseUtc) / (7 * 24 * 60 * 60 * 1000));
  if (week < 0 || week >= WEEKS) return null;
  return week;
}

function pickPreferredMap(rows: ExecutionMap[]) {
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const rank = PHASE_PRIORITY[a.status] - PHASE_PRIORITY[b.status];
    if (rank !== 0) return rank;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

async function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as Mode;
  if (!["sample", "full", "building"].includes(mode)) {
    throw new Error("mode must be sample|full|building");
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const prefixedTrials = await db.select().from(trials).where(like(trials.id, `${mode}:%`));
  const legacySampleTrials =
    mode === "sample" ? await db.select().from(trials).where(notLike(trials.id, "%:%")) : [];
  const trialRows = [...prefixedTrials, ...legacySampleTrials];
  const trialIds = trialRows.map((trial) => trial.id);

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

  const chosen = trialRows
    .map((trial) => {
      const map = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!map) return null;
      return { trialId: trial.id, trialTitle: trial.title, status: trial.status, mapId: map.id };
    })
    .filter(Boolean) as Array<{ trialId: string; trialTitle: string; status: string; mapId: string }>;

  if (!chosen.length) {
    console.log(JSON.stringify({ mode, weeks: WEEKS, perTrial: [] }, null, 2));
    return;
  }

  const mapIds = chosen.map((entry) => entry.mapId);
  const phaseRows = await db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds));
  const taskRows = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));

  const phaseRowsByMapId = new Map<string, typeof phaseRows>();
  for (const row of phaseRows) {
    const list = phaseRowsByMapId.get(row.mapId) ?? [];
    list.push(row);
    phaseRowsByMapId.set(row.mapId, list);
  }
  const taskRowsByMapId = new Map<string, typeof taskRows>();
  for (const row of taskRows) {
    const list = taskRowsByMapId.get(row.mapId) ?? [];
    list.push(row);
    taskRowsByMapId.set(row.mapId, list);
  }

  const baseWeekStart = startOfIsoWeek(new Date());

  const perTrial = chosen.map((entry) => {
    const tasks = taskRowsByMapId.get(entry.mapId) ?? [];
    const phases = phaseRowsByMapId.get(entry.mapId) ?? [];
    const taskCounts = Array.from({ length: WEEKS }, () => 0);
    const visitCounts = Array.from({ length: WEEKS }, () => 0);

    for (const task of tasks) {
      if (DONE_STATUSES.has(normalize(task.status))) continue;
      const idx = weekIndex(baseWeekStart, firstDate(task.dueDate, task.suggestedDate));
      if (idx !== null) taskCounts[idx] += 1;
    }

    for (const phase of phases) {
      if (EXCLUDED_VISIT_TYPES.has(normalize(phase.phaseType))) continue;
      const idx = weekIndex(baseWeekStart, firstDate(phase.estimatedDate, phase.windowStart, phase.windowEnd));
      if (idx !== null) visitCounts[idx] += 1;
    }

    return {
      trialId: entry.trialId,
      trialTitle: entry.trialTitle,
      status: entry.status,
      taskWeeks: taskCounts,
      visitWeeks: visitCounts,
      minTaskWeekCount: Math.min(...taskCounts),
      minVisitWeekCount: Math.min(...visitCounts),
    };
  });

  console.log(
    JSON.stringify(
      {
        mode,
        weeks: WEEKS,
        trialCount: perTrial.length,
        perTrial,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[check-workload-coverage-per-trial] failed", error);
  process.exit(1);
});
