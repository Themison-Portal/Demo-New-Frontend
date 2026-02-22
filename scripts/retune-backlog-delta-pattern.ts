import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

type TrialTarget = {
  trialId: string;
  trialTitle: string;
  mapId: string;
};

type TaskPatch = {
  taskId: string;
  createdAt?: Date;
  updatedAt?: Date;
  status?: MapTask["status"];
  completedDate?: Date | null;
  dueDate?: Date | null;
  suggestedDate?: Date | null;
  blockedSince?: Date | null;
  blockedReason?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUSES = new Set(["done", "completed", "skipped", "cancelled"]);
const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};
const BLOCK_REASONS = [
  "Awaiting source document from sponsor",
  "Pending PI sign-off",
  "Lab vendor result delay",
  "Subject reschedule requested",
  "Staffing shortage this week",
];

// Event-shaped opened pattern for 12 weeks: spike W2-3, dip W4, busy W6-7, elevated W10-11, dip W12.
const OPENED_MULTIPLIERS_12 = [0.92, 1.17, 1.24, 0.76, 0.86, 1.0, 1.1, 1.03, 0.95, 1.04, 1.12, 0.81];

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

function toRolling(values: number[], rollingWindow = 2) {
  return values.map((_, index) => {
    const start = Math.max(0, index - rollingWindow + 1);
    return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
  });
}

function isDoneStatus(status: MapTask["status"]) {
  return DONE_STATUSES.has(normalizeToken(status));
}

