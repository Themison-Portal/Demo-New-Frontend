import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import { executionMaps, mapTasks, trials, type ExecutionMap, type MapTask } from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

const DONE_STATUSES = new Set(["done", "completed", "skipped", "cancelled"]);
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

function clampDate(date: Date, minDate: Date, maxDate: Date) {
  if (date.getTime() < minDate.getTime()) return new Date(minDate.getTime());
  if (date.getTime() > maxDate.getTime()) return new Date(maxDate.getTime());
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

type Patch = {
  taskId: string;
  trialId: string;
  patch: {
    createdAt?: Date;
    completedDate?: Date | null;
    status?: MapTask["status"];
    blockedSince?: Date | null;
    blockedReason?: string | null;
    updatedAt: Date;
  };
};

function shouldUpdateDate(current: Date | null, target: Date) {
  if (!current) return true;
  return Math.abs(current.getTime() - target.getTime()) >= 60 * 60 * 1000;
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

  const selected = trialRows
    .map((trial) => {
      const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!preferredMap) return null;
      return { trialId: trial.id, trialTitle: trial.title, mapId: preferredMap.id };
    })
    .filter(Boolean) as Array<{ trialId: string; trialTitle: string; mapId: string }>;

  const mapIds = selected.map((row) => row.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, weeks, message: "No maps found." }, null, 2));
    return;
  }

  const tasks = await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds));
  const trialIdByMapId = new Map(selected.map((row) => [row.mapId, row.trialId]));

  const now = new Date();
  const todayStart = startOfDay(now);
  const tomorrow = addDays(todayStart, 1);
  const yesterday = addDays(todayStart, -1);
  const currentWeekStart = startOfIsoWeek(todayStart);
  const futureWindowEnd = addDays(currentWeekStart, weeks * 7);
  const pastWindowStart = addDays(currentWeekStart, -weeks * 7);

  const patches: Patch[] = [];
  const perTrial = new Map<
    string,
    {
      futureAnchored: number;
      pastAnchored: number;
      pastCompletedAdjusted: number;
      pastPromotedToDone: number;
      patches: number;
    }
  >();

  for (const trialId of selected.map((row) => row.trialId)) {
    perTrial.set(trialId, {
      futureAnchored: 0,
      pastAnchored: 0,
      pastCompletedAdjusted: 0,
      pastPromotedToDone: 0,
      patches: 0,
    });
  }

  for (const task of tasks) {
    const trialId = trialIdByMapId.get(task.mapId);
    if (!trialId) continue;

    const dueLike = parseDateValue(task.dueDate) ?? parseDateValue(task.suggestedDate);
    if (!dueLike) continue;

    const dueDay = startOfDay(dueLike);
    const taskHash = stableHash(`${task.id}:${trialId}`);
    const currentCreatedAt = parseDateValue(task.createdAt) ?? parseDateValue(task.updatedAt);
    const currentCompletedDate = parseDateValue(task.completedDate);
    const done = isDoneStatus(task.status);

    let targetCreatedAt: Date | null = null;
    let targetCompletedDate: Date | null | undefined;

    const stats = perTrial.get(trialId)!;

    // Future workload anchors: keep future-due work in its own due week so current week doesn't spike.
    if (!done && dueDay.getTime() >= currentWeekStart.getTime() && dueDay.getTime() < futureWindowEnd.getTime()) {
      const dueWeekStart = startOfIsoWeek(dueDay);
      let candidate: Date;
      if (dueWeekStart.getTime() > currentWeekStart.getTime()) {
        // Keep opened anchor inside the due week (Tue-Thu) to avoid bleeding into current-week history.
        candidate = addDays(dueWeekStart, 1 + (taskHash % 3));
      } else {
        // Due in current week: keep opened anchor in current week with a short realistic lead.
        const leadDays = 2 + (taskHash % 4); // 2..5
        candidate = addDays(dueDay, -leadDays);
      }
      candidate = clampDate(candidate, tomorrow, dueDay);
      targetCreatedAt = candidate;
      stats.futureAnchored += 1;
    }

    // Past anchors: spread historical tasks across prior 12 weeks with realistic lead time.
    const inPastWindow = dueDay.getTime() < todayStart.getTime() && dueDay.getTime() >= pastWindowStart.getTime();
    if (inPastWindow) {
      const leadDays = 3 + (taskHash % 10); // 3..12
      let candidate = addDays(dueDay, -leadDays);
      if (candidate.getTime() < pastWindowStart.getTime()) {
        candidate = addDays(pastWindowStart, taskHash % 5);
      }
      if (candidate.getTime() >= dueDay.getTime()) {
        candidate = addDays(dueDay, -1);
      }
      targetCreatedAt = candidate;
      stats.pastAnchored += 1;

      if (done) {
        const completionLag = taskHash % 6; // 0..5 days after due
        let completed = addDays(dueDay, completionLag);
        if (targetCreatedAt && completed.getTime() <= targetCreatedAt.getTime()) {
          completed = addDays(targetCreatedAt, 1);
        }
        if (completed.getTime() >= todayStart.getTime()) {
          completed = yesterday;
        }
        if (completed.getTime() < pastWindowStart.getTime()) {
          completed = addDays(pastWindowStart, 1);
        }
        targetCompletedDate = completed;
        stats.pastCompletedAdjusted += 1;
      }
    }

    if (!targetCreatedAt && targetCompletedDate === undefined) continue;

    const patch: Patch["patch"] = { updatedAt: now };
    let hasChange = false;

    if (targetCreatedAt && shouldUpdateDate(currentCreatedAt, targetCreatedAt)) {
      patch.createdAt = targetCreatedAt;
      hasChange = true;
    }

    if (targetCompletedDate !== undefined) {
      if (targetCompletedDate === null) {
        if (currentCompletedDate !== null) {
          patch.completedDate = null;
          hasChange = true;
        }
      } else if (shouldUpdateDate(currentCompletedDate, targetCompletedDate)) {
        patch.completedDate = targetCompletedDate;
        hasChange = true;
      }
    }

    if (inPastWindow && !done) {
      // Convert a stable subset of past-due open tasks into done tasks for richer historical variance.
      const promoteToDone = taskHash % 100 < 44; // ~44%
      if (promoteToDone) {
        let syntheticCompleted = addDays(dueDay, taskHash % 6);
        if (targetCreatedAt && syntheticCompleted.getTime() <= targetCreatedAt.getTime()) {
          syntheticCompleted = addDays(targetCreatedAt, 1);
        }
        if (syntheticCompleted.getTime() >= todayStart.getTime()) {
          syntheticCompleted = yesterday;
        }
        if (syntheticCompleted.getTime() < pastWindowStart.getTime()) {
          syntheticCompleted = addDays(pastWindowStart, 1);
        }

        patch.status = "done";
        patch.blockedReason = null;
        patch.blockedSince = null;
        if (shouldUpdateDate(currentCompletedDate, syntheticCompleted)) {
          patch.completedDate = syntheticCompleted;
        }
        hasChange = true;
        stats.pastPromotedToDone += 1;
      }
    }

    if (!hasChange) continue;
    stats.patches += 1;
    patches.push({ taskId: task.id, trialId, patch });
  }

  if (apply && patches.length > 0) {
    for (const row of patches) {
      await db.update(mapTasks).set(row.patch).where(eq(mapTasks.id, row.taskId));
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        weeks,
        trials: selected.length,
        tasksScanned: tasks.length,
        patchesPlanned: patches.length,
        patchesApplied: apply ? patches.length : 0,
        perTrial: selected.map((row) => ({
          trialId: row.trialId,
          trialTitle: row.trialTitle,
          ...(perTrial.get(row.trialId) ?? {
            futureAnchored: 0,
            pastAnchored: 0,
            pastCompletedAdjusted: 0,
            pastPromotedToDone: 0,
            patches: 0,
          }),
        })),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[separate-past-future-anchors] failed", error);
  process.exit(1);
});
