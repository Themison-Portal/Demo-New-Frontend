import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

type TrialTarget = {
  trialId: string;
  trialTitle: string;
  mapId: string;
  status: string;
  phase: string;
};

type CompletionPlan = {
  taskId: string;
  completedDate: Date;
  targetWeek: number;
  dueDate?: Date | null;
  suggestedDate?: Date | null;
};

type BlockPlan = {
  taskId: string;
  blockedSince: Date;
  blockedReason: string;
  dueDate?: Date | null;
  suggestedDate?: Date | null;
};

type TaskContext = {
  task: MapTask;
  dueLike: Date | null;
  openedAnchor: Date | null;
  isHistoricalOpen: boolean;
  isOlderOpen: boolean;
  isRecentOpen: boolean;
  isPastDue: boolean;
};

type WeeklySnapshot = {
  labels: string[];
  weekStarts: Date[];
  openedRaw: number[];
  completedRaw: number[];
  openedRolling: number[];
  completedRolling: number[];
  resolveDisplayWeekIndex: (date: Date | null) => number | undefined;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);
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

function drawWeightedIndex(weights: number[], nextRandom: () => number) {
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return drawInt(nextRandom, 0, Math.max(0, weights.length - 1));
  let roll = nextRandom() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= Math.max(0, weights[index] ?? 0);
    if (roll <= 0) return index;
  }
  return Math.max(0, weights.length - 1);
}

function pickWeightedUnique<T>(items: T[], count: number, weightFor: (item: T) => number, nextRandom: () => number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const weights = pool.map((item) => Math.max(0, weightFor(item)));
    const index = drawWeightedIndex(weights, nextRandom);
    const [selected] = pool.splice(index, 1);
    if (selected) picked.push(selected);
  }
  return picked;
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

function isBusinessDay(source: Date) {
  const day = source.getDay();
  return day !== 0 && day !== 6;
}

