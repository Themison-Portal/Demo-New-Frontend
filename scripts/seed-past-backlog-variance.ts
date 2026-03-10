import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapPhases, mapTasks, trials, type ExecutionMap, type MapPhase, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

const HISTORY_TAG = "history-seed-v2";
const HISTORY_TAGS = [HISTORY_TAG, "backlog-variance"];

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
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

function hasHistoryTag(task: MapTask) {
  if (!Array.isArray(task.tags)) return false;
  return task.tags.some((tag) => String(tag).toLowerCase() === HISTORY_TAG);
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const weeksArg = argv.find((arg) => arg.startsWith("--weeks="));
  const perTrialArg = argv.find((arg) => arg.startsWith("--per-trial="));
  const openRatioArg = argv.find((arg) => arg.startsWith("--open-ratio="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const weeks = weeksArg ? Number(weeksArg.replace("--weeks=", "")) : 12;
  if (!Number.isFinite(weeks) || weeks < 8 || weeks > 24) {
    throw new Error("weeks must be between 8 and 24");
  }

  const perTrial = perTrialArg ? Number(perTrialArg.replace("--per-trial=", "")) : 24;
  if (!Number.isFinite(perTrial) || perTrial < 8 || perTrial > 80) {
    throw new Error("per-trial must be between 8 and 80");
  }

  const openRatio = openRatioArg ? Number(openRatioArg.replace("--open-ratio=", "")) : 0.22;
  if (!Number.isFinite(openRatio) || openRatio < 0.05 || openRatio > 0.5) {
    throw new Error("open-ratio must be between 0.05 and 0.5");
  }

  return {
    apply,
    mode,
    weeks: Math.floor(weeks),
    perTrial: Math.floor(perTrial),
    openRatio,
  };
}

async function main() {
  const { apply, mode, weeks, perTrial, openRatio } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, mode, weeks, perTrial, message: "No trials found." }, null, 2));
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
      const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!preferredMap) return null;
      return {
        trialId: trial.id,
        trialTitle: trial.title,
        mapId: preferredMap.id,
      };
    })
    .filter(Boolean) as Array<{ trialId: string; trialTitle: string; mapId: string }>;

  if (!selected.length) {
    console.log(JSON.stringify({ apply, mode, weeks, perTrial, message: "No maps found." }, null, 2));
    return;
  }

  const mapIds = selected.map((row) => row.mapId);
  const phaseRows = await db
    .select()
    .from(mapPhases)
    .where(inArray(mapPhases.mapId, mapIds))
    .orderBy(asc(mapPhases.mapId), asc(mapPhases.displayOrder), asc(mapPhases.createdAt));
  const taskRows = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));

  const phasesByMapId = new Map<string, MapPhase[]>();
  for (const row of phaseRows) {
    const list = phasesByMapId.get(row.mapId) ?? [];
    list.push(row);
    phasesByMapId.set(row.mapId, list);
  }
  const tasksByMapId = new Map<string, MapTask[]>();
  for (const row of taskRows) {
    const list = tasksByMapId.get(row.mapId) ?? [];
    list.push(row);
    tasksByMapId.set(row.mapId, list);
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentWeekStart = startOfIsoWeek(today);
  const weekStarts = Array.from({ length: weeks }, (_, index) =>
    addDays(currentWeekStart, -((weeks - 1 - index) * 7))
  );

  let deletedHistorySeedTasks = 0;
  let insertedTasks = 0;
  const perTrialSummary: Array<Record<string, unknown>> = [];

  for (const trial of selected) {
    const mapPhasesRows = phasesByMapId.get(trial.mapId) ?? [];
    const mapTaskRows = tasksByMapId.get(trial.mapId) ?? [];
    const existingSeedTasks = mapTaskRows.filter(hasHistoryTag);

    if (apply) {
      for (const existing of existingSeedTasks) {
        await db.delete(mapTasks).where(eq(mapTasks.id, existing.id));
      }
    }
    deletedHistorySeedTasks += existingSeedTasks.length;

    if (!mapPhasesRows.length) {
      perTrialSummary.push({
        trialId: trial.trialId,
        trialTitle: trial.trialTitle,
        skipped: true,
        reason: "No phases",
      });
      continue;
    }

    const random = seededRandom(`history-seed:${trial.trialId}:${trial.mapId}:${weeks}:${perTrial}`);
    const statusWave = [0.18, 0.22, 0.26, 0.24, 0.2, 0.28, 0.16, 0.32, 0.2, 0.24, 0.34, 0.3];
    const openTarget = Math.max(1, Math.round(perTrial * openRatio));
    const doneTarget = Math.max(1, perTrial - openTarget);
    const insertRows: Array<Parameters<typeof db.insert<typeof mapTasks>>[0]["values"] extends (infer T)[] ? T : never> = [];

    let doneCount = 0;
    let openCount = 0;

    for (let index = 0; index < perTrial; index += 1) {
      const weekIndex = (index + (stableHash(trial.trialId) % weeks)) % weeks;
      const weekStart = weekStarts[weekIndex]!;
      const phase = mapPhasesRows[index % mapPhasesRows.length]!;
      const dueDate = addDays(weekStart, 1 + drawInt(random, 0, 4));
      const suggestedDate = addDays(dueDate, -drawInt(random, 1, 3));
      const createdAt = addDays(dueDate, -(3 + drawInt(random, 0, 9)));

      const wave = statusWave[weekIndex % statusWave.length] ?? 0.22;
      const shouldBeOpenByWave = random() < wave;
      const forceDone = doneCount < doneTarget && perTrial - index <= doneTarget - doneCount;
      const forceOpen = openCount < openTarget && perTrial - index <= openTarget - openCount;
      const makeOpen =
        !forceDone &&
        (forceOpen || (shouldBeOpenByWave && openCount < openTarget) || (doneCount >= doneTarget && openCount < openTarget));

      let status: MapTask["status"];
      let completedDate: Date | null = null;
      let blockedSince: Date | null = null;
      let blockedReason: string | null = null;

      if (makeOpen) {
        if (random() < 0.32) {
          status = "blocked";
          blockedSince = addDays(dueDate, drawInt(random, 0, 3));
          blockedReason = "Awaiting sponsor follow-up packet";
        } else if (random() < 0.2) {
          status = "in_progress";
        } else {
          status = "todo";
        }
        openCount += 1;
      } else {
        status = "done";
        completedDate = addDays(dueDate, drawInt(random, 0, 4));
        if (completedDate.getTime() >= today.getTime()) {
          completedDate = addDays(today, -1);
        }
        doneCount += 1;
      }

      const assignedUserId = ((index + (stableHash(`${trial.trialId}:assignee`) % 13)) % 13) + 1;
      const taskId = randomUUID();
      const orderInPhase = 900 + index;

      insertRows.push({
        id: taskId,
        mapId: trial.mapId,
        phaseId: phase.id,
        name: `Historical backlog task W${weekIndex + 1} · ${index + 1}`,
        description: "Synthetic historical task for backlog variability in sample mode.",
        category: "coordination",
        priority: random() < 0.22 ? "high" : "medium",
        status,
        blockedReason,
        blockedSince,
        assignedRole: "study_coordinator",
        assignedUserId,
        suggestedAssignee: null,
        suggestedDate,
        dueDate,
        estimatedDuration: 2,
        startDate: null,
        completedDate,
        orderInPhase,
        canvasX: null,
        canvasY: null,
        createdBy: "ai",
        aiConfidence: 0.79,
        conditionalNote: null,
        isCustom: false,
        tags: HISTORY_TAGS,
        protocolRefs: [],
        createdAt,
        updatedAt: now,
      });
    }

    if (apply && insertRows.length) {
      await db.insert(mapTasks).values(insertRows);
    }
    insertedTasks += insertRows.length;

    perTrialSummary.push({
      trialId: trial.trialId,
      trialTitle: trial.trialTitle,
      deletedHistorySeedTasks: existingSeedTasks.length,
      insertedHistoryTasks: insertRows.length,
      doneInserted: doneCount,
      openInserted: openCount,
    });
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        weeks,
        perTrial,
        trials: selected.length,
        deletedHistorySeedTasks,
        insertedTasks,
        perTrialSummary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[seed-past-backlog-variance] failed", error);
  process.exit(1);
});
