import { randomUUID } from "crypto";
import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapPhases, mapTasks, trials, type ExecutionMap, type MapPhase, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";
type WorkloadProfile = "ramp_up" | "maintenance" | "clustered" | "taper";

const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);
const EXCLUDED_VISIT_TYPES = new Set(["screen_fail", "early_termination"]);
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

function isVisitPhase(phaseType: MapPhase["phaseType"]) {
  return !EXCLUDED_VISIT_TYPES.has(normalizeToken(phaseType));
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

function firstDate(...dates: Array<Date | null | undefined>) {
  for (const date of dates) {
    if (date instanceof Date && Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function weekIndex(baseWeekStart: Date, date: Date | null, weeks: number) {
  if (!date) return null;
  const normalized = startOfIsoWeek(date);
  const baseUtc = Date.UTC(baseWeekStart.getFullYear(), baseWeekStart.getMonth(), baseWeekStart.getDate());
  const normalizedUtc = Date.UTC(normalized.getFullYear(), normalized.getMonth(), normalized.getDate());
  const diff = Math.floor((normalizedUtc - baseUtc) / (7 * 24 * 60 * 60 * 1000));
  if (diff < 0 || diff >= weeks) return null;
  return diff;
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

function stableHash(input: string) {
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

function buildWeeklyTargets(args: {
  weeks: number;
  total: number;
  baseline: number;
  floorDelta: number;
  capDelta: number;
  seed: string;
  weights?: number[];
}) {
  const { weeks, total, baseline, floorDelta, capDelta, seed, weights } = args;
  const nextRandom = seededRandom(seed);
  const fallbackAverage = total / Math.max(1, weeks);
  const average = total / Math.max(1, weeks);
  const minFloor = Math.max(0, baseline - floorDelta);
  const adaptiveFloor = Math.max(0, Math.floor(average * 0.5));
  const floor = Math.max(0, Math.min(minFloor, adaptiveFloor));
  const adaptiveCap = Math.max(Math.ceil(average * 1.9), Math.ceil(average + Math.max(2, average * 0.6)));
  const cap = Math.max(floor + 1, baseline + capDelta, adaptiveCap);
  const normalizedWeights =
    weights && weights.length === weeks
      ? weights.map((value) => Math.max(0.05, Number.isFinite(value) ? value : 0.05))
      : Array.from({ length: weeks }, (_, index) => {
          const waveOffset = nextRandom() * Math.PI * 2;
          const wave = 0.12 * Math.sin((index / Math.max(1, weeks)) * Math.PI * 2 + waveOffset);
          return Math.max(0.05, 0.8 + nextRandom() * 0.55 + wave);
        });
  const weightSum = normalizedWeights.reduce((sum, value) => sum + value, 0);

  const targets =
    weightSum > 0
      ? normalizedWeights.map((weight) =>
          Math.max(floor, Math.min(cap, Math.round((total * weight) / weightSum)))
        )
      : Array.from({ length: weeks }, () =>
          Math.max(floor, Math.min(cap, Math.round(Math.max(0, fallbackAverage))))
        );

  let diff = total - targets.reduce((sum, count) => sum + count, 0);
  while (diff !== 0) {
    if (diff > 0) {
      const candidates = targets.map((count, index) => ({ index, room: cap - count })).filter((row) => row.room > 0);
      if (!candidates.length) break;
      const pick = candidates[drawInt(nextRandom, 0, candidates.length - 1)]!;
      targets[pick.index] += 1;
      diff -= 1;
      continue;
    }

    const candidates = targets.map((count, index) => ({ index, room: count - floor })).filter((row) => row.room > 0);
    if (!candidates.length) break;
    const pick = candidates[drawInt(nextRandom, 0, candidates.length - 1)]!;
    targets[pick.index] -= 1;
    diff += 1;
  }

  return targets;
}

function rotateArray<T>(values: T[], shift: number) {
  const normalized = ((shift % values.length) + values.length) % values.length;
  if (normalized === 0) return [...values];
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function chooseWorkloadProfile(status: string, phase: string, trialId: string): WorkloadProfile {
  const statusToken = normalizeToken(status);
  const phaseToken = normalizeToken(phase);
  const isPhaseIII = /phase\s*iii\b/.test(phaseToken);
  const isPhaseII = /phase\s*ii\b/.test(phaseToken);
  const isPhaseI = /phase\s*i\b/.test(phaseToken) && !isPhaseII && !isPhaseIII;
  if (isPhaseI) return "clustered";
  if (isPhaseIII) return statusToken === "completed" || statusToken === "terminated" ? "taper" : "maintenance";
  if (isPhaseII) return statusToken === "recruiting" ? "ramp_up" : "maintenance";
  if (statusToken === "completed" || statusToken === "terminated" || statusToken === "on-hold") return "taper";
  if (statusToken === "recruiting" || statusToken === "not-started") return "ramp_up";
  if (statusToken === "active") return stableHash(`${trialId}:profile`) % 2 === 0 ? "maintenance" : "ramp_up";
  return (["ramp_up", "maintenance", "clustered", "taper"] as WorkloadProfile[])[
    stableHash(`${trialId}:fallback-profile`) % 4
  ]!;
}

function taskDeferralScore(task: Pick<MapTask, "id" | "priority" | "category" | "name">) {
  const priorityToken = normalizeToken(task.priority);
  const categoryToken = normalizeToken(task.category);
  const nameToken = normalizeToken(task.name);

  const priorityScore =
    priorityToken === "low" ? 0 :
    priorityToken === "medium" ? 1 :
    priorityToken === "high" ? 3 :
    priorityToken === "critical" ? 5 : 2;

  const categoryScore =
    categoryToken.includes("documentation") || categoryToken.includes("coordination") || categoryToken.includes("administrative")
      ? -1
      : categoryToken.includes("drug") || categoryToken.includes("procedure")
        ? 1
        : 0;

  const nameScore =
    nameToken.includes("coverage") || nameToken.includes("rebalance") || nameToken.includes("follow-up")
      ? -1
      : 0;

  const tieBreaker = (stableHash(task.id) % 1000) / 1000;
  return priorityScore + categoryScore + nameScore + tieBreaker;
}

function baseWeightForProfile(profile: WorkloadProfile, weekIndex: number, weeks: number) {
  const position = weekIndex / Math.max(1, weeks - 1);
  if (profile === "ramp_up") {
    if (position < 0.34) return 0.72 + position * 0.35;
    if (position < 0.67) return 1.18 + (position - 0.34) * 0.25;
    return 0.95 - (position - 0.67) * 0.55;
  }
  if (profile === "clustered") {
    return 0.76 + 0.06 * Math.sin(position * Math.PI * 6);
  }
  if (profile === "taper") {
    return 1.2 - position * 0.62;
  }
  return 0.98 + 0.12 * Math.sin(position * Math.PI * 2);
}

function globalSeasonWeight(weekIndex: number, weeks: number) {
  const position = weekIndex / Math.max(1, weeks - 1);
  if (position < 0.33) return 0.86 + position * 0.35;
  if (position < 0.66) return 1.12 + (position - 0.33) * 0.3;
  return 1.05 - (position - 0.66) * 0.48;
}

function buildTaskProfileWeights(args: {
  weeks: number;
  profile: WorkloadProfile;
  seed: string;
}) {
  const { weeks, profile, seed } = args;
  const nextRandom = seededRandom(seed);
  let weights = Array.from({ length: weeks }, (_, weekIndex) => {
    const base = baseWeightForProfile(profile, weekIndex, weeks);
    const season = globalSeasonWeight(weekIndex, weeks);
    const jitter = 0.9 + nextRandom() * 0.22;
    return Math.max(0.05, base * season * jitter);
  });

  if (profile === "clustered") {
    const clusterA = Math.floor(weeks * 0.25) + drawInt(nextRandom, 0, 1);
    const clusterB = Math.floor(weeks * 0.58) + drawInt(nextRandom, 0, 2);
    if (weights[clusterA] !== undefined) weights[clusterA] *= 1.55;
    if (weights[clusterB] !== undefined) weights[clusterB] *= 1.42;
  }

  const lightWeek = drawInt(nextRandom, 0, Math.max(0, weeks - 1));
  const spikeWeek = drawInt(nextRandom, 0, Math.max(0, weeks - 1));
  if (weights[lightWeek] !== undefined) weights[lightWeek] *= 0.55;
  if (weights[spikeWeek] !== undefined) weights[spikeWeek] *= 1.65;

  const stagger = stableHash(`${seed}:stagger`) % Math.max(1, Math.min(weeks, 4));
  weights = rotateArray(weights, stagger);
  return weights.map((value) => Math.max(0.05, value));
}

function buildVisitProfileWeights(taskWeights: number[], seed: string) {
  const nextRandom = seededRandom(seed);
  const weeks = taskWeights.length;
  const weights = taskWeights.map((value, weekIndex) => {
    const prev = taskWeights[(weekIndex - 1 + weeks) % weeks] ?? value;
    const next = taskWeights[(weekIndex + 1) % weeks] ?? value;
    const correlated = value * 0.68 + prev * 0.18 + next * 0.14;
    const jitter = 0.9 + nextRandom() * 0.2;
    return Math.max(0.05, correlated * jitter);
  });

  const lightWeek = drawInt(nextRandom, 0, Math.max(0, weeks - 1));
  const spikeWeek = drawInt(nextRandom, 0, Math.max(0, weeks - 1));
  if (weights[lightWeek] !== undefined) weights[lightWeek] *= 0.62;
  if (weights[spikeWeek] !== undefined) weights[spikeWeek] *= 1.35;

  return weights.map((value) => Math.max(0.05, value));
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const visitsOnly = argv.includes("--visits-only");
  const reduceTaskGap = argv.includes("--reduce-task-gap");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const minTasksArg = argv.find((arg) => arg.startsWith("--min-tasks="));
  const minVisitsArg = argv.find((arg) => arg.startsWith("--min-visits="));
  const taskLiftArg = argv.find((arg) => arg.startsWith("--task-lift="));
  const visitLiftArg = argv.find((arg) => arg.startsWith("--visit-lift="));
  const taskRatioArg = argv.find((arg) => arg.startsWith("--task-ratio="));
  const taskBiasArg = argv.find((arg) => arg.startsWith("--task-bias="));
  const deferSpanArg = argv.find((arg) => arg.startsWith("--defer-span-weeks="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const weeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(weeks) || weeks < 1 || weeks > 26) {
    throw new Error("weeks must be between 1 and 26");
  }

  const minTasks = minTasksArg ? Number(minTasksArg.replace("--min-tasks=", "")) : 8;
  if (!Number.isFinite(minTasks) || minTasks < 1 || minTasks > 20) {
    throw new Error("min-tasks must be between 1 and 20");
  }

  const minVisits = minVisitsArg ? Number(minVisitsArg.replace("--min-visits=", "")) : 2;
  if (!Number.isFinite(minVisits) || minVisits < 1 || minVisits > 10) {
    throw new Error("min-visits must be between 1 and 10");
  }

  const taskLift = taskLiftArg ? Number(taskLiftArg.replace("--task-lift=", "")) : 0;
  if (!Number.isFinite(taskLift) || taskLift < 0 || taskLift > 200) {
    throw new Error("task-lift must be between 0 and 200");
  }

  const visitLift = visitLiftArg ? Number(visitLiftArg.replace("--visit-lift=", "")) : 0;
  if (!Number.isFinite(visitLift) || visitLift < 0 || visitLift > 20) {
    throw new Error("visit-lift must be between 0 and 20");
  }

  const taskRatio = taskRatioArg ? Number(taskRatioArg.replace("--task-ratio=", "")) : 2.0;
  if (!Number.isFinite(taskRatio) || taskRatio < 1.2 || taskRatio > 3.5) {
    throw new Error("task-ratio must be between 1.2 and 3.5");
  }

  const taskBias = taskBiasArg ? Number(taskBiasArg.replace("--task-bias=", "")) : 2;
  if (!Number.isFinite(taskBias) || taskBias < 0 || taskBias > 8) {
    throw new Error("task-bias must be between 0 and 8");
  }

  const deferSpanWeeks = deferSpanArg ? Number(deferSpanArg.replace("--defer-span-weeks=", "")) : 10;
  if (!Number.isFinite(deferSpanWeeks) || deferSpanWeeks < 2 || deferSpanWeeks > 24) {
    throw new Error("defer-span-weeks must be between 2 and 24");
  }

  return {
    apply,
    visitsOnly,
    reduceTaskGap,
    mode,
    weeks: Math.floor(weeks),
    minTasks: Math.floor(minTasks),
    minVisits: Math.floor(minVisits),
    taskLift: Math.floor(taskLift),
    visitLift: Math.floor(visitLift),
    taskRatio,
    taskBias,
    deferSpanWeeks: Math.floor(deferSpanWeeks),
  };
}

async function main() {
  const {
    apply,
    visitsOnly,
    reduceTaskGap,
    mode,
    weeks,
    minTasks,
    minVisits,
    taskLift,
    visitLift,
    taskRatio,
    taskBias,
    deferSpanWeeks,
  } = parseArgs(process.argv.slice(2));
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

  const selected = trialRows
    .map((trial) => {
      const map = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!map) return null;
      return {
        trialId: trial.id,
        trialTitle: trial.title,
        mapId: map.id,
        status: String(trial.status ?? ""),
        phase: String(trial.phase ?? ""),
      };
    })
    .filter(Boolean) as Array<{ trialId: string; trialTitle: string; mapId: string; status: string; phase: string }>;

  const mapIds = selected.map((row) => row.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, message: "No maps found." }, null, 2));
    return;
  }

  const phaseRows = await db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds));
  const taskRows = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const phasesByMapId = new Map<string, MapPhase[]>();
  const tasksByMapId = new Map<string, MapTask[]>();
  for (const row of phaseRows) {
    const list = phasesByMapId.get(row.mapId) ?? [];
    list.push(row);
    phasesByMapId.set(row.mapId, list);
  }
  for (const row of taskRows) {
    const list = tasksByMapId.get(row.mapId) ?? [];
    list.push(row);
    tasksByMapId.set(row.mapId, list);
  }

  const now = new Date();
  const baseWeekStart = startOfIsoWeek(new Date());
  const weekStarts = Array.from({ length: weeks }, (_, index) => addDays(baseWeekStart, index * 7));

  const summary = {
    apply,
    mode,
    weeks,
    visitsOnly,
    reduceTaskGap,
    minTasks,
    minVisits,
    taskLift,
    visitLift,
    taskRatio,
    taskBias,
    deferSpanWeeks,
    trials: selected.length,
    createdPhases: 0,
    createdTasks: 0,
    movedPhases: 0,
    movedTasks: 0,
    deferredTasks: 0,
    perTrial: [] as Array<Record<string, unknown>>,
  };

  for (const trial of selected) {
    const phases = [...(phasesByMapId.get(trial.mapId) ?? [])];
    const tasks = [...(tasksByMapId.get(trial.mapId) ?? [])];

    if (!phases.length) {
      continue;
    }

    const taskCountsBefore = Array.from({ length: weeks }, () => 0);
    const visitCountsBefore = Array.from({ length: weeks }, () => 0);
    const phaseIdsByWeek = new Map<number, string[]>();
    const taskBuckets = new Map<number, MapTask[]>();
    const visitBuckets = new Map<number, Array<{ phase: MapPhase; weight: number }>>();
    for (let i = 0; i < weeks; i += 1) {
      phaseIdsByWeek.set(i, []);
      taskBuckets.set(i, []);
      visitBuckets.set(i, []);
    }

    for (const phase of phases) {
      if (!isVisitPhase(phase.phaseType)) continue;
      const anchor = firstDate(
        parseDateValue(phase.estimatedDate),
        parseDateValue(phase.windowStart),
        parseDateValue(phase.windowEnd)
      );
      const idx = weekIndex(baseWeekStart, anchor, weeks);
      if (idx === null) continue;
      const weight = phase.phaseType === "treatment_visit" ? 2 : 1;
      visitCountsBefore[idx] += weight;
      const list = phaseIdsByWeek.get(idx) ?? [];
      list.push(phase.id);
      phaseIdsByWeek.set(idx, list);
      const bucket = visitBuckets.get(idx) ?? [];
      bucket.push({ phase, weight });
      visitBuckets.set(idx, bucket);
    }

    for (const task of tasks) {
      if (isDoneStatus(task.status)) continue;
      const anchor = firstDate(parseDateValue(task.dueDate), parseDateValue(task.suggestedDate));
      const idx = weekIndex(baseWeekStart, anchor, weeks);
      if (idx === null) continue;
      taskCountsBefore[idx] += 1;
      const bucket = taskBuckets.get(idx) ?? [];
      bucket.push(task);
      taskBuckets.set(idx, bucket);
    }

    const taskCountsAfter = [...taskCountsBefore];
    const visitCountsAfter = [...visitCountsBefore];
    const profile = chooseWorkloadProfile(trial.status, trial.phase, trial.trialId);
    const taskShape = buildTaskProfileWeights({
      weeks,
      profile,
      seed: `${trial.trialId}:${trial.mapId}:task-shape`,
    });
    const visitShape = buildVisitProfileWeights(taskShape, `${trial.trialId}:${trial.mapId}:visit-shape`);
    const taskTargets = visitsOnly
      ? [...taskCountsBefore]
      : buildWeeklyTargets({
          weeks,
          total: taskCountsBefore.reduce((sum, count) => sum + count, 0) + taskLift,
          baseline: minTasks,
          floorDelta: 3,
          capDelta: 4,
          seed: `${trial.trialId}:${trial.mapId}:tasks`,
          weights: taskShape,
        });
    const visitTargets = buildWeeklyTargets({
      weeks,
      total: visitCountsBefore.reduce((sum, count) => sum + count, 0) + visitLift,
      baseline: minVisits,
      floorDelta: 1,
      capDelta: 2,
      seed: `${trial.trialId}:${trial.mapId}:visits`,
      weights: visitShape,
    });

    let nextDisplayOrder =
      phases.reduce((max, phase) => Math.max(max, Number(phase.displayOrder ?? -1)), -1) + 1;
    const orderByPhase = new Map<string, number>();
    for (const task of tasks) {
      const current = orderByPhase.get(task.phaseId) ?? -1;
      orderByPhase.set(task.phaseId, Math.max(current, Number(task.orderInPhase ?? -1)));
    }

    let createdPhasesForTrial = 0;
    let createdTasksForTrial = 0;
    let movedPhasesForTrial = 0;
    let movedTasksForTrial = 0;
    let deferredTasksForTrial = 0;

    const trialPhaseRandom = seededRandom(`${trial.trialId}:${trial.mapId}:phase-moves`);
    const maxPhaseMoves = Math.max(weeks * 24, 96);
    for (let phaseMoveCount = 0; phaseMoveCount < maxPhaseMoves; phaseMoveCount += 1) {
      let receiverWeek = -1;
      let receiverDeficit = 0;
      let donorWeek = -1;
      let donorSurplus = 0;

      for (let weekIdx = 0; weekIdx < weeks; weekIdx += 1) {
        const deficit = (visitTargets[weekIdx] ?? 0) - (visitCountsAfter[weekIdx] ?? 0);
        if (deficit > receiverDeficit) {
          receiverDeficit = deficit;
          receiverWeek = weekIdx;
        }

        const surplus = (visitCountsAfter[weekIdx] ?? 0) - (visitTargets[weekIdx] ?? 0);
        if (surplus > donorSurplus && (visitBuckets.get(weekIdx)?.length ?? 0) > 0) {
          donorSurplus = surplus;
          donorWeek = weekIdx;
        }
      }

      if (receiverWeek < 0 || donorWeek < 0 || receiverWeek === donorWeek) break;
      if (receiverDeficit <= 0 || donorSurplus <= 0) break;

      const donorBucket = visitBuckets.get(donorWeek) ?? [];
      if (!donorBucket.length) break;

      // Only move visits that can reduce the current deficit; avoid oscillating 2-point visits.
      const phaseMoveIndex = donorBucket.findIndex((entry) => entry.weight <= receiverDeficit);
      if (phaseMoveIndex < 0) break;
      const selectedIndex = phaseMoveIndex;
      const [picked] = donorBucket.splice(selectedIndex, 1);
      if (!picked) break;

      const movedWindowStart = addDays(weekStarts[receiverWeek]!, 1 + drawInt(trialPhaseRandom, 0, 2));
      const movedEstimatedDate = addDays(movedWindowStart, 1 + drawInt(trialPhaseRandom, 1, 2));
      const movedWindowEnd = addDays(movedWindowStart, 3 + drawInt(trialPhaseRandom, 0, 2));

      if (apply) {
        await db
          .update(mapPhases)
          .set({
            windowStart: movedWindowStart,
            estimatedDate: movedEstimatedDate,
            windowEnd: movedWindowEnd,
            updatedAt: now,
          })
          .where(eq(mapPhases.id, picked.phase.id));
      }

      const donorList = phaseIdsByWeek.get(donorWeek) ?? [];
      const donorPos = donorList.indexOf(picked.phase.id);
      if (donorPos >= 0) donorList.splice(donorPos, 1);
      phaseIdsByWeek.set(donorWeek, donorList);

      const receiverList = phaseIdsByWeek.get(receiverWeek) ?? [];
      receiverList.push(picked.phase.id);
      phaseIdsByWeek.set(receiverWeek, receiverList);

      const receiverBucket = visitBuckets.get(receiverWeek) ?? [];
      receiverBucket.push({
        phase: {
          ...picked.phase,
          windowStart: movedWindowStart,
          estimatedDate: movedEstimatedDate,
          windowEnd: movedWindowEnd,
          updatedAt: now,
        },
        weight: picked.weight,
      });
      visitBuckets.set(receiverWeek, receiverBucket);

      visitCountsAfter[donorWeek] = Math.max(0, (visitCountsAfter[donorWeek] ?? 0) - picked.weight);
      visitCountsAfter[receiverWeek] = (visitCountsAfter[receiverWeek] ?? 0) + picked.weight;
      movedPhasesForTrial += 1;
      summary.movedPhases += 1;
    }

    if (!visitsOnly) {
      const trialTaskRandom = seededRandom(`${trial.trialId}:${trial.mapId}:task-moves`);
      const maxTaskMoves = Math.max(weeks * 48, 192);
      for (let taskMoveCount = 0; taskMoveCount < maxTaskMoves; taskMoveCount += 1) {
        let receiverWeek = -1;
        let receiverDeficit = 0;
        let donorWeek = -1;
        let donorSurplus = 0;

        for (let weekIdx = 0; weekIdx < weeks; weekIdx += 1) {
          const deficit = (taskTargets[weekIdx] ?? 0) - (taskCountsAfter[weekIdx] ?? 0);
          if (deficit > receiverDeficit) {
            receiverDeficit = deficit;
            receiverWeek = weekIdx;
          }

          const surplus = (taskCountsAfter[weekIdx] ?? 0) - (taskTargets[weekIdx] ?? 0);
          if (surplus > donorSurplus && (taskBuckets.get(weekIdx)?.length ?? 0) > 0) {
            donorSurplus = surplus;
            donorWeek = weekIdx;
          }
        }

        if (receiverWeek < 0 || donorWeek < 0 || receiverWeek === donorWeek) break;
        if (receiverDeficit <= 0 || donorSurplus <= 0) break;

        const donorBucket = taskBuckets.get(donorWeek) ?? [];
        const movedTask = donorBucket.pop();
        if (!movedTask) break;

        const movedDueDate = addDays(weekStarts[receiverWeek]!, 1 + drawInt(trialTaskRandom, 1, 5));
        const movedSuggestedDate = addDays(movedDueDate, -drawInt(trialTaskRandom, 1, 3));

        if (apply) {
          await db
            .update(mapTasks)
            .set({
              dueDate: movedDueDate,
              suggestedDate: movedSuggestedDate,
              updatedAt: now,
            })
            .where(eq(mapTasks.id, movedTask.id));
        }

        const receiverBucket = taskBuckets.get(receiverWeek) ?? [];
        receiverBucket.push({
          ...movedTask,
          dueDate: movedDueDate,
          suggestedDate: movedSuggestedDate,
          updatedAt: now,
        });
        taskBuckets.set(receiverWeek, receiverBucket);
        taskCountsAfter[donorWeek] = Math.max(0, (taskCountsAfter[donorWeek] ?? 0) - 1);
        taskCountsAfter[receiverWeek] = (taskCountsAfter[receiverWeek] ?? 0) + 1;
        movedTasksForTrial += 1;
        summary.movedTasks += 1;
      }
    }

    if (reduceTaskGap) {
      const trialTaskDeferralRandom = seededRandom(`${trial.trialId}:${trial.mapId}:task-deferral`);
      for (let weekIdx = 0; weekIdx < weeks; weekIdx += 1) {
        const currentTasks = taskCountsAfter[weekIdx] ?? 0;
        if (currentTasks <= 0) continue;

        const jitterRoll = trialTaskDeferralRandom();
        const jitter = jitterRoll < 0.33 ? -1 : jitterRoll < 0.66 ? 0 : 1;
        const targetTasks = Math.max(
          0,
          Math.round((visitCountsAfter[weekIdx] ?? 0) * taskRatio + taskBias + jitter)
        );
        const surplus = Math.max(0, currentTasks - targetTasks);
        if (surplus <= 0) continue;

        const bucket = taskBuckets.get(weekIdx) ?? [];
        bucket.sort((a, b) => taskDeferralScore(a) - taskDeferralScore(b));
        const deferredTasks = bucket.splice(0, surplus);
        if (!deferredTasks.length) continue;
        taskBuckets.set(weekIdx, bucket);

        for (const task of deferredTasks) {
          const deferredWeek = weeks + 1 + drawInt(trialTaskDeferralRandom, 0, deferSpanWeeks - 1);
          const movedDueDate = addDays(weekStarts[0]!, deferredWeek * 7 + 1 + drawInt(trialTaskDeferralRandom, 0, 4));
          const movedSuggestedDate = addDays(movedDueDate, -drawInt(trialTaskDeferralRandom, 1, 3));

          if (apply) {
            await db
              .update(mapTasks)
              .set({
                dueDate: movedDueDate,
                suggestedDate: movedSuggestedDate,
                updatedAt: now,
              })
              .where(eq(mapTasks.id, task.id));
          }

          taskCountsAfter[weekIdx] = Math.max(0, (taskCountsAfter[weekIdx] ?? 0) - 1);
          deferredTasksForTrial += 1;
          summary.deferredTasks += 1;
        }
      }
    }

    for (let weekIdx = 0; weekIdx < weeks; weekIdx += 1) {
      while (visitCountsAfter[weekIdx]! < (visitTargets[weekIdx] ?? 0)) {
        const phaseId = randomUUID();
        const weekRandom = seededRandom(`${trial.trialId}:${trial.mapId}:visit-create:${weekIdx}:${createdPhasesForTrial}`);
        const windowStart = addDays(weekStarts[weekIdx]!, 1 + drawInt(weekRandom, 0, 2));
        const estimatedDate = addDays(windowStart, 1 + drawInt(weekRandom, 1, 2));
        const windowEnd = addDays(windowStart, 3 + drawInt(weekRandom, 0, 2));
        const phaseRow = {
          id: phaseId,
          mapId: trial.mapId,
          name: `Rebalance Visit W${weekIdx + 1}`,
          phaseType: "follow_up" as const,
          displayOrder: nextDisplayOrder++,
          color: "#14B8A6",
          estimatedDate,
          windowStart,
          windowEnd,
          protocolRef: { generated: true, reason: "weekly_rebalance", week: weekIdx + 1 },
          canvasX: null,
          canvasY: null,
          createdAt: now,
          updatedAt: now,
        };

        if (apply) {
          await db.insert(mapPhases).values(phaseRow);
        }

        phases.push(phaseRow as unknown as MapPhase);
        const list = phaseIdsByWeek.get(weekIdx) ?? [];
        list.push(phaseId);
        phaseIdsByWeek.set(weekIdx, list);
        const visitBucket = visitBuckets.get(weekIdx) ?? [];
        visitBucket.push({ phase: phaseRow as unknown as MapPhase, weight: 1 });
        visitBuckets.set(weekIdx, visitBucket);
        visitCountsAfter[weekIdx] += 1;
        createdPhasesForTrial += 1;
        summary.createdPhases += 1;
      }
    }

    if (!visitsOnly) {
      for (let weekIdx = 0; weekIdx < weeks; weekIdx += 1) {
        const weekPhaseIds = phaseIdsByWeek.get(weekIdx) ?? [];
        const fallbackPhaseId = weekPhaseIds[0] ?? phases[0]!.id;
        if (!fallbackPhaseId) continue;

        while (taskCountsAfter[weekIdx]! < (taskTargets[weekIdx] ?? 0)) {
          const taskId = randomUUID();
          const phaseId = weekPhaseIds.length
            ? weekPhaseIds[createdTasksForTrial % weekPhaseIds.length]!
            : fallbackPhaseId;
          const weekRandom = seededRandom(`${trial.trialId}:${trial.mapId}:task-create:${weekIdx}:${createdTasksForTrial}`);
          const dueDate = addDays(weekStarts[weekIdx]!, 2 + drawInt(weekRandom, 0, 4));
          const suggestedDate = addDays(dueDate, -drawInt(weekRandom, 1, 3));
          const dueWeekStart = startOfIsoWeek(dueDate);
          const createdAnchorWeekStart =
            dueWeekStart.getTime() <= baseWeekStart.getTime() ? addDays(baseWeekStart, 7) : dueWeekStart;
          const createdAt = addDays(createdAnchorWeekStart, 1 + drawInt(weekRandom, 0, 2));
          const nextOrder = (orderByPhase.get(phaseId) ?? -1) + 1;
          orderByPhase.set(phaseId, nextOrder);

          const taskRow = {
            id: taskId,
            mapId: trial.mapId,
            phaseId,
            name: `Rebalance Task W${weekIdx + 1} · ${nextOrder + 1}`,
            description: "System-generated to ensure weekly task coverage per trial.",
            category: "coordination" as const,
            priority: "medium" as const,
            status: "todo" as const,
            blockedReason: null,
            blockedSince: null,
            assignedRole: "study_coordinator" as const,
            assignedUserId: null,
            suggestedAssignee: null,
            suggestedDate,
            dueDate,
            estimatedDuration: 2,
            startDate: null,
            completedDate: null,
            orderInPhase: nextOrder,
            canvasX: null,
            canvasY: null,
            createdBy: "ai" as const,
            aiConfidence: 0.78,
            conditionalNote: null,
            isCustom: false,
            tags: ["future", "rebalance", "weekly-coverage"],
            protocolRefs: [],
            createdAt,
            updatedAt: now,
          };

          if (apply) {
            await db.insert(mapTasks).values(taskRow);
          }

          taskCountsAfter[weekIdx] += 1;
          createdTasksForTrial += 1;
          summary.createdTasks += 1;
        }
      }
    }

    summary.perTrial.push({
      trialId: trial.trialId,
      trialTitle: trial.trialTitle,
      profile,
      taskTargets,
      visitTargets,
      movedPhases: movedPhasesForTrial,
      movedTasks: movedTasksForTrial,
      deferredTasks: deferredTasksForTrial,
      createdPhases: createdPhasesForTrial,
      createdTasks: createdTasksForTrial,
      taskCountsBefore,
      taskCountsAfter,
      visitCountsBefore,
      visitCountsAfter,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[rebalance-next-weeks-per-trial] failed", error);
  process.exit(1);
});