function toBusinessDayOnOrAfter(source: Date) {
  const date = startOfDay(source);
  while (!isBusinessDay(date)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function addBusinessDays(source: Date, businessDays: number) {
  let date = toBusinessDayOnOrAfter(source);
  let remaining = Math.max(0, businessDays);
  while (remaining > 0) {
    date = addDays(date, 1);
    if (isBusinessDay(date)) {
      remaining -= 1;
    }
  }
  return date;
}

function sampleCompletionLag(nextRandom: () => number) {
  const roll = nextRandom();
  if (roll < 0.18) return 0;
  if (roll < 0.72) return 1 + drawInt(nextRandom, 0, 2); // 1-3 business days
  if (roll < 0.95) return 4 + drawInt(nextRandom, 0, 1); // 4-5 business days
  return 6 + drawInt(nextRandom, 0, 3); // rare long-late completions
}

function diffDays(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

function clampDate(date: Date, minDate: Date, maxDate: Date) {
  if (date.getTime() < minDate.getTime()) return new Date(minDate.getTime());
  if (date.getTime() > maxDate.getTime()) return new Date(maxDate.getTime());
  return date;
}

function getHistoricalDueWindow(args: {
  openedAnchor: Date;
  fallbackWeekStart: Date;
  todayStart: Date;
  nextRandom: () => number;
}) {
  const { openedAnchor, fallbackWeekStart, todayStart, nextRandom } = args;
  const yesterday = addDays(todayStart, -1);
  const baseStart = toBusinessDayOnOrAfter(addDays(openedAnchor, drawInt(nextRandom, 1, 4)));
  const maxFromOpen = toBusinessDayOnOrAfter(addDays(openedAnchor, drawInt(nextRandom, 5, 14)));
  const weekFallback = toBusinessDayOnOrAfter(addDays(fallbackWeekStart, drawInt(nextRandom, 2, 5)));
  const minDue = clampDate(baseStart, addDays(todayStart, -120), yesterday);
  let maxDue = clampDate(maxFromOpen, minDue, yesterday);
  if (maxDue.getTime() < minDue.getTime()) maxDue = minDue;

  let dueDate = minDue;
  const spread = Math.max(0, diffDays(minDue, maxDue));
  if (spread > 0) {
    dueDate = addDays(minDue, drawInt(nextRandom, 0, spread));
    dueDate = toBusinessDayOnOrAfter(clampDate(dueDate, minDue, maxDue));
  }

  if (!Number.isFinite(dueDate.getTime()) || dueDate.getTime() >= todayStart.getTime()) {
    dueDate = clampDate(weekFallback, addDays(todayStart, -28), yesterday);
  }

  const suggestedGap = drawInt(nextRandom, 1, 4);
  const suggestedDate = addDays(dueDate, -suggestedGap);
  return {
    dueDate,
    suggestedDate: suggestedDate.getTime() > dueDate.getTime() ? dueDate : suggestedDate,
  };
}

function toRolling(values: number[], rollingWindow = 2) {
  return values.map((_, index) => {
    const start = Math.max(0, index - rollingWindow + 1);
    return values.slice(start, index + 1).reduce((sum, value) => sum + value, 0);
  });
}

function buildWeeklySnapshot(tasks: MapTask[], windowWeeks: number): WeeklySnapshot {
  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(new Date());
  const weekStarts = Array.from({ length: historyWeeks }, (_, index) =>
    addDays(currentWeekStart, (index - (historyWeeks - 1)) * 7)
  );
  const displayStart = Math.max(0, weekStarts.length - windowWeeks);
  const displayWeekStarts = weekStarts.slice(displayStart);
  const indexByWeek = new Map<string, number>(weekStarts.map((date, index) => [keyForDate(date), index]));

  const resolveDisplayWeekIndex = (date: Date | null) => {
    if (!date) return undefined;
    const historyIndex = indexByWeek.get(keyForDate(startOfIsoWeek(date)));
    if (historyIndex === undefined) return undefined;
    const displayIndex = historyIndex - displayStart;
    if (displayIndex < 0 || displayIndex >= windowWeeks) return undefined;
    return displayIndex;
  };

  const openedRaw = Array.from({ length: windowWeeks }, () => 0);
  const completedRaw = Array.from({ length: windowWeeks }, () => 0);

  for (const task of tasks) {
    const openedAt = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
    const openedIndex = resolveDisplayWeekIndex(openedAt);
    if (openedIndex !== undefined) {
      openedRaw[openedIndex] += 1;
    }

    if (!isDoneStatus(task.status)) continue;

    let completedAt = parseDateValue(task.completedDate);
    const updatedAt = parseDateValue(task.updatedAt);
    let completedIndex = resolveDisplayWeekIndex(completedAt);
    if (completedIndex === undefined) {
      completedAt = updatedAt ?? openedAt;
      completedIndex = resolveDisplayWeekIndex(completedAt);
    }
    if (completedIndex !== undefined) {
      completedRaw[completedIndex] += 1;
    }
  }

  const labelFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  return {
    labels: displayWeekStarts.map((date) => labelFmt.format(date)),
    weekStarts: displayWeekStarts,
    openedRaw,
    completedRaw,
    openedRolling: toRolling(openedRaw),
    completedRolling: toRolling(completedRaw),
    resolveDisplayWeekIndex,
  };
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const olderMinArg = argv.find((arg) => arg.startsWith("--older-min="));
  const olderMaxArg = argv.find((arg) => arg.startsWith("--older-max="));
  const recentMinArg = argv.find((arg) => arg.startsWith("--recent-min="));
  const recentMaxArg = argv.find((arg) => arg.startsWith("--recent-max="));
  const blockedMinArg = argv.find((arg) => arg.startsWith("--blocked-min="));
  const blockedMaxArg = argv.find((arg) => arg.startsWith("--blocked-max="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "all") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const windowWeeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(windowWeeks) || windowWeeks < 8 || windowWeeks > 26) {
    throw new Error("weeks must be between 8 and 26");
  }

  const olderMin = olderMinArg ? Number(olderMinArg.replace("--older-min=", "")) : 0.75;
  const olderMax = olderMaxArg ? Number(olderMaxArg.replace("--older-max=", "")) : 0.9;
  const recentMin = recentMinArg ? Number(recentMinArg.replace("--recent-min=", "")) : 0.4;
  const recentMax = recentMaxArg ? Number(recentMaxArg.replace("--recent-max=", "")) : 0.6;
  const blockedMin = blockedMinArg ? Number(blockedMinArg.replace("--blocked-min=", "")) : 0.05;
  const blockedMax = blockedMaxArg ? Number(blockedMaxArg.replace("--blocked-max=", "")) : 0.1;

  if (!Number.isFinite(olderMin) || !Number.isFinite(olderMax) || olderMin <= 0 || olderMax >= 1 || olderMin >= olderMax) {
    throw new Error("older-min/older-max must be decimals in (0,1) with older-min < older-max");
  }
  if (!Number.isFinite(recentMin) || !Number.isFinite(recentMax) || recentMin <= 0 || recentMax >= 1 || recentMin >= recentMax) {
    throw new Error("recent-min/recent-max must be decimals in (0,1) with recent-min < recent-max");
  }
  if (
    !Number.isFinite(blockedMin) ||
    !Number.isFinite(blockedMax) ||
    blockedMin < 0 ||
    blockedMax >= 1 ||
    blockedMin >= blockedMax
  ) {
    throw new Error("blocked-min/blocked-max must be decimals in [0,1) with blocked-min < blocked-max");
  }

  return {
    apply,
    mode,
    windowWeeks: Math.floor(windowWeeks),
    olderMin,
    olderMax,
    recentMin,
    recentMax,
    blockedMin,
    blockedMax,
  };
}

async function main() {
  const { apply, mode, windowWeeks, olderMin, olderMax, recentMin, recentMax, blockedMin, blockedMax } = parseArgs(
    process.argv.slice(2)
  );
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
        status: String(trial.status ?? ""),
        phase: String(trial.phase ?? ""),
      };
    })
    .filter(Boolean) as TrialTarget[];
  const mapIds = chosenTrials.map((entry) => entry.mapId);
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

  const todayStart = startOfDay(new Date());
  const yesterday = addDays(todayStart, -1);
  const olderCutoff = addDays(todayStart, -14);
  const historyWeeks = Math.max(24, windowWeeks * 2);
  const currentWeekStart = startOfIsoWeek(todayStart);

  const completionPlans: CompletionPlan[] = [];
  const blockPlans: BlockPlan[] = [];
  const trialSummaries: Array<Record<string, unknown>> = [];

  for (const trial of chosenTrials) {
    const trialTasks = tasksByMapId.get(trial.mapId) ?? [];
    const trialRand = seededRandom(`${trial.trialId}:${trial.mapId}:history-realism`);
    const olderTargetRate = olderMin + trialRand() * (olderMax - olderMin);
    const recentTargetRate = recentMin + trialRand() * (recentMax - recentMin);
    const blockedTargetRate = blockedMin + trialRand() * (blockedMax - blockedMin);

    const snapshotBefore = buildWeeklySnapshot(trialTasks, windowWeeks);
    const meanOpenedRaw =
      snapshotBefore.openedRaw.reduce((sum, value) => sum + value, 0) / Math.max(1, snapshotBefore.openedRaw.length);

    const taskContexts: TaskContext[] = trialTasks.map((task) => {
      const dueLike = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
      const openedAnchor = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
      const isHistoricalOpen = openedAnchor ? openedAnchor.getTime() < todayStart.getTime() : false;
      const isOlderOpen = isHistoricalOpen && openedAnchor!.getTime() < olderCutoff.getTime();
      const isRecentOpen = isHistoricalOpen && openedAnchor!.getTime() >= olderCutoff.getTime();
      const isPastDue = dueLike ? dueLike.getTime() < todayStart.getTime() : false;
      return { task, dueLike, openedAnchor, isHistoricalOpen, isOlderOpen, isRecentOpen, isPastDue };
    });

    const historicalOpened = taskContexts.filter((context) => context.isHistoricalOpen);
    const olderOpened = historicalOpened.filter((context) => context.isOlderOpen);
    const recentOpened = historicalOpened.filter((context) => context.isRecentOpen);
    const olderDoneBefore = olderOpened.filter((context) => isDoneStatus(context.task.status)).length;
    const recentDoneBefore = recentOpened.filter((context) => isDoneStatus(context.task.status)).length;
    const olderDesiredDone = Math.round(olderOpened.length * olderTargetRate);
    const recentDesiredDone = Math.round(recentOpened.length * recentTargetRate);
    let olderNeed = Math.max(0, olderDesiredDone - olderDoneBefore);
    let recentNeed = Math.max(0, recentDesiredDone - recentDoneBefore);

    const openHistorical = historicalOpened.filter((context) => !isDoneStatus(context.task.status));
    const completionCandidates = openHistorical;
    const olderCandidates = completionCandidates.filter((context) => context.isOlderOpen);
    const recentCandidates = completionCandidates.filter((context) => context.isRecentOpen);

    const olderSelection = pickWeightedUnique(
      olderCandidates,
      Math.min(olderNeed, olderCandidates.length),
      (context) => {
        const openedAge = context.openedAnchor
          ? Math.max(1, Math.floor((todayStart.getTime() - context.openedAnchor.getTime()) / DAY_MS))
          : 1;
        const overdueBonus = context.isPastDue ? 1.5 : 0.7;
        return overdueBonus + Math.min(11, openedAge / 9);
      },
      trialRand
    );
    olderNeed -= olderSelection.length;

    const recentSelection = pickWeightedUnique(
      recentCandidates,
      Math.min(recentNeed, recentCandidates.length),
      (context) => {
        const openedAge = context.openedAnchor
          ? Math.max(1, Math.floor((todayStart.getTime() - context.openedAnchor.getTime()) / DAY_MS))
          : 1;
        const dueBonus = context.isPastDue ? 1.1 : 0.6;
        return dueBonus + Math.min(5, openedAge / 6);
      },
      trialRand
    );
    recentNeed -= recentSelection.length;

    const selectedTasks = [...olderSelection, ...recentSelection];
    const selectedIds = new Set(selectedTasks.map((context) => context.task.id));

    if (olderNeed > 0 || recentNeed > 0) {
      const reservePool = completionCandidates.filter((context) => !selectedIds.has(context.task.id));
      const fill = pickWeightedUnique(
        reservePool,
        Math.min(olderNeed + recentNeed, reservePool.length),
        (context) => {
          const openedAge = context.openedAnchor
            ? Math.max(1, Math.floor((todayStart.getTime() - context.openedAnchor.getTime()) / DAY_MS))
            : 1;
          const overdueBonus = context.isPastDue ? 1.25 : 0.75;
          return overdueBonus + Math.min(8, openedAge / 10);
        },
        trialRand
      );
      for (const context of fill) {
        selectedTasks.push(context);
        selectedIds.add(context.task.id);
      }
    }

    const remainingOpenAfterCompletions = openHistorical.filter((context) => !selectedIds.has(context.task.id));
    const initiallyBlockedOpen = remainingOpenAfterCompletions.filter(
      (context) => normalizeToken(context.task.status) === "blocked"
    );
    const blockedTargetCount = Math.max(
      0,
      Math.min(
        remainingOpenAfterCompletions.length,
        Math.round(remainingOpenAfterCompletions.length * blockedTargetRate)
      )
    );
    const blockedProtected = new Set<string>();
    if (blockedTargetCount > 0) {
      const keepFromExisting = pickWeightedUnique(
        initiallyBlockedOpen,
        Math.min(blockedTargetCount, initiallyBlockedOpen.length),
        (context) => {
          const openedAge = context.openedAnchor
            ? Math.max(1, Math.floor((todayStart.getTime() - context.openedAnchor.getTime()) / DAY_MS))
            : 1;
          const dueAge = context.dueLike
            ? Math.max(1, Math.floor((todayStart.getTime() - context.dueLike.getTime()) / DAY_MS))
            : 1;
          return 1.2 + Math.min(7, openedAge / 12) + Math.min(3, dueAge / 14);
        },
        trialRand
      );
      for (const context of keepFromExisting) blockedProtected.add(context.task.id);

      if (blockedProtected.size < blockedTargetCount) {
        const candidatePool = remainingOpenAfterCompletions.filter((context) => !blockedProtected.has(context.task.id));
        const extra = pickWeightedUnique(
          candidatePool,
          blockedTargetCount - blockedProtected.size,
          (context) => {
            const openedAge = context.openedAnchor
              ? Math.max(1, Math.floor((todayStart.getTime() - context.openedAnchor.getTime()) / DAY_MS))
              : 1;
            const overdueBoost = context.isPastDue ? 1.8 : 0.45;
            return overdueBoost + Math.min(8, openedAge / 10);
          },
          trialRand
        );
        for (const context of extra) blockedProtected.add(context.task.id);
      }
    }

    const catchUpWeekPrimary = drawInt(trialRand, 2, Math.max(2, windowWeeks - 4));
    const catchUpWeekSecondary = trialRand() < 0.45 ? drawInt(trialRand, 1, Math.max(1, windowWeeks - 3)) : -1;
    const slowWeek = drawInt(trialRand, 0, Math.max(0, windowWeeks - 2));
    const catchUpWeeks = new Set<number>([catchUpWeekPrimary]);
    if (catchUpWeekSecondary >= 0) catchUpWeeks.add(catchUpWeekSecondary);

    const targetCompletedRaw = Array.from({ length: windowWeeks }, (_, weekIndex) => {
      const weekStart = snapshotBefore.weekStarts[weekIndex]!;
      const isOlderWeek = weekStart.getTime() < olderCutoff.getTime();
      const baseRatio = isOlderWeek ? olderTargetRate : recentTargetRate;
      let ratio = baseRatio * (0.78 + trialRand() * 0.52); // ±26% variability

      if (catchUpWeeks.has(weekIndex)) {
        ratio += 0.18 + trialRand() * 0.18;
      }
      if (weekIndex === slowWeek) {
        ratio -= 0.18 + trialRand() * 0.1;
      }

      ratio = Math.max(0.25, Math.min(1.15, ratio));
      let target = Math.round((snapshotBefore.openedRaw[weekIndex] ?? 0) * ratio);
      if (catchUpWeeks.has(weekIndex)) {
        target += Math.max(1, Math.round(meanOpenedRaw * (0.12 + trialRand() * 0.18)));
      }
      if (weekIndex === slowWeek) {
        target = Math.max(0, target - Math.round(meanOpenedRaw * 0.18));
      }
      return target;
    });

    const deficits = targetCompletedRaw.map((target, weekIndex) =>
      Math.max(0, target - (snapshotBefore.completedRaw[weekIndex] ?? 0))
    );

    const plannedCompletions: CompletionPlan[] = [];
    for (const selectedContext of selectedTasks.sort((a, b) => {
      const aAnchor = (a.openedAnchor ?? a.dueLike ?? new Date(0)).getTime();
      const bAnchor = (b.openedAnchor ?? b.dueLike ?? new Date(0)).getTime();
      if (aAnchor !== bAnchor) return aAnchor - bAnchor;
      const aDue = (a.dueLike ?? new Date(0)).getTime();
      const bDue = (b.dueLike ?? new Date(0)).getTime();
      return aDue - bDue;
    })) {
      const task = selectedContext.task;
      const preferredAnchor = selectedContext.dueLike ?? selectedContext.openedAnchor;
      const preferredWeekRaw = snapshotBefore.resolveDisplayWeekIndex(preferredAnchor);
      const preferredWeek =
        preferredWeekRaw !== undefined
          ? preferredWeekRaw
          : preferredAnchor && preferredAnchor.getTime() < snapshotBefore.weekStarts[0]!.getTime()
            ? 0
            : windowWeeks - 1;

      let targetWeek = preferredWeek;
      let bestScore = -Infinity;
      for (let weekIndex = 0; weekIndex < windowWeeks; weekIndex += 1) {
        const deficit = deficits[weekIndex] ?? 0;
        if (deficit <= 0) continue;
        const distancePenalty = Math.abs(weekIndex - preferredWeek) * 1.2;
        const catchUpBonus = catchUpWeeks.has(weekIndex) ? 1.5 : 0;
        const slowPenalty = weekIndex === slowWeek ? 1.2 : 0;
        const score = deficit * 3.5 - distancePenalty + catchUpBonus - slowPenalty + trialRand() * 0.4;
        if (score > bestScore) {
          bestScore = score;
          targetWeek = weekIndex;
        }
      }
      deficits[targetWeek] = Math.max(0, (deficits[targetWeek] ?? 0) - 1);

      const openedAnchor = selectedContext.openedAnchor ?? addDays(snapshotBefore.weekStarts[targetWeek]!, -7);
      let dueDate = selectedContext.dueLike;
      let suggestedDate = parseDateValue(task.suggestedDate);
      if (
        !dueDate ||
        dueDate.getTime() >= todayStart.getTime() ||
        dueDate.getTime() < addDays(openedAnchor, -7).getTime()
      ) {
        const syntheticWindow = getHistoricalDueWindow({
          openedAnchor,
          fallbackWeekStart: snapshotBefore.weekStarts[targetWeek]!,
          todayStart,
          nextRandom: trialRand,
        });
        dueDate = syntheticWindow.dueDate;
        suggestedDate = syntheticWindow.suggestedDate;
      } else if (!suggestedDate || suggestedDate.getTime() > dueDate.getTime()) {
        suggestedDate = addDays(dueDate, -drawInt(trialRand, 1, 3));
      }

      dueDate = clampDate(dueDate, addDays(todayStart, -180), yesterday);
      const lagBusinessDays = sampleCompletionLag(trialRand);
      let completedDate = addBusinessDays(dueDate, lagBusinessDays);
      const weekFloor = toBusinessDayOnOrAfter(addDays(snapshotBefore.weekStarts[targetWeek]!, drawInt(trialRand, 1, 4)));
      if (completedDate.getTime() < weekFloor.getTime()) {
        completedDate = weekFloor;
      }
      const openedFloor = toBusinessDayOnOrAfter(addDays(openedAnchor, drawInt(trialRand, 0, 2)));
      if (completedDate.getTime() < openedFloor.getTime()) {
        completedDate = openedFloor;
      }
      if (completedDate.getTime() > yesterday.getTime()) {
        completedDate = yesterday;
      }

      plannedCompletions.push({
        taskId: task.id,
        completedDate,
        targetWeek,
        dueDate,
        suggestedDate,
      });
    }

    const contextByTaskId = new Map(taskContexts.map((context) => [context.task.id, context]));
    const plannedBlocks: BlockPlan[] = Array.from(blockedProtected)
      .map((taskId) => {
        const context = contextByTaskId.get(taskId);
        const task = context?.task;
        if (!task || isDoneStatus(task.status)) return null;

        let dueDate = context?.dueLike;
        let suggestedDate = parseDateValue(task.suggestedDate);
        const openedAnchor = context?.openedAnchor ?? addDays(todayStart, -21);
        if (!dueDate || dueDate.getTime() >= todayStart.getTime()) {
          const syntheticWindow = getHistoricalDueWindow({
            openedAnchor,
            fallbackWeekStart: addDays(todayStart, -14),
            todayStart,
            nextRandom: trialRand,
          });
          dueDate = clampDate(syntheticWindow.dueDate, addDays(todayStart, -90), addDays(todayStart, -2));
          suggestedDate = syntheticWindow.suggestedDate;
        }
        dueDate = clampDate(dueDate, addDays(todayStart, -120), addDays(todayStart, -2));
        const blockedSince = clampDate(addDays(dueDate, drawInt(trialRand, 1, 5)), addDays(dueDate, 1), yesterday);
        const reason = BLOCK_REASONS[drawInt(trialRand, 0, BLOCK_REASONS.length - 1)]!;
        return { taskId, blockedSince, blockedReason: reason, dueDate, suggestedDate };
      })
      .filter(Boolean) as BlockPlan[];

    completionPlans.push(...plannedCompletions);
    blockPlans.push(...plannedBlocks);

    const completionMap = new Map(plannedCompletions.map((plan) => [plan.taskId, plan]));
    const blockMap = new Map(plannedBlocks.map((plan) => [plan.taskId, plan]));
    const virtualTasks = trialTasks.map((task) => {
      const completion = completionMap.get(task.id);
      if (completion) {
        return {
          ...task,
          status: "done" as const,
          dueDate: completion.dueDate ?? task.dueDate,
          suggestedDate: completion.suggestedDate ?? task.suggestedDate,
          completedDate: completion.completedDate,
          blockedSince: null,
          blockedReason: null,
        };
      }
      const block = blockMap.get(task.id);
      if (block) {
        return {
          ...task,
          status: "blocked" as const,
          dueDate: block.dueDate ?? task.dueDate,
          suggestedDate: block.suggestedDate ?? task.suggestedDate,
          completedDate: null,
          blockedSince: block.blockedSince,
          blockedReason: block.blockedReason,
        };
      }
      return task;
    });

    const snapshotAfter = buildWeeklySnapshot(virtualTasks, windowWeeks);
    const afterContexts: TaskContext[] = virtualTasks.map((task) => {
      const dueLike = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
      const openedAnchor = resolveBacklogOpenedAnchor(task, currentWeekStart, historyWeeks);
      const isHistoricalOpen = openedAnchor ? openedAnchor.getTime() < todayStart.getTime() : false;
      const isOlderOpen = isHistoricalOpen && openedAnchor!.getTime() < olderCutoff.getTime();
      const isRecentOpen = isHistoricalOpen && openedAnchor!.getTime() >= olderCutoff.getTime();
      const isPastDue = dueLike ? dueLike.getTime() < todayStart.getTime() : false;
      return { task, dueLike, openedAnchor, isHistoricalOpen, isOlderOpen, isRecentOpen, isPastDue };
    });

    const olderDoneAfter = afterContexts.filter((context) => context.isOlderOpen && isDoneStatus(context.task.status)).length;
    const recentDoneAfter = afterContexts.filter((context) => context.isRecentOpen && isDoneStatus(context.task.status)).length;
    const openHistoricalAfter = afterContexts.filter(
      (context) => context.isHistoricalOpen && !isDoneStatus(context.task.status)
    ).length;
    const blockedAfter = afterContexts.filter(
      (context) =>
        context.isHistoricalOpen &&
        !isDoneStatus(context.task.status) &&
        normalizeToken(context.task.status) === "blocked"
    ).length;
    const overdueOpenAfter = afterContexts.filter(
      (context) => context.isHistoricalOpen && !isDoneStatus(context.task.status) && context.isPastDue
    ).length;
    const blockedRateAfter = openHistoricalAfter > 0 ? blockedAfter / openHistoricalAfter : 0;

    trialSummaries.push({
      trialId: trial.trialId,
      trialTitle: trial.trialTitle,
      status: trial.status,
      phase: trial.phase,
      olderTargetRate: Number(olderTargetRate.toFixed(3)),
      recentTargetRate: Number(recentTargetRate.toFixed(3)),
      blockedTargetRate: Number(blockedTargetRate.toFixed(3)),
      catchUpWeeks: Array.from(catchUpWeeks).sort((a, b) => a - b),
      slowWeek,
      selectedCompletions: plannedCompletions.length,
      selectedBlocked: plannedBlocks.length,
      historicalOpenedBefore: {
        total: historicalOpened.length,
        olderTotal: olderOpened.length,
        recentTotal: recentOpened.length,
        olderDone: olderDoneBefore,
        recentDone: recentDoneBefore,
        open: openHistorical.length,
      },
      historicalOpenedAfter: {
        olderDone: olderDoneAfter,
        recentDone: recentDoneAfter,
        open: openHistoricalAfter,
        blockedOpen: blockedAfter,
        overdueOpen: overdueOpenAfter,
        blockedOpenRate: Number(blockedRateAfter.toFixed(3)),
      },
      weeklyOpenedRolling: snapshotBefore.openedRolling,
      weeklyCompletedBeforeRolling: snapshotBefore.completedRolling,
      weeklyCompletedAfterRolling: snapshotAfter.completedRolling,
    });
  }

  const completionById = new Map(completionPlans.map((row) => [row.taskId, row]));
  const blockById = new Map(blockPlans.map((row) => [row.taskId, row]));

  if (apply) {
    for (const plan of completionPlans) {
      await db
        .update(mapTasks)
        .set({
          status: "done",
          dueDate: plan.dueDate ?? null,
          suggestedDate: plan.suggestedDate ?? null,
          completedDate: plan.completedDate,
          blockedSince: null,
          blockedReason: null,
        })
        .where(eq(mapTasks.id, plan.taskId));
    }

    for (const plan of blockPlans) {
      await db
        .update(mapTasks)
        .set({
          status: "blocked",
          dueDate: plan.dueDate ?? null,
          suggestedDate: plan.suggestedDate ?? null,
          completedDate: null,
          blockedSince: plan.blockedSince,
          blockedReason: plan.blockedReason,
        })
        .where(eq(mapTasks.id, plan.taskId));
    }
  }

  const globalBefore = buildWeeklySnapshot(tasks, windowWeeks);
  const globalAfter = buildWeeklySnapshot(
    tasks.map((task) => {
      const completion = completionById.get(task.id);
      if (completion) {
        return {
          ...task,
          dueDate: completion.dueDate ?? task.dueDate,
          suggestedDate: completion.suggestedDate ?? task.suggestedDate,
          status: "done" as const,
          completedDate: completion.completedDate,
          blockedSince: null,
          blockedReason: null,
        };
      }
      const block = blockById.get(task.id);
      if (block) {
        return {
          ...task,
          dueDate: block.dueDate ?? task.dueDate,
          suggestedDate: block.suggestedDate ?? task.suggestedDate,
          status: "blocked" as const,
          completedDate: null,
          blockedSince: block.blockedSince,
          blockedReason: block.blockedReason,
        };
      }
      return task;
    }),
    windowWeeks
  );

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const stdDev = (values: number[]) => {
    const m = mean(values);
    return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / Math.max(1, values.length));
  };

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        windowWeeks,
        olderRatioRange: [olderMin, olderMax],
        recentRatioRange: [recentMin, recentMax],
        blockedOpenRange: [blockedMin, blockedMax],
        plannedCompletions: completionPlans.length,
        plannedBlocked: blockPlans.length,
        globalWeekly: {
          labels: globalBefore.labels,
          openedRolling: globalBefore.openedRolling,
          completedBeforeRolling: globalBefore.completedRolling,
          completedAfterRolling: globalAfter.completedRolling,
        },
        globalCompletionAfterStats: {
          mean: Number(mean(globalAfter.completedRolling).toFixed(2)),
          stdDev: Number(stdDev(globalAfter.completedRolling).toFixed(2)),
          coeffVar: Number((stdDev(globalAfter.completedRolling) / Math.max(1, mean(globalAfter.completedRolling))).toFixed(3)),
        },
        trialSummaries,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[rebalance-history-realism] failed", error);
  process.exit(1);
});
