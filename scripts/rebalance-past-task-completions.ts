import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask, type Trial } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";
type ConcreteMode = "sample" | "full" | "building";

type TrialTarget = {
  trialId: string;
  trialTitle: string;
  mapId: string;
};

type PlannedTaskUpdate = {
  trialId: string;
  trialTitle: string;
  taskId: string;
  weekIndex: number;
  completedDate: Date;
};

type Series = {
  labels: string[];
  opened: number[];
  completed: number[];
};

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
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
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

function startOfDay(source: Date) {
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

function addDays(source: Date, days: number) {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function keyForDate(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function firstDate(...dates: Array<Date | null | undefined>) {
  for (const date of dates) {
    if (date instanceof Date && Number.isFinite(date.getTime())) return date;
  }
  return null;
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
    const weeksAhead = Math.max(
      1,
      Math.floor((dueWeekStart.getTime() - currentWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000))
    );
    const weeksBack = Math.max(1, Math.min(historyWeeks - 1, weeksAhead));
    return addDays(currentWeekStart, -weeksBack * 7);
  }

  return createdAt;
}

function buildSeriesForTasks(tasks: MapTask[], windowWeeks: number): { series: Series; weekStarts: Date[] } {
  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
  const resolveWeekIndex = (date: Date | null) => {
    if (!date) return undefined;
    return indexByWeek.get(keyForDate(startOfIsoWeek(date)));
  };

  const openedRaw = Array.from({ length: historyWeeks }, () => 0);
  const completedRaw = Array.from({ length: historyWeeks }, () => 0);

  for (const task of tasks) {
    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    if (openedAt) {
      const openedIndex = resolveWeekIndex(openedAt);
      if (openedIndex !== undefined) openedRaw[openedIndex] += 1;
    }

    let completedAt = parseDateValue(task.completedDate);
    const updatedAt = parseDateValue(task.updatedAt);
    const done = isDoneStatus(task.status);
    let completedIndex = resolveWeekIndex(completedAt);
    if (done && completedIndex === undefined) {
      completedAt = updatedAt ?? openedAt;
      completedIndex = resolveWeekIndex(completedAt);
    }
    if (completedIndex !== undefined) completedRaw[completedIndex] += 1;
  }

  const displayStart = Math.max(0, weekStarts.length - windowWeeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const displayOpenedRaw = openedRaw.slice(displayStart);
  const displayCompletedRaw = completedRaw.slice(displayStart);
  const rollingWindow = 2;
  const toRolling = (values: number[]) =>
    values.map((_, index) => {
      const start = Math.max(0, index - rollingWindow + 1);
      return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
    });

  const opened = toRolling(displayOpenedRaw);
  const completed = toRolling(displayCompletedRaw);
  const labelFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

  return {
    series: {
      labels: displayWeekStarts.map((date) => labelFmt.format(date)),
      opened,
      completed,
    },
    weekStarts: displayWeekStarts,
  };
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const ratioArg = argv.find((arg) => arg.startsWith("--ratio="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const targetRatio = ratioArg ? Number(ratioArg.replace("--ratio=", "")) : 0.55;
  if (!Number.isFinite(targetRatio) || targetRatio <= 0 || targetRatio >= 1) {
    throw new Error("ratio must be a decimal between 0 and 1 (e.g. 0.55)");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks < 4 || windowWeeks > 26) {
    throw new Error("weeks must be between 4 and 26");
  }

  return { apply, mode, targetRatio, windowWeeks: Math.floor(windowWeeks) };
}

async function main() {
  const { apply, mode, targetRatio, windowWeeks } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, mode, targetRatio, windowWeeks, message: "No trials found." }, null, 2));
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

  const chosenTrials: TrialTarget[] = trialRows
    .map((trial) => {
      const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!preferredMap) return null;
      return { trialId: trial.id, trialTitle: trial.title, mapId: preferredMap.id };
    })
    .filter(Boolean) as TrialTarget[];
  const mapIds = chosenTrials.map((entry) => entry.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, targetRatio, windowWeeks, message: "No active maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const tasksByMapId = new Map<string, MapTask[]>();
  for (const task of tasks) {
    const list = tasksByMapId.get(task.mapId) ?? [];
    list.push(task);
    tasksByMapId.set(task.mapId, list);
  }

  const todayStart = startOfDay(new Date());
  const plannedUpdates: PlannedTaskUpdate[] = [];
  const trialSummaries: Array<Record<string, unknown>> = [];

  for (const trial of chosenTrials) {
    const trialTasks = tasksByMapId.get(trial.mapId) ?? [];
    const { series: beforeSeries, weekStarts } = buildSeriesForTasks(trialTasks, windowWeeks);
    const weekIndexByStart = new Map(weekStarts.map((date, index) => [keyForDate(date), index]));

    const candidatesByWeek = new Map<number, MapTask[]>();
    for (const task of trialTasks) {
      if (isDoneStatus(task.status)) continue;
      const dueLike = firstDate(parseDateValue(task.dueDate), parseDateValue(task.suggestedDate));
      if (!dueLike) continue;
      if (dueLike.getTime() >= todayStart.getTime()) continue;
      const weekIdx = weekIndexByStart.get(keyForDate(startOfIsoWeek(dueLike)));
      if (weekIdx === undefined) continue;
      const bucket = candidatesByWeek.get(weekIdx) ?? [];
      bucket.push(task);
      candidatesByWeek.set(weekIdx, bucket);
    }

    for (const [weekIdx, bucket] of candidatesByWeek.entries()) {
      bucket.sort((a, b) => {
        const aDue = firstDate(parseDateValue(a.dueDate), parseDateValue(a.suggestedDate))?.getTime() ?? 0;
        const bDue = firstDate(parseDateValue(b.dueDate), parseDateValue(b.suggestedDate))?.getTime() ?? 0;
        return aDue - bDue;
      });
      candidatesByWeek.set(weekIdx, bucket);
    }

    const selectedTaskIds = new Set<string>();
    for (let weekIdx = 0; weekIdx < beforeSeries.labels.length; weekIdx += 1) {
      const opened = beforeSeries.opened[weekIdx] ?? 0;
      const completed = beforeSeries.completed[weekIdx] ?? 0;
      if (opened <= 0) continue;
      const targetCompleted = Math.max(1, Math.round(opened * targetRatio));
      let deficit = Math.max(0, targetCompleted - completed);
      if (deficit <= 0) continue;
      const candidates = candidatesByWeek.get(weekIdx) ?? [];
      for (const task of candidates) {
        if (deficit <= 0) break;
        if (selectedTaskIds.has(task.id)) continue;
        selectedTaskIds.add(task.id);
        deficit -= 1;
      }
    }

    const plannedForTrial: PlannedTaskUpdate[] = [];
    for (const taskId of selectedTaskIds) {
      const task = trialTasks.find((row) => row.id === taskId);
      if (!task) continue;
      const dueLike = firstDate(parseDateValue(task.dueDate), parseDateValue(task.suggestedDate));
      if (!dueLike) continue;
      const weekIdx = weekIndexByStart.get(keyForDate(startOfIsoWeek(dueLike)));
      if (weekIdx === undefined) continue;

      const weekStart = weekStarts[weekIdx]!;
      const weekEnd = addDays(weekStart, 6);
      const preferredCompleted = firstDate(parseDateValue(task.dueDate), parseDateValue(task.suggestedDate), weekEnd)!;
      const clamped = preferredCompleted.getTime() > todayStart.getTime() ? addDays(todayStart, -1) : preferredCompleted;
      const completedDate = clamped.getTime() < weekStart.getTime() ? addDays(weekStart, 3) : clamped;

      plannedForTrial.push({
        trialId: trial.trialId,
        trialTitle: trial.trialTitle,
        taskId,
        weekIndex: weekIdx,
        completedDate,
      });
    }

    plannedUpdates.push(...plannedForTrial);

    const pastDueTasks = trialTasks.filter((task) => {
      const dueLike = firstDate(parseDateValue(task.dueDate), parseDateValue(task.suggestedDate));
      return dueLike ? dueLike.getTime() < todayStart.getTime() : false;
    });
    const pastDoneBefore = pastDueTasks.filter((task) => isDoneStatus(task.status)).length;
    const pastOpenBefore = pastDueTasks.length - pastDoneBefore;
    const pastDoneAfter = pastDoneBefore + plannedForTrial.length;
    const pastOpenAfter = Math.max(0, pastOpenBefore - plannedForTrial.length);

    const virtualTasks = trialTasks.map((task) => {
      const planned = plannedForTrial.find((entry) => entry.taskId === task.id);
      if (!planned) return task;
      return {
        ...task,
        status: "done" as const,
        completedDate: planned.completedDate,
        blockedSince: null,
        blockedReason: null,
      };
    });
    const { series: afterSeries } = buildSeriesForTasks(virtualTasks, windowWeeks);

    trialSummaries.push({
      trialId: trial.trialId,
      trialTitle: trial.trialTitle,
      plannedTaskCompletions: plannedForTrial.length,
      pastTasksBefore: { done: pastDoneBefore, open: pastOpenBefore, total: pastDueTasks.length },
      pastTasksAfter: { done: pastDoneAfter, open: pastOpenAfter, total: pastDueTasks.length },
      weeklyOpened: beforeSeries.opened,
      weeklyCompletedBefore: beforeSeries.completed,
      weeklyCompletedAfter: afterSeries.completed,
    });
  }

  const plannedByTaskId = new Map(plannedUpdates.map((row) => [row.taskId, row]));
  if (apply && plannedUpdates.length) {
    for (const update of plannedUpdates) {
      await db
        .update(mapTasks)
        .set({
          status: "done",
          completedDate: update.completedDate,
          blockedSince: null,
          blockedReason: null,
        })
        .where(eq(mapTasks.id, update.taskId));
    }
  }

  const allBeforeSeries = buildSeriesForTasks(tasks, windowWeeks).series;
  const allAfterSeries = buildSeriesForTasks(
    tasks.map((task) => {
      const planned = plannedByTaskId.get(task.id);
      if (!planned) return task;
      return {
        ...task,
        status: "done" as const,
        completedDate: planned.completedDate,
        blockedSince: null,
        blockedReason: null,
      };
    }),
    windowWeeks
  ).series;

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        windowWeeks,
        targetRatio,
        trialsProcessed: chosenTrials.length,
        plannedTaskCompletions: plannedUpdates.length,
        allTrialsWeekly: {
          labels: allBeforeSeries.labels,
          opened: allBeforeSeries.opened,
          completedBefore: allBeforeSeries.completed,
          completedAfter: allAfterSeries.completed,
        },
        trialSummaries,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[rebalance-past-task-completions] failed", error);
  process.exit(1);
});
