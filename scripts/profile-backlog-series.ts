import { desc, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

const DONE_STATUSES = new Set(["done", "completed", "skipped", "cancelled"]);
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

function parseDateValue(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function startOfIsoWeek(source: Date) {
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(source: Date, days: number) {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function keyForDate(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function resolveBacklogOpenedAnchor(task: MapTask, currentWeekStart: Date, historyWeeks: number) {
  const createdAt = parseDateValue(task.createdAt) ?? parseDateValue(task.updatedAt);
  if (!createdAt) return null;

  const dueLike = parseDateValue(task.suggestedDate) ?? parseDateValue(task.dueDate);
  if (!dueLike) return createdAt;

  const createdWeekStart = startOfIsoWeek(createdAt);
  const dueWeekStart = startOfIsoWeek(dueLike);
  const createdInCurrentWeek = createdWeekStart.getTime() >= currentWeekStart.getTime();
  const dueInFuture = dueWeekStart.getTime() > currentWeekStart.getTime();

  if (createdInCurrentWeek && dueInFuture) {
    const weeksAhead = Math.max(1, Math.floor((dueWeekStart.getTime() - currentWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)));
    const weeksBack = Math.max(1, Math.min(historyWeeks - 1, weeksAhead));
    return addDays(currentWeekStart, -weeksBack * 7);
  }

  return createdAt;
}

function toRolling(values: number[], rollingWindow = 2) {
  return values.map((_, index) => {
    const start = Math.max(0, index - rollingWindow + 1);
    return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
  });
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
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks < 8 || windowWeeks > 26) {
    throw new Error("weeks must be between 8 and 26");
  }

  return { mode, windowWeeks: Math.floor(windowWeeks) };
}

async function main() {
  const { mode, windowWeeks } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ mode, windowWeeks, message: "No trials." }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));

  const mapsByTrial = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = mapsByTrial.get(row.trialId) ?? [];
    list.push(row);
    mapsByTrial.set(row.trialId, list);
  }

  const chosenMapIds = trialRows
    .map((trial) => pickPreferredMap(mapsByTrial.get(trial.id) ?? []))
    .filter(Boolean)
    .map((map) => map!.id);

  const tasks = chosenMapIds.length
    ? await db.select().from(mapTasks).where(inArray(mapTasks.mapId, chosenMapIds))
    : [];

  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
  const displayStart = Math.max(0, historyWeeks - windowWeeks);

  const openedRaw = Array.from({ length: windowWeeks }, () => 0);
  const completedRaw = Array.from({ length: windowWeeks }, () => 0);

  const resolveDisplayIndex = (date: Date | null) => {
    if (!date) return undefined;
    const historyIndex = indexByWeek.get(keyForDate(startOfIsoWeek(date)));
    if (historyIndex === undefined) return undefined;
    const displayIndex = historyIndex - displayStart;
    if (displayIndex < 0 || displayIndex >= windowWeeks) return undefined;
    return displayIndex;
  };

  let doneCount = 0;
  for (const task of tasks) {
    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    const openedIndex = resolveDisplayIndex(openedAt);
    if (openedIndex !== undefined) openedRaw[openedIndex] += 1;

    if (!isDoneStatus(task.status)) continue;
    doneCount += 1;

    let completedAt = parseDateValue(task.completedDate);
    const updatedAt = parseDateValue(task.updatedAt);
    let completedIndex = resolveDisplayIndex(completedAt);
    if (completedIndex === undefined) {
      completedAt = updatedAt ?? openedAt;
      completedIndex = resolveDisplayIndex(completedAt);
    }
    if (completedIndex !== undefined) completedRaw[completedIndex] += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode,
        windowWeeks,
        trials: trialRows.length,
        tasks: tasks.length,
        doneCount,
        openedRaw,
        completedRaw,
        openedRolling: toRolling(openedRaw),
        completedRolling: toRolling(completedRaw),
        openedTotal: openedRaw.reduce((sum, value) => sum + value, 0),
        completedTotal: completedRaw.reduce((sum, value) => sum + value, 0),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[profile-backlog-series] failed", error);
  process.exit(1);
});