function isBusinessDay(date: Date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function toBusinessDayOnOrAfter(source: Date) {
  const date = startOfDay(source);
  while (!isBusinessDay(date)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function toBusinessDayOnOrBefore(source: Date) {
  const date = startOfDay(source);
  while (!isBusinessDay(date)) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

function shiftBusinessDays(source: Date, days: number) {
  let date = startOfDay(source);
  let remaining = Math.abs(days);
  const direction = days >= 0 ? 1 : -1;

  if (remaining === 0) return toBusinessDayOnOrAfter(date);

  while (remaining > 0) {
    date = addDays(date, direction);
    if (isBusinessDay(date)) remaining -= 1;
  }
  return date;
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
    const weeksAhead = Math.max(1, Math.floor((dueWeekStart.getTime() - currentWeekStart.getTime()) / (7 * DAY_MS)));
    const weeksBack = Math.max(1, Math.min(historyWeeks - 1, weeksAhead));
    return addDays(currentWeekStart, -weeksBack * 7);
  }

  return createdAt;
}

function toTargetsFromMultipliers(total: number, multipliers: number[]) {
  const sumWeights = multipliers.reduce((sum, value) => sum + value, 0);
  const base = multipliers.map((weight) => Math.max(0, Math.round((total * weight) / Math.max(1e-9, sumWeights))));
  let diff = total - base.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  while (diff !== 0 && base.length > 0) {
    const index = cursor % base.length;
    if (diff > 0) {
      base[index] += 1;
      diff -= 1;
    } else if (base[index] > 0) {
      base[index] -= 1;
      diff += 1;
    }
    cursor += 1;
  }
  return base;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const gapArg = argv.find((arg) => arg.startsWith("--gap="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks !== 12) {
    throw new Error("weeks must be exactly 12 for event-pattern retune");
  }

  const targetGap = gapArg ? Number(gapArg.replace("--gap=", "")) : 110;
  if (!Number.isFinite(targetGap) || targetGap < 80 || targetGap > 150) {
    throw new Error("gap must be between 80 and 150");
  }

  return { apply, mode, windowWeeks, targetGap };
}

async function main() {
  const { apply, mode, windowWeeks, targetGap } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, mode, message: "No maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const now = new Date();
  const todayStart = startOfDay(now);
  const currentWeekStart = startOfIsoWeek(todayStart);
  const historyWeeks = Math.max(24, windowWeeks * 2);
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const displayStart = Math.max(0, historyWeeks - windowWeeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const displayStartWeek = displayWeekStarts[0]!;

  const doneTasks = tasks.filter((task) => isDoneStatus(task.status));
  const openTasks = tasks.filter((task) => !isDoneStatus(task.status));

  const targetOpenedTotal = doneTasks.length + targetGap;
  const targetCompletedTotal = doneTasks.length;
  const targetOpenedRaw = toTargetsFromMultipliers(targetOpenedTotal, OPENED_MULTIPLIERS_12);

  // Completed line tracks opened with a short lag and organic events.
  const openedMean = targetOpenedTotal / windowWeeks;
  let targetCompletedRaw = targetOpenedRaw.map((openedValue, index) => {
    const prev = targetOpenedRaw[Math.max(0, index - 1)] ?? openedValue;
    const prev2 = targetOpenedRaw[Math.max(0, index - 2)] ?? prev;
    let value = Math.round(openedValue * 0.44 + prev * 0.44 + prev2 * 0.12);
    if (index === 3) value -= Math.round(openedMean * 0.2); // quieter holiday/gap week
    if (index === 7) value += Math.round(openedMean * 0.26); // catch-up push
    if (index === 9 || index === 10) value += Math.round(openedMean * 0.1); // milestone lead-up
    if (index === 11) value -= Math.round(openedMean * 0.14); // slight wind-down
    return Math.max(1, value);
  });

  // Scale completed targets to exactly done task count.
  const completedSum = targetCompletedRaw.reduce((sum, value) => sum + value, 0);
  targetCompletedRaw = targetCompletedRaw.map((value) => Math.max(1, Math.round((value * targetCompletedTotal) / Math.max(1, completedSum))));
  let diffCompleted = targetCompletedTotal - targetCompletedRaw.reduce((sum, value) => sum + value, 0);
  let completedCursor = 0;
  while (diffCompleted !== 0) {
    const index = completedCursor % targetCompletedRaw.length;
    if (diffCompleted > 0) {
      targetCompletedRaw[index]! += 1;
      diffCompleted -= 1;
    } else if ((targetCompletedRaw[index] ?? 0) > 1) {
      targetCompletedRaw[index]! -= 1;
      diffCompleted += 1;
    }
    completedCursor += 1;
  }

  // Ensure one clear catch-up week where completed briefly exceeds opened.
  const openedRollingPreview = toRolling(targetOpenedRaw);
  const completedRollingPreview = toRolling(targetCompletedRaw);
  if ((completedRollingPreview[7] ?? 0) <= (openedRollingPreview[7] ?? 0)) {
    const needed = (openedRollingPreview[7] ?? 0) - (completedRollingPreview[7] ?? 0) + 14;
    targetCompletedRaw[7] = (targetCompletedRaw[7] ?? 0) + needed;
    // Borrow from weeks 10-11 first.
    const donors = [10, 9, 11, 6, 5];
    let remaining = needed;
    for (const donor of donors) {
      if (remaining <= 0) break;
      const available = Math.max(0, (targetCompletedRaw[donor] ?? 0) - 1);
      const take = Math.min(available, remaining);
      if (take > 0) {
        targetCompletedRaw[donor] = (targetCompletedRaw[donor] ?? 0) - take;
        remaining -= take;
      }
    }
  }

  const selectedOpenCount = Math.max(0, Math.min(openTasks.length, targetOpenedTotal - doneTasks.length));
  const openCandidates = [...openTasks].sort((a, b) => {
    const aDue = parseDateValue(a.dueDate) ?? parseDateValue(a.suggestedDate) ?? parseDateValue(a.updatedAt) ?? new Date(8640000000000000);
    const bDue = parseDateValue(b.dueDate) ?? parseDateValue(b.suggestedDate) ?? parseDateValue(b.updatedAt) ?? new Date(8640000000000000);
    return aDue.getTime() - bDue.getTime();
  });
  const selectedOpen = openCandidates.slice(0, selectedOpenCount);
  const selectedOpenIds = new Set(selectedOpen.map((task) => task.id));

  const selectedWindowTasks = [...doneTasks, ...selectedOpen];
  const selectedWindowIds = new Set(selectedWindowTasks.map((task) => task.id));

  const rng = seededRandom(`retune:${mode}:${windowWeeks}`);
  const dayOffsetInWeek = () => drawInt(rng, 0, 3);

  const sortedWindowTasks = [...selectedWindowTasks].sort((a, b) => {
    const aDue = parseDateValue(a.dueDate) ?? parseDateValue(a.suggestedDate) ?? parseDateValue(a.updatedAt) ?? new Date(0);
    const bDue = parseDateValue(b.dueDate) ?? parseDateValue(b.suggestedDate) ?? parseDateValue(b.updatedAt) ?? new Date(0);
    return aDue.getTime() - bDue.getTime();
  });

  const dueWeekStart = (task: MapTask) => startOfIsoWeek(parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate) ?? todayStart);
  const week12SafeIds = new Set(
    sortedWindowTasks
      .filter((task) => dueWeekStart(task).getTime() <= currentWeekStart.getTime())
      .map((task) => task.id)
  );

  const openedWeekByTaskId = new Map<string, number>();
  const createdAtByTaskId = new Map<string, Date>();
  const unassigned = [...sortedWindowTasks];
  for (let weekIndex = 0; weekIndex < windowWeeks; weekIndex += 1) {
    const weekTarget = targetOpenedRaw[weekIndex] ?? 0;
    const weekStart = displayWeekStarts[weekIndex]!;
    let assigned = 0;

    while (assigned < weekTarget && unassigned.length > 0) {
      let pickIndex = 0;
      if (weekIndex === windowWeeks - 1) {
        const safeIndex = unassigned.findIndex((task) => week12SafeIds.has(task.id));
        if (safeIndex >= 0) pickIndex = safeIndex;
      }
      const [picked] = unassigned.splice(pickIndex, 1);
      if (!picked) break;

      const createdAt = addDays(weekStart, dayOffsetInWeek());
      createdAtByTaskId.set(picked.id, createdAt);
      openedWeekByTaskId.set(picked.id, weekIndex);
      assigned += 1;
    }
  }

  // Spill any still-unassigned selected-window tasks into the last non-current week.
  while (unassigned.length > 0) {
    const picked = unassigned.shift()!;
    const spillWeek = windowWeeks - 2;
    const weekStart = displayWeekStarts[spillWeek]!;
    const createdAt = addDays(weekStart, dayOffsetInWeek());
    createdAtByTaskId.set(picked.id, createdAt);
    openedWeekByTaskId.set(picked.id, spillWeek);
  }

  // Non-window tasks: place createdAt before the displayed range so they do not inflate opened volume.
  for (const task of tasks) {
    if (selectedWindowIds.has(task.id)) continue;
    const weeksBack = drawInt(rng, 1, 8);
    const base = addDays(displayStartWeek, -weeksBack * 7);
    createdAtByTaskId.set(task.id, addDays(base, drawInt(rng, 0, 4)));
  }

  const completionAssignments = new Map<string, { completedDate: Date; weekIndex: number }>();
  const donePool = [...doneTasks].sort((a, b) => {
    const aOpened = openedWeekByTaskId.get(a.id) ?? 0;
    const bOpened = openedWeekByTaskId.get(b.id) ?? 0;
    if (aOpened !== bOpened) return aOpened - bOpened;
    const aDue = parseDateValue(a.dueDate) ?? parseDateValue(a.suggestedDate) ?? todayStart;
    const bDue = parseDateValue(b.dueDate) ?? parseDateValue(b.suggestedDate) ?? todayStart;
    if (aDue.getTime() !== bDue.getTime()) return aDue.getTime() - bDue.getTime();
    return stableHash(a.id) - stableHash(b.id);
  });

  for (let weekIndex = 0; weekIndex < windowWeeks; weekIndex += 1) {
    const target = targetCompletedRaw[weekIndex] ?? 0;
    const weekStart = displayWeekStarts[weekIndex]!;
    let assigned = 0;

    while (assigned < target && donePool.length > 0) {
      const preferredIndex = donePool.findIndex((task) => (openedWeekByTaskId.get(task.id) ?? 0) <= weekIndex);
      const takeIndex = preferredIndex >= 0 ? preferredIndex : 0;
      const [picked] = donePool.splice(takeIndex, 1);
      if (!picked) break;

      const createdAt = createdAtByTaskId.get(picked.id) ?? parseDateValue(picked.createdAt) ?? weekStart;
      let completedDate = toBusinessDayOnOrAfter(addDays(weekStart, drawInt(rng, 2, 4)));
      if (completedDate.getTime() < createdAt.getTime()) {
        completedDate = toBusinessDayOnOrAfter(addDays(createdAt, drawInt(rng, 0, 2)));
      }
      completionAssignments.set(picked.id, { completedDate, weekIndex });
      assigned += 1;
    }
  }

  // Any remainder is assigned into the catch-up week so completed volume stays active in-window.
  const catchUpWeek = Math.min(windowWeeks - 1, 7);
  const catchUpStart = displayWeekStarts[catchUpWeek]!;
  while (donePool.length > 0) {
    const picked = donePool.shift()!;
    const completedDate = toBusinessDayOnOrAfter(addDays(catchUpStart, drawInt(rng, 2, 4)));
    completionAssignments.set(picked.id, { completedDate, weekIndex: catchUpWeek });
  }

  // Completion lag buckets (on/before due, 1-3d late, 4-7d late, 8-15d late).
  const totalCompleted = doneTasks.length;
  let onTimeRemaining = Math.round(totalCompleted * 0.4);
  let shortLateRemaining = Math.round(totalCompleted * 0.35);
  let lateRemaining = Math.round(totalCompleted * 0.15);
  let veryLateRemaining = Math.max(0, totalCompleted - onTimeRemaining - shortLateRemaining - lateRemaining);

  const pickLagBucket = () => {
    const buckets = [
      { key: "on_time", remaining: onTimeRemaining },
      { key: "short_late", remaining: shortLateRemaining },
      { key: "late", remaining: lateRemaining },
      { key: "very_late", remaining: veryLateRemaining },
    ].filter((bucket) => bucket.remaining > 0);
    const totalRemaining = buckets.reduce((sum, bucket) => sum + bucket.remaining, 0);
    let roll = drawInt(rng, 1, Math.max(1, totalRemaining));
    for (const bucket of buckets) {
      roll -= bucket.remaining;
      if (roll <= 0) {
        if (bucket.key === "on_time") onTimeRemaining -= 1;
        if (bucket.key === "short_late") shortLateRemaining -= 1;
        if (bucket.key === "late") lateRemaining -= 1;
        if (bucket.key === "very_late") veryLateRemaining -= 1;
        return bucket.key;
      }
    }
    return "short_late" as const;
  };

  const patches = new Map<string, TaskPatch>();

  const setPatch = (taskId: string, patch: TaskPatch) => {
    const current = patches.get(taskId) ?? { taskId };
    patches.set(taskId, { ...current, ...patch });
  };

  for (const task of tasks) {
    const createdAt = createdAtByTaskId.get(task.id);
    if (createdAt) {
      setPatch(task.id, { createdAt });
    }
  }

  const lagSummary = { onTimeOrEarly: 0, late1to3: 0, late4to7: 0, late8to15: 0 };

  for (const task of doneTasks) {
    const assignment = completionAssignments.get(task.id)!;
    let completedDate = assignment.completedDate;
    const createdAt = createdAtByTaskId.get(task.id) ?? parseDateValue(task.createdAt) ?? parseDateValue(task.updatedAt) ?? addDays(displayStartWeek, -7);

    const bucket = pickLagBucket();
    let lagDays: number;
    if (bucket === "on_time") {
      lagDays = -drawInt(rng, 0, 2);
      lagSummary.onTimeOrEarly += 1;
    } else if (bucket === "short_late") {
      lagDays = drawInt(rng, 1, 3);
      lagSummary.late1to3 += 1;
    } else if (bucket === "late") {
      lagDays = drawInt(rng, 4, 7);
      lagSummary.late4to7 += 1;
    } else {
      lagDays = drawInt(rng, 8, 15);
      lagSummary.late8to15 += 1;
    }

    let dueDate = shiftBusinessDays(completedDate, -lagDays);
    if (dueDate.getTime() <= createdAt.getTime()) {
      const candidateDue = toBusinessDayOnOrAfter(addDays(createdAt, drawInt(rng, 1, 3)));
      dueDate = candidateDue.getTime() <= completedDate.getTime() ? candidateDue : toBusinessDayOnOrBefore(completedDate);
    }
    if (completedDate.getTime() < dueDate.getTime()) {
      completedDate = toBusinessDayOnOrAfter(dueDate);
    }
    const openedWeek = openedWeekByTaskId.get(task.id) ?? 0;
    if (openedWeek >= windowWeeks - 1 && startOfIsoWeek(dueDate).getTime() > currentWeekStart.getTime()) {
      dueDate = toBusinessDayOnOrAfter(addDays(currentWeekStart, drawInt(rng, 1, 4)));
    }

    const suggestedDate = addDays(dueDate, -drawInt(rng, 1, 4));

    setPatch(task.id, {
      status: task.status,
      completedDate,
      dueDate,
      suggestedDate,
      blockedSince: null,
      blockedReason: null,
      updatedAt: completedDate,
    });
  }

  // Keep a small realistic set of blocked open tasks among window-visible open work.
  const selectedOpenInWindow = selectedOpen.filter((task) => selectedWindowIds.has(task.id));
  const blockedTarget = Math.max(5, Math.min(12, Math.round(selectedOpenInWindow.length * 0.08)));
  const blockedOpen = [...selectedOpenInWindow]
    .sort((a, b) => {
      const aDue = parseDateValue(a.dueDate) ?? parseDateValue(a.suggestedDate) ?? parseDateValue(a.updatedAt) ?? todayStart;
      const bDue = parseDateValue(b.dueDate) ?? parseDateValue(b.suggestedDate) ?? parseDateValue(b.updatedAt) ?? todayStart;
      return aDue.getTime() - bDue.getTime();
    })
    .slice(0, blockedTarget);
  const blockedIds = new Set(blockedOpen.map((task) => task.id));

  for (const task of selectedOpenInWindow) {
    const openedWeek = openedWeekByTaskId.get(task.id) ?? 0;
    const currentDue = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
    const dueShouldBeCurrentWeek =
      openedWeek >= windowWeeks - 1 && (!currentDue || startOfIsoWeek(currentDue).getTime() > currentWeekStart.getTime());
    const dueDate = dueShouldBeCurrentWeek ? toBusinessDayOnOrAfter(addDays(currentWeekStart, drawInt(rng, 1, 4))) : currentDue;
    const suggestedDate = dueDate ? addDays(dueDate, -drawInt(rng, 1, 4)) : null;

    if (blockedIds.has(task.id)) {
      const dueLike = dueDate ?? addDays(todayStart, -3);
      const blockedSince = addDays(dueLike, drawInt(rng, 2, 5));
      setPatch(task.id, {
        status: "blocked",
        completedDate: null,
        dueDate,
        suggestedDate,
        blockedSince: blockedSince.getTime() > todayStart.getTime() ? addDays(todayStart, -1) : blockedSince,
        blockedReason: BLOCK_REASONS[drawInt(rng, 0, BLOCK_REASONS.length - 1)]!,
      });
    } else {
      setPatch(task.id, {
        completedDate: null,
        dueDate,
        suggestedDate,
      });
    }
  }

  // Build virtual preview for verification.
  const patchedTasks = tasks.map((task) => {
    const patch = patches.get(task.id);
    if (!patch) return task;
    return {
      ...task,
      createdAt: patch.createdAt ?? task.createdAt,
      updatedAt: patch.updatedAt ?? task.updatedAt,
      status: patch.status ?? task.status,
      completedDate: patch.completedDate === undefined ? task.completedDate : patch.completedDate,
      dueDate: patch.dueDate === undefined ? task.dueDate : patch.dueDate,
      suggestedDate: patch.suggestedDate === undefined ? task.suggestedDate : patch.suggestedDate,
      blockedSince: patch.blockedSince === undefined ? task.blockedSince : patch.blockedSince,
      blockedReason: patch.blockedReason === undefined ? task.blockedReason : patch.blockedReason,
    } as MapTask;
  });

  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));
  const resolveDisplayIndex = (date: Date | null) => {
    if (!date) return undefined;
    const historyIndex = indexByWeek.get(keyForDate(startOfIsoWeek(date)));
    if (historyIndex === undefined) return undefined;
    const displayIndex = historyIndex - displayStart;
    if (displayIndex < 0 || displayIndex >= windowWeeks) return undefined;
    return displayIndex;
  };

  const openedRawAfter = Array.from({ length: windowWeeks }, () => 0);
  const completedRawAfter = Array.from({ length: windowWeeks }, () => 0);

  for (const task of patchedTasks) {
    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    const openedIndex = resolveDisplayIndex(openedAt);
    if (openedIndex !== undefined) openedRawAfter[openedIndex] += 1;

    if (!isDoneStatus(task.status)) continue;
    let completedAt = parseDateValue(task.completedDate);
    const updatedAt = parseDateValue(task.updatedAt);
    let completedIndex = resolveDisplayIndex(completedAt);
    if (completedIndex === undefined) {
      completedAt = updatedAt ?? openedAt;
      completedIndex = resolveDisplayIndex(completedAt);
    }
    if (completedIndex !== undefined) completedRawAfter[completedIndex] += 1;
  }

  const openedRollingAfter = toRolling(openedRawAfter);
  const completedRollingAfter = toRolling(completedRawAfter);
  const netBacklogAfter = openedRawAfter.reduce((sum, value, index) => sum + value - (completedRawAfter[index] ?? 0), 0);

  if (apply) {
    for (const patch of patches.values()) {
      const setPayload: Record<string, unknown> = {};
      if (patch.createdAt !== undefined) setPayload.createdAt = patch.createdAt;
      if (patch.updatedAt !== undefined) setPayload.updatedAt = patch.updatedAt;
      if (patch.status !== undefined) setPayload.status = patch.status;
      if (patch.completedDate !== undefined) setPayload.completedDate = patch.completedDate;
      if (patch.dueDate !== undefined) setPayload.dueDate = patch.dueDate;
      if (patch.suggestedDate !== undefined) setPayload.suggestedDate = patch.suggestedDate;
      if (patch.blockedSince !== undefined) setPayload.blockedSince = patch.blockedSince;
      if (patch.blockedReason !== undefined) setPayload.blockedReason = patch.blockedReason;
      if (Object.keys(setPayload).length === 0) continue;

      await db.update(mapTasks).set(setPayload).where(eq(mapTasks.id, patch.taskId));
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        windowWeeks,
        targetGap,
        taskCount: tasks.length,
        doneCount: doneTasks.length,
        openCount: openTasks.length,
        selectedWindowCount: selectedWindowTasks.length,
        selectedOpenCount,
        blockedOpenCount: blockedIds.size,
        targetOpenedRaw,
        targetCompletedRaw,
        openedRawAfter,
        completedRawAfter,
        openedRollingAfter,
        completedRollingAfter,
        netBacklogAfter,
        lagSummary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[retune-backlog-delta-pattern] failed", error);
  process.exit(1);
});
