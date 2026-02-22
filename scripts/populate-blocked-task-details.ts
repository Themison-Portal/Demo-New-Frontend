import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";
type BlockedReasonCategory = "External" | "Internal" | "Patient" | "System/Data" | "Scheduled/Timing";
type BlockerEntityValue =
  | "sponsor"
  | "cro"
  | "vendor"
  | "pi"
  | "lab"
  | "imaging"
  | "pathology"
  | "pharmacy"
  | "radiology"
  | "finance_legal"
  | "patient"
  | "internal_team"
  | "other";

type TrialTarget = {
  trialId: string;
  trialTitle: string;
  mapId: string;
};

type ReasonDefinition = {
  category: BlockedReasonCategory;
  reasonCode: string;
  waitingOnCandidates: BlockerEntityValue[];
  inputCandidates: BlockerEntityValue[];
};

type PlannedDetails = {
  taskId: string;
  trialId: string;
  mapId: string;
  blockedSince: Date;
  expectedResolutionDate: string | null;
  category: BlockedReasonCategory;
  reasonCode: string;
  waitingOn: BlockerEntityValue;
  requiresInputFrom: BlockerEntityValue[];
  reasonPayload: string;
  ageBucket: "this_week" | "days_3_5" | "weeks_1_2" | "weeks_3_plus";
};

const BLOCKER_META_PREFIX = "__blocker_meta_v1__:";
const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};
const DAY_MS = 24 * 60 * 60 * 1000;
const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);

const CATEGORY_WEIGHTS: Array<{ category: BlockedReasonCategory; weight: number }> = [
  { category: "External", weight: 0.3 },
  { category: "Internal", weight: 0.25 },
  { category: "Patient", weight: 0.2 },
  { category: "System/Data", weight: 0.1 },
  { category: "Scheduled/Timing", weight: 0.15 },
];

const REASONS: ReasonDefinition[] = [
  {
    category: "External",
    reasonCode: "awaiting_sponsor_cro_response",
    waitingOnCandidates: ["sponsor", "cro"],
    inputCandidates: ["pi", "internal_team", "lab", "imaging"],
  },
  {
    category: "External",
    reasonCode: "awaiting_sponsor_cro_approval",
    waitingOnCandidates: ["sponsor", "cro"],
    inputCandidates: ["pi", "internal_team", "finance_legal"],
  },
  {
    category: "External",
    reasonCode: "awaiting_vendor_delivery",
    waitingOnCandidates: ["vendor"],
    inputCandidates: ["pharmacy", "lab", "internal_team"],
  },
  {
    category: "External",
    reasonCode: "awaiting_central_lab_imaging_result",
    waitingOnCandidates: ["lab", "imaging", "radiology"],
    inputCandidates: ["pathology", "pi", "internal_team"],
  },
  {
    category: "External",
    reasonCode: "awaiting_regulatory_irb_feedback",
    waitingOnCandidates: ["other"],
    inputCandidates: ["sponsor", "cro", "internal_team", "finance_legal"],
  },
  {
    category: "Internal",
    reasonCode: "awaiting_pi_sign_off",
    waitingOnCandidates: ["pi"],
    inputCandidates: ["internal_team", "lab", "pharmacy"],
  },
  {
    category: "Internal",
    reasonCode: "awaiting_internal_department_handoff",
    waitingOnCandidates: ["internal_team", "lab", "imaging", "pathology", "pharmacy", "radiology"],
    inputCandidates: ["pi", "finance_legal", "patient"],
  },
  {
    category: "Internal",
    reasonCode: "awaiting_internal_admin_contracting",
    waitingOnCandidates: ["finance_legal", "internal_team"],
    inputCandidates: ["sponsor", "cro", "pi"],
  },
  {
    category: "Internal",
    reasonCode: "resource_constraint",
    waitingOnCandidates: ["internal_team"],
    inputCandidates: ["pi", "pharmacy", "lab", "imaging"],
  },
  {
    category: "Internal",
    reasonCode: "awaiting_training_certification",
    waitingOnCandidates: ["internal_team"],
    inputCandidates: ["pi", "sponsor", "cro"],
  },
  {
    category: "Patient",
    reasonCode: "patient_scheduling_issue",
    waitingOnCandidates: ["patient"],
    inputCandidates: ["internal_team", "pi", "vendor"],
  },
  {
    category: "Patient",
    reasonCode: "patient_adherence_issue",
    waitingOnCandidates: ["patient"],
    inputCandidates: ["pi", "internal_team"],
  },
  {
    category: "Patient",
    reasonCode: "consent_pending",
    waitingOnCandidates: ["patient", "pi"],
    inputCandidates: ["internal_team", "sponsor"],
  },
  {
    category: "System/Data",
    reasonCode: "system_access_issue",
    waitingOnCandidates: ["internal_team", "other"],
    inputCandidates: ["sponsor", "cro", "pi"],
  },
  {
    category: "System/Data",
    reasonCode: "source_data_not_available",
    waitingOnCandidates: ["lab", "pathology", "internal_team"],
    inputCandidates: ["pi", "imaging", "radiology"],
  },
  {
    category: "Scheduled/Timing",
    reasonCode: "protocol_mandated_waiting_period",
    waitingOnCandidates: ["internal_team"],
    inputCandidates: ["pi", "patient"],
  },
  {
    category: "Scheduled/Timing",
    reasonCode: "scheduled_visit_not_yet_due",
    waitingOnCandidates: ["internal_team", "patient"],
    inputCandidates: ["pi", "lab", "imaging"],
  },
  {
    category: "Scheduled/Timing",
    reasonCode: "sample_result_processing_in_progress",
    waitingOnCandidates: ["lab", "pathology", "imaging"],
    inputCandidates: ["pi", "internal_team"],
  },
  {
    category: "Scheduled/Timing",
    reasonCode: "regulatory_ethics_review_in_progress",
    waitingOnCandidates: ["other", "sponsor"],
    inputCandidates: ["cro", "internal_team", "finance_legal"],
  },
  {
    category: "Scheduled/Timing",
    reasonCode: "amendment_under_review",
    waitingOnCandidates: ["sponsor", "cro", "other"],
    inputCandidates: ["pi", "internal_team", "finance_legal"],
  },
];

