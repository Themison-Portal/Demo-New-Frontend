import { desc, eq, inArray, like, notLike } from "drizzle-orm";
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

function toRolling(raw: number[]) {
  return raw.map((_, index) => {
    const start = Math.max(0, index - 1);
    return raw.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
  });
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks < 4 || windowWeeks > 26) {
    throw new Error("weeks must be between 4 and 26");
  }

  return { apply, mode, windowWeeks: Math.floor(windowWeeks) };
}

type TrialSnapshot = {
  trialId: string;
  trialTitle: string;
  mapId: string;
  tasks: MapTask[];
};

async function main() {
  const { apply, mode, windowWeeks } = parseArgs(process.argv.slice(2));
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

  const chosen: TrialSnapshot[] = trialRows
    .map((trial) => {
      const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!preferredMap) return null;
      return {
        trialId: trial.id,
        trialTitle: trial.title,
        mapId: preferredMap.id,
        tasks: [] as MapTask[],
      };
    })
    .filter(Boolean) as TrialSnapshot[];
  const mapIds = chosen.map((entry) => entry.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const tasksByMapId = new Map<string, MapTask[]>();
  for (const task of tasks) {
    const list = tasksByMapId.get(task.mapId) ?? [];
    list.push(task);
    tasksByMapId.set(task.mapId, list);
  }
  for (const trial of chosen) {
    trial.tasks = tasksByMapId.get(trial.mapId) ?? [];
  }

  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const todayStart = startOfDay(new Date());
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const displayStart = Math.max(0, historyWeeks - windowWeeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const weekIndexByKey = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));

  const resolveDisplayIndex = (date: Date | null) => {
    if (!date) return undefined;
    const historyIndex = weekIndexByKey.get(keyForDate(startOfIsoWeek(date)));
    if (historyIndex === undefined) return undefined;
    const displayIndex = historyIndex - displayStart;
    if (displayIndex < 0 || displayIndex >= windowWeeks) return undefined;
    return displayIndex;
  };

  const plannedUpdates = new Map<string, Date>();
  const trialSummaries: Array<Record<string, unknown>> = [];

  for (const trial of chosen) {
    const openedRaw = Array.from({ length: windowWeeks }, () => 0);
    const completedRaw = Array.from({ length: windowWeeks }, () => 0);
    const doneIdsByWeek = new Map<number, string[]>();
    for (let i = 0; i < windowWeeks; i += 1) doneIdsByWeek.set(i, []);

    const doneTaskById = new Map<string, MapTask>();
    for (const task of trial.tasks) {
      const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
      const openedDisplayIndex = resolveDisplayIndex(openedAt);
      if (openedDisplayIndex !== undefined) openedRaw[openedDisplayIndex] += 1;

      if (!isDoneStatus(task.status)) continue;
      doneTaskById.set(task.id, task);

      let completedAt = parseDateValue(task.completedDate);
      const updatedAt = parseDateValue(task.updatedAt);
      let completedDisplayIndex = resolveDisplayIndex(completedAt);
      if (completedAt === null && completedDisplayIndex === undefined) {
        completedAt = updatedAt ?? openedAt;
        completedDisplayIndex = resolveDisplayIndex(completedAt);
      }
      if (completedDisplayIndex === undefined) continue;
      completedRaw[completedDisplayIndex] += 1;
      const list = doneIdsByWeek.get(completedDisplayIndex) ?? [];
      list.push(task.id);
      doneIdsByWeek.set(completedDisplayIndex, list);
    }

    const openedRolling = toRolling(openedRaw);
    const beforeCompletedRolling = toRolling(completedRaw);
    const moved = new Set<string>();
    const moves: Array<{ taskId: string; fromWeek: number; toWeek: number | "outside" }> = [];

    let guard = 0;
    while (guard < 5000) {
      guard += 1;
      const completedRolling = toRolling(completedRaw);
      let violationWeek = -1;
      for (let i = 0; i < windowWeeks; i += 1) {
        if ((completedRolling[i] ?? 0) > (openedRolling[i] ?? 0)) {
          violationWeek = i;
          break;
        }
      }
      if (violationWeek < 0) break;

      const sourceWeek = completedRaw[violationWeek]! > 0 ? violationWeek : Math.max(0, violationWeek - 1);
      if ((completedRaw[sourceWeek] ?? 0) <= 0) break;

      const sourceList = doneIdsByWeek.get(sourceWeek) ?? [];
      const taskId = sourceList.find((id) => !moved.has(id));
      if (!taskId) {
        completedRaw[sourceWeek] = Math.max(0, completedRaw[sourceWeek]! - 1);
        continue;
      }
      moved.add(taskId);
      sourceList.splice(sourceList.indexOf(taskId), 1);
      doneIdsByWeek.set(sourceWeek, sourceList);
      completedRaw[sourceWeek] = Math.max(0, completedRaw[sourceWeek]! - 1);

      // Try to move into a later week with slack; otherwise move outside visible window.
      let destinationWeek = -1;
      const recomputed = toRolling(completedRaw);
      for (let d = violationWeek + 1; d < windowWeeks; d += 1) {
        if ((recomputed[d] ?? 0) < (openedRolling[d] ?? 0)) {
          destinationWeek = d;
          break;
        }
      }

      if (destinationWeek >= 0) {
        completedRaw[destinationWeek] += 1;
        const destList = doneIdsByWeek.get(destinationWeek) ?? [];
        destList.push(taskId);
        doneIdsByWeek.set(destinationWeek, destList);
        const weekStart = displayWeekStarts[destinationWeek]!;
        const completedDate = addDays(weekStart, 3);
        plannedUpdates.set(
          taskId,
          completedDate.getTime() < todayStart.getTime() ? completedDate : addDays(todayStart, -1)
        );
        moves.push({ taskId, fromWeek: sourceWeek, toWeek: destinationWeek });
      } else {
        const outsideWeekStart = addDays(displayWeekStarts[0]!, -7);
        plannedUpdates.set(taskId, addDays(outsideWeekStart, 3));
        moves.push({ taskId, fromWeek: sourceWeek, toWeek: "outside" });
      }
    }

    const afterCompletedRolling = toRolling(completedRaw);
    const remainingViolations = afterCompletedRolling
      .map((value, index) => ({ index, opened: openedRolling[index] ?? 0, completed: value }))
      .filter((row) => row.completed > row.opened);

    trialSummaries.push({
      trialId: trial.trialId,
      trialTitle: trial.trialTitle,
      movedForNormalization: moves.length,
      beforeCompletedRolling,
      openedRolling,
      afterCompletedRolling,
      remainingViolations,
    });
  }

  if (apply && plannedUpdates.size > 0) {
    for (const [taskId, completedDate] of plannedUpdates.entries()) {
      await db.update(mapTasks).set({ completedDate }).where(eq(mapTasks.id, taskId));
    }
  }

  const violationsAfter = trialSummaries.reduce((sum, trial) => {
    const rows = Array.isArray((trial as any).remainingViolations) ? (trial as any).remainingViolations.length : 0;
    return sum + rows;
  }, 0);

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        windowWeeks,
        updatedTasks: plannedUpdates.size,
        trials: trialSummaries.length,
        totalViolationsAfter: violationsAfter,
        trialSummaries,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[normalize-completed-vs-opened] failed", error);
  process.exit(1);
});
