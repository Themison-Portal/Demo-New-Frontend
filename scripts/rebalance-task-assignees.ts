import { desc, eq, inArray, like, notLike, type SQL } from "drizzle-orm";
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

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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

function dateValue(value: Date | null | undefined) {
  if (!(value instanceof Date)) return Number.POSITIVE_INFINITY;
  const time = value.getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function isOpenTask(task: MapTask) {
  return !DONE_STATUSES.has(normalize(task.status));
}

function normalizeUserId(value: unknown) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function countsByMember(tasks: MapTask[], memberIds: number[]) {
  const counts = new Map<number, number>(memberIds.map((id) => [id, 0]));
  let unassigned = 0;
  let otherAssigned = 0;

  for (const task of tasks) {
    if (!isOpenTask(task)) continue;
    const normalized = normalizeUserId(task.assignedUserId);
    if (normalized == null) {
      unassigned += 1;
      continue;
    }
    if (counts.has(normalized)) {
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
      continue;
    }
    otherAssigned += 1;
  }

  return {
    memberCounts: Object.fromEntries(memberIds.map((id) => [String(id), counts.get(id) ?? 0])),
    unassigned,
    otherAssigned,
  };
}

async function fetchTrialsByMode(mode: ModeFilter) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  let whereClause: SQL<unknown> | undefined;
  if (mode === "sample") {
    // Sample mode = prefixed sample trials + legacy trials without mode prefix.
    const prefixed = await db.select().from(trials).where(like(trials.id, "sample:%"));
    const legacy = await db.select().from(trials).where(notLike(trials.id, "%:%"));
    return [...prefixed, ...legacy].filter((trial) => shouldIncludeTrialForMode(trial.id, mode));
  }
  if (mode === "full") whereClause = like(trials.id, "full:%");
  if (mode === "building") whereClause = like(trials.id, "building:%");
  const rows = mode === "all" ? await db.select().from(trials) : await db.select().from(trials).where(whereClause!);
  return rows.filter((trial) => shouldIncludeTrialForMode(trial.id, mode));
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  const membersArg = args.find((arg) => arg.startsWith("--members="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  const members = membersArg ? Number(membersArg.replace("--members=", "")) : 13;

  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }
  if (!Number.isInteger(members) || members < 2 || members > 50) {
    throw new Error("members must be an integer between 2 and 50");
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const trialRows = await fetchTrialsByMode(mode);
  const trialIds = trialRows.map((trial) => trial.id);
  if (!trialIds.length) {
    console.log(JSON.stringify({ apply, mode, members, message: "No trials found." }, null, 2));
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

  const selectedTrials = trialRows
    .map((trial) => {
      const map = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
      if (!map) return null;
      return {
        trialId: trial.id,
        trialTitle: String(trial.title || ""),
        mapId: map.id,
      };
    })
    .filter(Boolean) as Array<{ trialId: string; trialTitle: string; mapId: string }>;

  if (!selectedTrials.length) {
    console.log(JSON.stringify({ apply, mode, members, message: "No active/revised/draft maps found." }, null, 2));
    return;
  }

  const mapIds = selectedTrials.map((entry) => entry.mapId);
  const taskRows = await db
    .select()
    .from(mapTasks)
    .where(inArray(mapTasks.mapId, mapIds))
    .orderBy(mapTasks.mapId, mapTasks.phaseId, mapTasks.orderInPhase, mapTasks.createdAt);

  const tasksByMapId = new Map<string, MapTask[]>();
  for (const task of taskRows) {
    const list = tasksByMapId.get(task.mapId) ?? [];
    list.push(task);
    tasksByMapId.set(task.mapId, list);
  }

  const memberIds = Array.from({ length: members }, (_, index) => index + 1);
  const updates: Array<{ taskId: string; mapId: string; trialId: string; from: number | null; to: number }> = [];
  const previewAfter = new Map<string, number>();
  const perTrialSummary: Array<Record<string, unknown>> = [];

  for (const trial of selectedTrials) {
    const trialTasks = (tasksByMapId.get(trial.mapId) ?? []).filter(isOpenTask);
    if (!trialTasks.length) {
      perTrialSummary.push({
        trialId: trial.trialId,
        trialTitle: trial.trialTitle,
        openTasks: 0,
        plannedUpdates: 0,
      });
      continue;
    }

    const sorted = [...trialTasks].sort((a, b) => {
      const dueDelta = dateValue(a.dueDate) - dateValue(b.dueDate);
      if (dueDelta !== 0) return dueDelta;
      const suggestedDelta = dateValue(a.suggestedDate) - dateValue(b.suggestedDate);
      if (suggestedDelta !== 0) return suggestedDelta;
      const createdDelta = dateValue(a.createdAt) - dateValue(b.createdAt);
      if (createdDelta !== 0) return createdDelta;
      return String(a.id).localeCompare(String(b.id));
    });

    const startOffset = stableHash(`${trial.trialId}:${trial.mapId}`) % memberIds.length;
    let plannedUpdatesForTrial = 0;

    for (let index = 0; index < sorted.length; index += 1) {
      const task = sorted[index]!;
      const targetUserId = memberIds[(startOffset + index) % memberIds.length]!;
      const currentUserId = normalizeUserId(task.assignedUserId);
      previewAfter.set(task.id, targetUserId);

      if (currentUserId === targetUserId) continue;
      updates.push({
        taskId: task.id,
        mapId: trial.mapId,
        trialId: trial.trialId,
        from: currentUserId,
        to: targetUserId,
      });
      plannedUpdatesForTrial += 1;
    }

    perTrialSummary.push({
      trialId: trial.trialId,
      trialTitle: trial.trialTitle,
      openTasks: sorted.length,
      plannedUpdates: plannedUpdatesForTrial,
      targetMembersUsed: Math.min(memberIds.length, sorted.length),
    });
  }

  const beforeCounts = countsByMember(taskRows, memberIds);
  const simulatedRows = taskRows.map((task) => {
    if (!isOpenTask(task)) return task;
    const target = previewAfter.get(task.id);
    if (target == null) return task;
    return { ...task, assignedUserId: target };
  });
  const afterCounts = countsByMember(simulatedRows, memberIds);

  if (apply && updates.length > 0) {
    for (const update of updates) {
      await db
        .update(mapTasks)
        .set({
          assignedUserId: update.to,
          updatedAt: new Date(),
        })
        .where(eq(mapTasks.id, update.taskId));
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        members,
        trialCount: selectedTrials.length,
        openTaskCount: taskRows.filter(isOpenTask).length,
        updatesPlanned: updates.length,
        updatesApplied: apply ? updates.length : 0,
        memberLoadBefore: beforeCounts,
        memberLoadAfter: afterCounts,
        perTrial: perTrialSummary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[rebalance-task-assignees] failed", error);
  process.exit(1);
});
