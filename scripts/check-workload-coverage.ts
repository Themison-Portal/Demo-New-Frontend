import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapPhases, mapTasks, trials, type ExecutionMap } from "../drizzle/schema";
import { getDb } from "../server/db";

type Mode = "sample" | "full" | "building";

const PHASE_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function startOfIsoWeek(source: Date): Date {
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

function weekIndex(baseWeekStart: Date, date: Date | null, maxWeeks: number) {
  if (!date) return null;
  const normalized = startOfIsoWeek(date);
  const baseUtc = Date.UTC(baseWeekStart.getFullYear(), baseWeekStart.getMonth(), baseWeekStart.getDate());
  const normalizedUtc = Date.UTC(normalized.getFullYear(), normalized.getMonth(), normalized.getDate());
  const week = Math.floor((normalizedUtc - baseUtc) / (7 * 24 * 60 * 60 * 1000));
  if (week < 0 || week >= maxWeeks) return null;
  return week;
}

function pickPreferredMap(rows: ExecutionMap[]) {
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const statusOrder = PHASE_PRIORITY[a.status] - PHASE_PRIORITY[b.status];
    if (statusOrder !== 0) return statusOrder;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

async function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as Mode;
  const weeks = 12;

  if (!["sample", "full", "building"].includes(mode)) {
    throw new Error("Mode must be sample|full|building");
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const modeTrials =
    mode === "building"
      ? await db.select({ id: trials.id }).from(trials).where(like(trials.id, "building:%"))
      : [
          ...(await db.select({ id: trials.id }).from(trials).where(like(trials.id, `${mode}:%`))),
          ...(mode === "sample"
            ? await db.select({ id: trials.id }).from(trials).where(notLike(trials.id, "%:%"))
            : []),
        ];

  const trialIds = Array.from(new Set(modeTrials.map((row) => row.id)));
  if (!trialIds.length) {
    console.log(JSON.stringify({ mode, weeks, trialCount: 0, taskWeeks: [], visitWeeks: [] }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));

  const selectedMaps = new Map<string, string>();
  const rowsByTrial = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = rowsByTrial.get(row.trialId) ?? [];
    list.push(row);
    rowsByTrial.set(row.trialId, list);
  }
  for (const trialId of trialIds) {
    const picked = pickPreferredMap(rowsByTrial.get(trialId) ?? []);
    if (picked) selectedMaps.set(trialId, picked.id);
  }

  const mapIds = Array.from(selectedMaps.values());
  if (!mapIds.length) {
    console.log(JSON.stringify({ mode, weeks, trialCount: trialIds.length, mapCount: 0, taskWeeks: [], visitWeeks: [] }, null, 2));
    return;
  }

  const phases = await db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds));
  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));

  const baseWeekStart = startOfIsoWeek(new Date());
  const taskWeekCounts = Array.from({ length: weeks }, () => 0);
  const visitWeekCounts = Array.from({ length: weeks }, () => 0);
  const coverageTaskRows: Array<{ name: string; dueDate: Date | null; suggestedDate: Date | null; week: number | null }> = [];
  const coverageVisitRows: Array<{ name: string; estimatedDate: Date | null; windowStart: Date | null; week: number | null }> = [];

  for (const task of tasks) {
    const status = normalize(task.status);
    if (status === "done" || status === "skipped" || status === "cancelled") continue;
    const anchor = firstDate(task.dueDate, task.suggestedDate);
    const idx = weekIndex(baseWeekStart, anchor, weeks);
    if (idx !== null) taskWeekCounts[idx] += 1;
    if (String(task.name || "").includes("Coverage Task")) {
      coverageTaskRows.push({
        name: String(task.name || ""),
        dueDate: task.dueDate,
        suggestedDate: task.suggestedDate,
        week: idx,
      });
    }
  }
  for (const phase of phases) {
    const type = normalize(phase.phaseType);
    if (type === "screen_fail" || type === "early_termination") continue;
    const anchor = firstDate(phase.estimatedDate, phase.windowStart, phase.windowEnd);
    const idx = weekIndex(baseWeekStart, anchor, weeks);
    if (idx !== null) visitWeekCounts[idx] += 1;
    if (String(phase.name || "").includes("Coverage Visit")) {
      coverageVisitRows.push({
        name: String(phase.name || ""),
        estimatedDate: phase.estimatedDate,
        windowStart: phase.windowStart,
        week: idx,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode,
        weeks,
        trialCount: trialIds.length,
        mapCount: mapIds.length,
        taskWeeks: taskWeekCounts,
        visitWeeks: visitWeekCounts,
        missingTaskWeeks: taskWeekCounts
          .map((value, index) => ({ value, index }))
          .filter((row) => row.value === 0)
          .map((row) => row.index),
        missingVisitWeeks: visitWeekCounts
          .map((value, index) => ({ value, index }))
          .filter((row) => row.value === 0)
          .map((row) => row.index),
        coverageTasks: coverageTaskRows,
        coverageVisits: coverageVisitRows,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[check-workload-coverage] failed", error);
  process.exit(1);
});
