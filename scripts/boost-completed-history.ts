import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

type Candidate = {
  taskId: string;
  trialId: string;
  dueDate: Date | null;
  preferredWeek: number;
  priority: number;
};

type PlannedUpdate = {
  taskId: string;
  trialId: string;
  targetWeek: number;
  completedDate: Date;
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

function toRolling(values: number[]) {
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
  const maxRollingArg = argv.find((arg) => arg.startsWith("--max-rolling="));
  const minPerTrialArg = argv.find((arg) => arg.startsWith("--min-per-trial="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks < 4 || windowWeeks > 26) {
    throw new Error("weeks must be between 4 and 26");
  }

  const minRolling = minRollingArg ? Number(minRollingArg.replace("--min-rolling=", "")) : 8;
  const maxRolling = maxRollingArg ? Number(maxRollingArg.replace("--max-rolling=", "")) : 15;
  if (!Number.isFinite(minRolling) || !Number.isFinite(maxRolling) || minRolling < 1 || maxRolling <= minRolling) {
    throw new Error("min-rolling/max-rolling values are invalid");
  }

  const minPerTrial = minPerTrialArg ? Number(minPerTrialArg.replace("--min-per-trial=", "")) : 3;
  if (!Number.isFinite(minPerTrial) || minPerTrial < 0 || minPerTrial > 20) {
    throw new Error("min-per-trial must be between 0 and 20");
  }

  return {
    apply,
    mode,
    windowWeeks: Math.floor(windowWeeks),
    minRolling: Math.floor(minRolling),
    maxRolling: Math.floor(maxRolling),
    minPerTrial: Math.floor(minPerTrial),
  };
}

function chooseWeek(preferredWeek: number, deficits: number[]) {
  const candidates = deficits
    .map((value, index) => ({ value, index }))
    .filter((entry) => entry.value > 0);
  if (!candidates.length) return -1;

  return candidates.sort((a, b) => {
    const byDistance = Math.abs(a.index - preferredWeek) - Math.abs(b.index - preferredWeek);
    if (byDistance !== 0) return byDistance;
    return b.value - a.value;
  })[0]!.index;
}

async function main() {
  const { apply, mode, windowWeeks, minRolling, maxRolling, minPerTrial } = parseArgs(process.argv.slice(2));
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
    if (!preferredMap) continue;
    mapIdToTrialId.set(preferredMap.id, trial.id);
  }
  const mapIds = Array.from(mapIdToTrialId.keys());
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const todayStart = startOfDay(new Date());

  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const displayStart = Math.max(0, historyWeeks - windowWeeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
  const toDisplayIndex = (historyIndex: number | undefined) => {
    if (historyIndex === undefined) return undefined;
    const idx = historyIndex - displayStart;
    if (idx < 0 || idx >= windowWeeks) return undefined;
    return idx;
  };
  const historyIndexOf = (date: Date | null) => {
    if (!date) return undefined;
    return indexByWeek.get(keyForDate(startOfIsoWeek(date)));
  };

  const openedRaw = Array.from({ length: windowWeeks }, () => 0);
  const completedRaw = Array.from({ length: windowWeeks }, () => 0);
  const candidatesByTrial = new Map<string, Candidate[]>();
  for (const trialId of trialIds) candidatesByTrial.set(trialId, []);

  for (const task of tasks) {
    const trialId = mapIdToTrialId.get(task.mapId);
    if (!trialId) continue;

    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    const openedDisplayIndex = toDisplayIndex(historyIndexOf(openedAt));
    if (openedDisplayIndex !== undefined) openedRaw[openedDisplayIndex] += 1;

    const dueLike = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
    const preferredDisplayIndex = openedDisplayIndex ?? windowWeeks - 1;

    if (isDoneStatus(task.status)) {
      let completedAt = parseDateValue(task.completedDate);
      const updatedAt = parseDateValue(task.updatedAt);
      let completedDisplayIndex = toDisplayIndex(historyIndexOf(completedAt));
      if (completedDisplayIndex === undefined) {
        completedAt = updatedAt ?? openedAt;
        completedDisplayIndex = toDisplayIndex(historyIndexOf(completedAt));
      }
      if (completedDisplayIndex !== undefined) completedRaw[completedDisplayIndex] += 1;
      continue;
    }

    // Candidate from real task: we can complete it and place completion in a target historical week.
    const priority = dueLike
      ? dueLike.getTime() < todayStart.getTime()
        ? 0
        : 1
      : 2;
    const bucket = candidatesByTrial.get(trialId) ?? [];
    bucket.push({
      taskId: task.id,
      trialId,
      dueDate: dueLike,
      preferredWeek: preferredDisplayIndex,
      priority,
    });
    candidatesByTrial.set(trialId, bucket);
  }

  const openedRolling = toRolling(openedRaw);
  const completedRollingBefore = toRolling(completedRaw);

  const targetRaw = Array.from({ length: windowWeeks }, (_, weekIndex) => {
    if (weekIndex === 0) return 4;
    const opened = openedRolling[weekIndex] ?? 0;
    const base = Math.round(opened * 0.18);
    return Math.max(4, Math.min(7, base));
  });
  const targetRolling = toRolling(targetRaw).map((value, index) =>
    Math.max(minRolling, Math.min(maxRolling, value))
  );
  const normalizedTargetRaw = Array.from({ length: windowWeeks }, (_, index) => {
    if (index === 0) return Math.max(0, targetRolling[0] ?? 0);
    return Math.max(0, (targetRolling[index] ?? 0) - (targetRaw[index - 1] ?? 0));
  });

  const deficits = normalizedTargetRaw.map((target, index) => Math.max(0, target - (completedRaw[index] ?? 0)));

  for (const [trialId, bucket] of candidatesByTrial.entries()) {
    bucket.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aDue = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });
    candidatesByTrial.set(trialId, bucket);
  }

  const planned: PlannedUpdate[] = [];
  const updatesByTrial = new Map<string, number>();
  for (const trialId of trialIds) updatesByTrial.set(trialId, 0);

  // First pass: ensure each trial contributes.
  for (const trialId of trialIds) {
    let remaining = minPerTrial;
    const bucket = candidatesByTrial.get(trialId) ?? [];
    while (remaining > 0 && bucket.length > 0) {
      const candidate = bucket.shift()!;
      const weekIndex = chooseWeek(candidate.preferredWeek, deficits);
      if (weekIndex < 0) break;
      deficits[weekIndex] -= 1;
      completedRaw[weekIndex] += 1;
      remaining -= 1;

      const weekStart = displayWeekStarts[weekIndex]!;
      const offset = 2 + ((updatesByTrial.get(trialId) ?? 0) % 3);
      const targetDate = addDays(weekStart, offset);
      const completedDate = targetDate.getTime() >= todayStart.getTime() ? addDays(todayStart, -1) : targetDate;
      planned.push({ taskId: candidate.taskId, trialId, targetWeek: weekIndex, completedDate });
      updatesByTrial.set(trialId, (updatesByTrial.get(trialId) ?? 0) + 1);
    }
  }

  // Fill remaining deficits using all remaining candidates, round-robin by trial.
  const trialCursor = trialIds.slice();
  let guard = 0;
  while (deficits.some((value) => value > 0) && guard < 50000) {
    guard += 1;
    const trialId = trialCursor[guard % Math.max(1, trialCursor.length)]!;
    const bucket = candidatesByTrial.get(trialId) ?? [];
    if (!bucket.length) {
      const allEmpty = trialCursor.every((id) => (candidatesByTrial.get(id) ?? []).length === 0);
      if (allEmpty) break;
      continue;
    }

    const candidate = bucket.shift()!;
    const weekIndex = chooseWeek(candidate.preferredWeek, deficits);
    if (weekIndex < 0) break;
    deficits[weekIndex] -= 1;
    completedRaw[weekIndex] += 1;

    const weekStart = displayWeekStarts[weekIndex]!;
    const offset = 2 + ((updatesByTrial.get(trialId) ?? 0) % 3);
    const targetDate = addDays(weekStart, offset);
    const completedDate = targetDate.getTime() >= todayStart.getTime() ? addDays(todayStart, -1) : targetDate;
    planned.push({ taskId: candidate.taskId, trialId, targetWeek: weekIndex, completedDate });
    updatesByTrial.set(trialId, (updatesByTrial.get(trialId) ?? 0) + 1);
  }

  if (apply && planned.length > 0) {
    for (const update of planned) {
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

  const completedRollingAfter = toRolling(completedRaw);
  const labels = displayWeekStarts.map((date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)
  );

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        windowWeeks,
        minRolling,
        maxRolling,
        minPerTrial,
        updatesApplied: planned.length,
        labels,
        openedRolling,
        completedRollingBefore,
        completedRollingAfter,
        remainingDeficits: deficits,
        updatesByTrial: Object.fromEntries(
          Array.from(updatesByTrial.entries()).filter(([, value]) => value > 0)
        ),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[boost-completed-history] failed", error);
  process.exit(1);
});
