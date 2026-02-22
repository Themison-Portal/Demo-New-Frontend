import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

type TrialTarget = {
  trialId: string;
  trialTitle: string;
  mapId: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
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

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = stableHash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function drawInt(nextRandom: () => number, min: number, max: number) {
  if (max <= min) return min;
  return Math.floor(nextRandom() * (max - min + 1)) + min;
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
      Math.floor((dueWeekStart.getTime() - currentWeekStart.getTime()) / (7 * DAY_MS))
    );
    const weeksBack = Math.max(1, Math.min(historyWeeks - 1, weeksAhead));
    return addDays(currentWeekStart, -weeksBack * 7);
  }

  return createdAt;
}

function isDoneStatus(status: MapTask["status"]) {
  return DONE_STATUSES.has(normalizeToken(status));
}

function toRolling(values: number[], rollingWindow = 2) {
  return values.map((_, index) => {
    const start = Math.max(0, index - rollingWindow + 1);
    return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
  });
}

function buildOpenedRolling(tasks: MapTask[], weeks: number) {
  const historyWeeks = Math.max(24, weeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const displayStart = Math.max(0, historyWeeks - weeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
  const openedRaw = Array.from({ length: weeks }, () => 0);

  for (const task of tasks) {
    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    if (!openedAt) continue;
    const historyIndex = indexByWeek.get(keyForDate(startOfIsoWeek(openedAt)));
    if (historyIndex === undefined) continue;
    const displayIndex = historyIndex - displayStart;
    if (displayIndex < 0 || displayIndex >= weeks) continue;
    openedRaw[displayIndex] += 1;
  }

  const labels = displayWeekStarts.map(
    (date) =>
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(date)
  );

  return { labels, openedRaw, openedRolling: toRolling(openedRaw) };
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const weeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(weeks) || weeks < 8 || weeks > 26) {
    throw new Error("weeks must be between 8 and 26");
  }

  return { apply, mode, weeks: Math.floor(weeks) };
}

async function main() {
  const { apply, mode, weeks } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, mode, weeks, message: "No trials found." }, null, 2));
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
      return {
        trialId: trial.id,
        trialTitle: trial.title,
        mapId: preferredMap.id,
      };
    })
    .filter(Boolean) as TrialTarget[];

  const mapIds = chosenTrials.map((entry) => entry.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, weeks, message: "No maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const today = new Date();
  const currentWeekStart = startOfIsoWeek(today);
  const historyFloor = addDays(currentWeekStart, -Math.max(weeks, 12) * 7);

  const plans: Array<{ taskId: string; createdAt: Date }> = [];

  for (const task of tasks) {
    const anchor =
      parseDateValue(task.suggestedDate) ??
      parseDateValue(task.dueDate) ??
      parseDateValue(task.completedDate) ??
      parseDateValue(task.updatedAt);
    const anchorWeek = anchor ? startOfIsoWeek(anchor) : addDays(currentWeekStart, -7);
    const createdAt = parseDateValue(task.createdAt) ?? parseDateValue(task.updatedAt);
    if (!createdAt) continue;
    if (createdAt.getTime() < currentWeekStart.getTime()) continue;

    const taskRand = seededRandom(`${task.id}:reanchor`);
    let createdWeekStart: Date;
    if (anchorWeek.getTime() >= currentWeekStart.getTime()) {
      const weeksAhead = Math.max(0, Math.floor((anchorWeek.getTime() - currentWeekStart.getTime()) / (7 * DAY_MS)));
      const weeksBack = Math.max(1, Math.min(12, weeksAhead + 1 + drawInt(taskRand, 0, 2)));
      createdWeekStart = addDays(currentWeekStart, -weeksBack * 7);
    } else {
      const ageWeeks = Math.max(1, Math.floor((currentWeekStart.getTime() - anchorWeek.getTime()) / (7 * DAY_MS)));
      const jitterBack = Math.min(3, drawInt(taskRand, 0, 2));
      createdWeekStart = addDays(currentWeekStart, -(ageWeeks + jitterBack) * 7);
    }
    if (createdWeekStart.getTime() < historyFloor.getTime()) {
      createdWeekStart = new Date(historyFloor.getTime());
    }

    let rebasedCreatedAt = addDays(createdWeekStart, drawInt(taskRand, 1, 4));
    if (rebasedCreatedAt.getTime() >= currentWeekStart.getTime()) {
      rebasedCreatedAt = addDays(currentWeekStart, -1);
    }

    plans.push({ taskId: task.id, createdAt: rebasedCreatedAt });
  }

  if (apply) {
    for (const plan of plans) {
      await db
        .update(mapTasks)
        .set({ createdAt: plan.createdAt })
        .where(eq(mapTasks.id, plan.taskId));
    }
  }

  const createdAtById = new Map(plans.map((plan) => [plan.taskId, plan.createdAt]));
  const virtualAfter = tasks.map((task) => {
    const updatedCreatedAt = createdAtById.get(task.id);
    if (!updatedCreatedAt) return task;
    return { ...task, createdAt: updatedCreatedAt };
  });

  const openedBefore = buildOpenedRolling(tasks, weeks);
  const openedAfter = buildOpenedRolling(virtualAfter, weeks);

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        weeks,
        reanchoredTasks: plans.length,
        openedBefore,
        openedAfter,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[reanchor-future-task-opened-dates] failed", error);
  process.exit(1);
});