const GLOBAL_INPUT_FALLBACK: BlockerEntityValue[] = [
  "sponsor",
  "cro",
  "vendor",
  "pi",
  "lab",
  "imaging",
  "pathology",
  "pharmacy",
  "radiology",
  "finance_legal",
  "patient",
  "internal_team",
  "other",
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

function pickOne<T>(items: T[], nextRandom: () => number) {
  if (!items.length) throw new Error("Cannot pick from empty array");
  return items[drawInt(nextRandom, 0, items.length - 1)]!;
}

function pickUnique<T>(items: T[], count: number, nextRandom: () => number) {
  const pool = [...items];
  const picked: T[] = [];
  const max = Math.min(pool.length, Math.max(0, count));
  while (picked.length < max && pool.length > 0) {
    const index = drawInt(nextRandom, 0, pool.length - 1);
    const [value] = pool.splice(index, 1);
    if (value !== undefined) picked.push(value);
  }
  return picked;
}

function startOfDay(source: Date) {
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

function addDays(source: Date, days: number) {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function toDateToken(source: Date) {
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDoneStatus(status: MapTask["status"]) {
  return DONE_STATUSES.has(normalizeToken(status));
}

function promotionScore(task: MapTask, now: Date) {
  const status = normalizeToken(task.status);
  const priority = normalizeToken(task.priority);
  const dueLike = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);

  let score = 0;
  score += status === "in_progress" ? 6 : status === "todo" ? 4 : 2;
  score +=
    priority === "critical" ? 5 :
    priority === "high" ? 4 :
    priority === "medium" ? 2 :
    priority === "low" ? 1 : 2;

  if (dueLike) {
    const daysToDue = Math.floor((dueLike.getTime() - now.getTime()) / DAY_MS);
    if (daysToDue < 0) score += 6;
    else if (daysToDue <= 7) score += 5;
    else if (daysToDue <= 21) score += 3;
    else score += 1;
  }

  score += (stableHash(task.id) % 1000) / 1000;
  return score;
}

function buildCategoryTargets(total: number) {
  if (total <= 0) return new Map<BlockedReasonCategory, number>();
  const exact = CATEGORY_WEIGHTS.map(({ category, weight }) => {
    const precise = total * weight;
    const floor = Math.floor(precise);
    return { category, precise, floor, remainder: precise - floor };
  });
  let remaining = total - exact.reduce((sum, row) => sum + row.floor, 0);
  const sorted = [...exact].sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < sorted.length && remaining > 0; index += 1) {
    sorted[index]!.floor += 1;
    remaining -= 1;
  }
  return new Map(sorted.map((row) => [row.category, row.floor]));
}

function buildAgeBucketPlan(total: number) {
  if (total <= 0) return [] as Array<PlannedDetails["ageBucket"]>;

  let longCount = total >= 16 ? 3 : total >= 10 ? 2 : total >= 6 ? 1 : 0;
  let oneToTwoWeeks = total >= 5 ? Math.max(1, Math.round(total * 0.2)) : total >= 3 ? 1 : 0;
  let threeToFiveDays = total >= 3 ? Math.max(1, Math.round(total * 0.32)) : 1;

  while (longCount + oneToTwoWeeks + threeToFiveDays > total) {
    if (threeToFiveDays > 1) threeToFiveDays -= 1;
    else if (oneToTwoWeeks > 1) oneToTwoWeeks -= 1;
    else if (longCount > 0) longCount -= 1;
    else break;
  }

  let thisWeek = total - longCount - oneToTwoWeeks - threeToFiveDays;
  if (total > 0 && thisWeek <= 0) {
    if (threeToFiveDays > 1) {
      threeToFiveDays -= 1;
      thisWeek += 1;
    } else if (oneToTwoWeeks > 1) {
      oneToTwoWeeks -= 1;
      thisWeek += 1;
    } else if (longCount > 0) {
      longCount -= 1;
      thisWeek += 1;
    }
  }

  const buckets: Array<PlannedDetails["ageBucket"]> = [];
  for (let index = 0; index < thisWeek; index += 1) buckets.push("this_week");
  for (let index = 0; index < threeToFiveDays; index += 1) buckets.push("days_3_5");
  for (let index = 0; index < oneToTwoWeeks; index += 1) buckets.push("weeks_1_2");
  for (let index = 0; index < longCount; index += 1) buckets.push("weeks_3_plus");
  return buckets;
}

function buildBlockedSinceFromBucket(bucket: PlannedDetails["ageBucket"], nextRandom: () => number, today: Date) {
  const baseDay = startOfDay(today);
  const ageDays =
    bucket === "this_week"
      ? drawInt(nextRandom, 0, 2)
      : bucket === "days_3_5"
      ? drawInt(nextRandom, 3, 5)
      : bucket === "weeks_1_2"
      ? drawInt(nextRandom, 7, 14)
      : drawInt(nextRandom, 22, 35);

  const blockedDay = addDays(baseDay, -ageDays);
  const hour = drawInt(nextRandom, 8, 17);
  const minute = drawInt(nextRandom, 0, 59);
  blockedDay.setHours(hour, minute, 0, 0);
  return blockedDay;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const includeWaiting = argv.includes("--include-waiting");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const targetBlockedArg = argv.find((arg) => arg.startsWith("--target-blocked="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "all") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }
  const targetBlocked = targetBlockedArg ? Number(targetBlockedArg.replace("--target-blocked=", "")) : null;
  if (targetBlocked !== null && (!Number.isFinite(targetBlocked) || targetBlocked < 0)) {
    throw new Error("target-blocked must be a non-negative integer");
  }
  return {
    apply,
    includeWaiting,
    mode,
    targetBlocked: targetBlocked === null ? null : Math.floor(targetBlocked),
  };
}

function encodeReasonPayload(args: {
  reasonCode: string;
  waitingOn: BlockerEntityValue;
  requiresInputFrom: BlockerEntityValue[];
  expectedResolutionDate: string | null;
}) {
  const payload = {
    reasonCode: args.reasonCode,
    waitingOn: args.waitingOn,
    requiresInputFrom: args.requiresInputFrom,
    fallbackReason: null,
    expectedResolutionDate: args.expectedResolutionDate,
  };
  return `${BLOCKER_META_PREFIX}${JSON.stringify(payload)}`;
}

async function main() {
  const { apply, includeWaiting, mode, targetBlocked } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, includeWaiting, mode, message: "No trials found." }, null, 2));
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
    console.log(JSON.stringify({ apply, includeWaiting, mode, message: "No preferred maps found." }, null, 2));
    return;
  }

  const allMapTasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const mapToTrial = new Map(chosenTrials.map((trial) => [trial.mapId, trial]));

  const blockedStatusTokens = includeWaiting ? new Set(["blocked", "waiting"]) : new Set(["blocked"]);
  const blockedLikeStatusTokens = new Set(["blocked", "waiting"]);
  const currentlyBlockedTasks = allMapTasks.filter((task) => blockedStatusTokens.has(normalizeToken(task.status)));
  const blockedLikeTasks = allMapTasks.filter((task) => blockedLikeStatusTokens.has(normalizeToken(task.status)));

  const desiredBlockedCount =
    targetBlocked === null ? currentlyBlockedTasks.length : Math.max(currentlyBlockedTasks.length, targetBlocked);
  const promoteNeeded = Math.max(0, desiredBlockedCount - currentlyBlockedTasks.length);

  const promotableTasks = allMapTasks.filter((task) => {
    const status = normalizeToken(task.status);
    return !isDoneStatus(task.status) && !blockedLikeStatusTokens.has(status);
  });

  const now = new Date();
  const promotableByTrial = new Map<string, MapTask[]>();
  for (const task of promotableTasks) {
    const owner = mapToTrial.get(task.mapId);
    if (!owner) continue;
    const list = promotableByTrial.get(owner.trialId) ?? [];
    list.push(task);
    promotableByTrial.set(owner.trialId, list);
  }
  for (const [trialId, tasks] of promotableByTrial.entries()) {
    tasks.sort((a, b) => {
      const scoreDiff = promotionScore(b, now) - promotionScore(a, now);
      if (scoreDiff !== 0) return scoreDiff;
      return a.id.localeCompare(b.id);
    });
    promotableByTrial.set(trialId, tasks);
  }

  const trialRotation = [...promotableByTrial.keys()].sort((a, b) => {
    const sizeDiff = (promotableByTrial.get(b)?.length ?? 0) - (promotableByTrial.get(a)?.length ?? 0);
    if (sizeDiff !== 0) return sizeDiff;
    return stableHash(`${a}:${mode}`) - stableHash(`${b}:${mode}`);
  });

  const promotedTasks: MapTask[] = [];
  if (promoteNeeded > 0 && trialRotation.length > 0) {
    while (promotedTasks.length < promoteNeeded) {
      let progressed = false;
      for (const trialId of trialRotation) {
        if (promotedTasks.length >= promoteNeeded) break;
        const queue = promotableByTrial.get(trialId);
        if (!queue || queue.length === 0) continue;
        const task = queue.shift();
        if (!task) continue;
        promotedTasks.push(task);
        progressed = true;
      }
      if (!progressed) break;
    }
  }

  const finalBlockedTasks = [...currentlyBlockedTasks, ...promotedTasks];
  if (!finalBlockedTasks.length) {
    console.log(
      JSON.stringify(
        {
          apply,
          includeWaiting,
          mode,
          selectedTrials: chosenTrials.length,
          message: "No blocked tasks available to populate.",
        },
        null,
        2
      )
    );
    return;
  }

  const taskToTrial = new Map<string, TrialTarget>();
  for (const task of allMapTasks) {
    const owner = mapToTrial.get(task.mapId);
    if (owner) taskToTrial.set(task.id, owner);
  }

  const categoryTargets = buildCategoryTargets(finalBlockedTasks.length);
  const unassignedCategories = Array.from(categoryTargets.entries()).flatMap(([category, count]) =>
    Array.from({ length: count }, () => category)
  );

  const nextRandom = seededRandom(`populate-blocked-details:${mode}:${finalBlockedTasks.length}:${promotedTasks.length}`);
  const tasksOrdered = [...finalBlockedTasks].sort((a, b) => {
    const hashDiff = stableHash(`${a.id}:${mode}`) - stableHash(`${b.id}:${mode}`);
    if (hashDiff !== 0) return hashDiff;
    return a.id.localeCompare(b.id);
  });

  const shuffledCategories = [...unassignedCategories];
  for (let index = shuffledCategories.length - 1; index > 0; index -= 1) {
    const swapIndex = drawInt(nextRandom, 0, index);
    const temp = shuffledCategories[index]!;
    shuffledCategories[index] = shuffledCategories[swapIndex]!;
    shuffledCategories[swapIndex] = temp;
  }

  const today = new Date();
  const ageBuckets = buildAgeBucketPlan(tasksOrdered.length);
  const shuffledBuckets = [...ageBuckets];
  for (let index = shuffledBuckets.length - 1; index > 0; index -= 1) {
    const swapIndex = drawInt(nextRandom, 0, index);
    const temp = shuffledBuckets[index]!;
    shuffledBuckets[index] = shuffledBuckets[swapIndex]!;
    shuffledBuckets[swapIndex] = temp;
  }

  const requiresInputTarget = Math.round(tasksOrdered.length * 0.4);
  const withInputIndexes = new Set<number>(
    pickUnique(
      Array.from({ length: tasksOrdered.length }, (_, index) => index),
      Math.min(tasksOrdered.length, Math.max(0, requiresInputTarget)),
      nextRandom
    )
  );

  const expectedDateBlankTarget =
    tasksOrdered.length >= 15 ? 3 : tasksOrdered.length >= 8 ? 2 : tasksOrdered.length >= 4 ? 1 : 0;
  const noExpectedDateIndexes = new Set<number>(
    pickUnique(
      Array.from({ length: tasksOrdered.length }, (_, index) => index),
      Math.min(tasksOrdered.length, expectedDateBlankTarget),
      nextRandom
    )
  );

  const reasonsByCategory = new Map<BlockedReasonCategory, ReasonDefinition[]>();
  for (const reason of REASONS) {
    const list = reasonsByCategory.get(reason.category) ?? [];
    list.push(reason);
    reasonsByCategory.set(reason.category, list);
  }

  const plans: PlannedDetails[] = [];
  for (let index = 0; index < tasksOrdered.length; index += 1) {
    const task = tasksOrdered[index]!;
    const trial = taskToTrial.get(task.id);
    if (!trial) continue;

    const category = shuffledCategories[index] ?? "Internal";
    const reasonPool = reasonsByCategory.get(category) ?? [];
    const reason = reasonPool.length ? pickOne(reasonPool, nextRandom) : pickOne(REASONS, nextRandom);
    const waitingOn = pickOne(reason.waitingOnCandidates, nextRandom);

    const wantsInput = withInputIndexes.has(index);
    let requiresInputFrom: BlockerEntityValue[] = [];
    if (wantsInput) {
      const candidatePool = Array.from(
        new Set([...reason.inputCandidates, ...GLOBAL_INPUT_FALLBACK].filter((entity) => entity !== waitingOn))
      );
      const inputCount = candidatePool.length >= 2 && nextRandom() < 0.35 ? 2 : 1;
      requiresInputFrom = pickUnique(candidatePool, inputCount, nextRandom);
    }

    const ageBucket = shuffledBuckets[index] ?? "days_3_5";
    const blockedSince = buildBlockedSinceFromBucket(ageBucket, nextRandom, today);
    const expectedResolutionDate = noExpectedDateIndexes.has(index)
      ? null
      : toDateToken(addDays(startOfDay(blockedSince), drawInt(nextRandom, 2, 7)));

    const reasonPayload = encodeReasonPayload({
      reasonCode: reason.reasonCode,
      waitingOn,
      requiresInputFrom,
      expectedResolutionDate,
    });

    plans.push({
      taskId: task.id,
      trialId: trial.trialId,
      mapId: task.mapId,
      blockedSince,
      expectedResolutionDate,
      category,
      reasonCode: reason.reasonCode,
      waitingOn,
      requiresInputFrom,
      reasonPayload,
      ageBucket,
    });
  }

  const promotedTaskIds = new Set(promotedTasks.map((task) => task.id));
  const waitingTaskIds = new Set(
    finalBlockedTasks.filter((task) => normalizeToken(task.status) === "waiting").map((task) => task.id)
  );

  if (apply) {
    for (const plan of plans) {
      const shouldForceBlockedStatus = promotedTaskIds.has(plan.taskId) || waitingTaskIds.has(plan.taskId);
      await db
        .update(mapTasks)
        .set({
          ...(shouldForceBlockedStatus ? { status: "blocked" as const, completedDate: null } : {}),
          blockedReason: plan.reasonPayload,
          blockedSince: plan.blockedSince,
        })
        .where(eq(mapTasks.id, plan.taskId));
    }
  }

  const categoryCounts = new Map<BlockedReasonCategory, number>();
  const waitingOnCounts = new Map<string, number>();
  const ageBucketCounts = new Map<string, number>();
  let withRequiresInput = 0;
  let withoutExpected = 0;
  let withOneInput = 0;
  let withTwoInputs = 0;

  for (const plan of plans) {
    categoryCounts.set(plan.category, (categoryCounts.get(plan.category) ?? 0) + 1);
    waitingOnCounts.set(plan.waitingOn, (waitingOnCounts.get(plan.waitingOn) ?? 0) + 1);
    ageBucketCounts.set(plan.ageBucket, (ageBucketCounts.get(plan.ageBucket) ?? 0) + 1);
    if (plan.requiresInputFrom.length > 0) {
      withRequiresInput += 1;
      if (plan.requiresInputFrom.length === 1) withOneInput += 1;
      if (plan.requiresInputFrom.length === 2) withTwoInputs += 1;
    }
    if (!plan.expectedResolutionDate) withoutExpected += 1;
  }

  const perTrialCounts = new Map<string, number>();
  for (const plan of plans) {
    perTrialCounts.set(plan.trialId, (perTrialCounts.get(plan.trialId) ?? 0) + 1);
  }

  console.log(
    JSON.stringify(
      {
        apply,
        includeWaiting,
        mode,
        targetBlocked,
        selectedTrials: chosenTrials.length,
        blockedTasksFound: currentlyBlockedTasks.length,
        blockedLikeTasksFound: blockedLikeTasks.length,
        promoteNeeded,
        promotedToBlocked: promotedTasks.length,
        blockedTasksAfterPlanning: finalBlockedTasks.length,
        blockedTasksPlanned: plans.length,
        distribution: {
          categoryCounts: Object.fromEntries(
            CATEGORY_WEIGHTS.map(({ category }) => [category, categoryCounts.get(category) ?? 0])
          ),
          categoryRatios: Object.fromEntries(
            CATEGORY_WEIGHTS.map(({ category }) => [
              category,
              plans.length > 0 ? Number(((categoryCounts.get(category) ?? 0) / plans.length).toFixed(3)) : 0,
            ])
          ),
          waitingOnCounts: Object.fromEntries([...waitingOnCounts.entries()].sort((a, b) => b[1] - a[1])),
          requiresInput: {
            tasksWithRequiresInput: withRequiresInput,
            ratio: plans.length > 0 ? Number((withRequiresInput / plans.length).toFixed(3)) : 0,
            withOneInput,
            withTwoInputs,
          },
          blockedSinceBuckets: Object.fromEntries(ageBucketCounts.entries()),
          expectedResolution: {
            withDate: plans.length - withoutExpected,
            withoutDate: withoutExpected,
          },
        },
        perTrialBlockedCounts: Object.fromEntries([...perTrialCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)),
        sample: plans.slice(0, 8).map((plan) => ({
          taskId: plan.taskId,
          trialId: plan.trialId,
          category: plan.category,
          reasonCode: plan.reasonCode,
          waitingOn: plan.waitingOn,
          requiresInputFrom: plan.requiresInputFrom,
          blockedSince: plan.blockedSince.toISOString(),
          expectedResolutionDate: plan.expectedResolutionDate,
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[populate-blocked-task-details] failed", error);
  process.exit(1);
});
