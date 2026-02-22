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

function rolling(values: number[]) {
  return values.map((_, index) => {
    const start = Math.max(0, index - 1);
    return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
  });
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const minRollingArg = argv.find((arg) => arg.startsWith("--min-rolling="));
  const keepLatestArg = argv.find((arg) => arg.startsWith("--keep-latest="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks < 4 || windowWeeks > 26) {
    throw new Error("weeks must be between 4 and 26");
  }

  const minRolling = minRollingArg ? Number(minRollingArg.replace("--min-rolling=", "")) : 3;
  if (!Number.isFinite(minRolling) || minRolling < 1 || minRolling > 20) {
    throw new Error("min-rolling must be between 1 and 20");
  }

  const keepLatest = keepLatestArg ? Number(keepLatestArg.replace("--keep-latest=", "")) : 2;
  if (!Number.isFinite(keepLatest) || keepLatest < 0 || keepLatest > 20) {
    throw new Error("keep-latest must be between 0 and 20");
  }

  return {
    apply,
    mode,
    windowWeeks: Math.floor(windowWeeks),
    minRolling: Math.floor(minRolling),
    keepLatest: Math.floor(keepLatest),
  };
}

async function main() {
  const { apply, mode, windowWeeks, minRolling, keepLatest } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, mode, windowWeeks, minRolling, message: "No trials found." }, null, 2));
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

  const chosenMaps = trialRows
    .map((trial) => {
      const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!preferredMap) return null;
      return preferredMap.id;
    })
    .filter(Boolean) as string[];
  if (!chosenMaps.length) {
    console.log(JSON.stringify({ apply, mode, windowWeeks, minRolling, message: "No maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, chosenMaps));

  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const displayStart = Math.max(0, weekStarts.length - windowWeeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
  const resolveHistoryIndex = (date: Date | null) => {
    if (!date) return undefined;
    return indexByWeek.get(keyForDate(startOfIsoWeek(date)));
  };
  const toDisplayIndex = (historyIndex: number | undefined) => {
    if (historyIndex === undefined) return undefined;
    const index = historyIndex - displayStart;
    if (index < 0 || index >= windowWeeks) return undefined;
    return index;
  };

  const rawOpened = Array.from({ length: windowWeeks }, () => 0);
  const rawCompleted = Array.from({ length: windowWeeks }, () => 0);
  const doneTaskIdsByWeek = new Map<number, string[]>();
  for (let i = 0; i < windowWeeks; i += 1) doneTaskIdsByWeek.set(i, []);

  const doneTaskById = new Map<string, MapTask>();

  for (const task of tasks) {
    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    const openedDisplayIndex = toDisplayIndex(resolveHistoryIndex(openedAt));
    if (openedDisplayIndex !== undefined) rawOpened[openedDisplayIndex] += 1;

    if (!isDoneStatus(task.status)) continue;
    doneTaskById.set(task.id, task);

    let completedAt = parseDateValue(task.completedDate);
    const updatedAt = parseDateValue(task.updatedAt);
    let completedDisplayIndex = toDisplayIndex(resolveHistoryIndex(completedAt));
    if (completedDisplayIndex === undefined) {
      completedAt = updatedAt ?? openedAt;
      completedDisplayIndex = toDisplayIndex(resolveHistoryIndex(completedAt));
    }
    if (completedDisplayIndex === undefined) continue;
    rawCompleted[completedDisplayIndex] += 1;
    const list = doneTaskIdsByWeek.get(completedDisplayIndex) ?? [];
    list.push(task.id);
    doneTaskIdsByWeek.set(completedDisplayIndex, list);
  }

  const beforeRolling = rolling(rawCompleted);
  const movedTaskIds = new Set<string>();
  const updates = new Map<string, Date>();
  const moves: Array<{ taskId: string; fromWeek: number; toWeek: number }> = [];

  let guard = 0;
  while (guard < 1000) {
    guard += 1;
    const currentRolling = rolling(rawCompleted);
    const targetWeek = (() => {
      for (let index = 1; index < windowWeeks - 1; index += 1) {
        if (currentRolling[index]! < minRolling) return index;
      }
      return -1;
    })();
    if (targetWeek < 0) break;

    let donorWeek = -1;
    let donorCount = -1;
    for (let index = windowWeeks - 1; index >= 0; index -= 1) {
      const reserve = index === windowWeeks - 1 ? keepLatest : 1;
      const count = rawCompleted[index] ?? 0;
      if (count <= reserve) continue;
      if (index === targetWeek) continue;
      if (count > donorCount) {
        donorWeek = index;
        donorCount = count;
      }
    }
    if (donorWeek < 0) break;

    const donorList = doneTaskIdsByWeek.get(donorWeek) ?? [];
    const candidateTaskId = donorList.find((taskId) => !movedTaskIds.has(taskId));
    if (!candidateTaskId) {
      rawCompleted[donorWeek] = Math.max(0, rawCompleted[donorWeek]! - 1);
      continue;
    }

    movedTaskIds.add(candidateTaskId);
    donorList.splice(donorList.indexOf(candidateTaskId), 1);
    doneTaskIdsByWeek.set(donorWeek, donorList);
    rawCompleted[donorWeek] = Math.max(0, rawCompleted[donorWeek]! - 1);
    rawCompleted[targetWeek] = (rawCompleted[targetWeek] ?? 0) + 1;
    const targetList = doneTaskIdsByWeek.get(targetWeek) ?? [];
    targetList.push(candidateTaskId);
    doneTaskIdsByWeek.set(targetWeek, targetList);

    const weekStart = displayWeekStarts[targetWeek]!;
    const dayOffset = 2 + (targetList.length % 3);
    updates.set(candidateTaskId, addDays(weekStart, dayOffset));
    moves.push({ taskId: candidateTaskId, fromWeek: donorWeek, toWeek: targetWeek });
  }

  if (apply && updates.size > 0) {
    for (const [taskId, completedDate] of updates.entries()) {
      await db.update(mapTasks).set({ completedDate }).where(eq(mapTasks.id, taskId));
    }
  }

  const afterRolling = rolling(rawCompleted);

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        windowWeeks,
        minRolling,
        keepLatest,
        movedCompletions: updates.size,
        labels: displayWeekStarts.map((date) =>
          new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)
        ),
        openedRolling: rolling(rawOpened),
        completedRollingBefore: beforeRolling,
        completedRollingAfter: afterRolling,
        movesPreview: moves.slice(0, 25),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[redistribute-completed-history] failed", error);
  process.exit(1);
});
