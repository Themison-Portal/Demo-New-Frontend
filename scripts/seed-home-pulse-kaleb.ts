import { randomUUID } from "crypto";
import { asc, desc, inArray, like, notLike } from "drizzle-orm";
import {
  executionMaps,
  mapPhases,
  mapTasks,
  trials,
  type ExecutionMap,
  type MapPhase,
  type MapTask,
} from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";

const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

const SEED_SPECS = [
  { dayIndex: 0, status: "in_progress", priority: "high", label: "AE follow-up" },
  { dayIndex: 0, status: "todo", priority: "high", label: "Source review" },
  { dayIndex: 1, status: "todo", priority: "medium", label: "Lab reconciliation" },
  { dayIndex: 2, status: "blocked", priority: "medium", label: "Visit prep packet" },
  { dayIndex: 3, status: "todo", priority: "medium", label: "PI sign-off prep" },
  { dayIndex: 4, status: "in_progress", priority: "high", label: "Query triage" },
  { dayIndex: 5, status: "todo", priority: "medium", label: "Deviation review" },
  { dayIndex: 6, status: "todo", priority: "low", label: "Sponsor clarification" },
] as const;

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const countArg = argv.find((arg) => arg.startsWith("--count="));

  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as ModeFilter;
  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error("mode must be sample|full|building|all");
  }

  const count = countArg ? Number(countArg.replace("--count=", "")) : 8;
  if (!Number.isFinite(count) || count < 1 || count > 24) {
    throw new Error("count must be between 1 and 24");
  }

  return { apply, mode, count: Math.floor(count) };
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

function parseDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isDoneStatus(status?: string | null) {
  const token = String(status || "").toLowerCase();
  return token === "done" || token === "completed" || token === "cancelled" || token === "skipped";
}

function startOfDay(source: Date) {
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

function startOfIsoWeek(source: Date) {
  const date = startOfDay(source);
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  return date;
}

function addDays(source: Date, days: number) {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function dateKey(source: Date) {
  const date = startOfDay(source);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isBeforeDay(a: Date, b: Date) {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

function businessWindow(days: number) {
  const now = startOfDay(new Date());
  const result: Date[] = [];
  const cursor = new Date(now);
  while (result.length < days) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      result.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function buildPulseLoads(tasks: MapTask[], dates: Date[]) {
  const now = startOfDay(new Date());
  const points = dates.map((date, index) => ({ index, key: dateKey(date), load: 0 }));
  const byDate = new Map(points.map((point, index) => [point.key, index]));

  let backlogCursor = 0;
  const backlogPattern = [1, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6, 1] as const;
  const assignBacklog = () => {
    const slot = backlogPattern[backlogCursor % backlogPattern.length] ?? 1;
    backlogCursor += 1;
    const safeSlot = Math.max(1, Math.min(points.length - 1, slot));
    points[safeSlot].load += 1;
  };

  for (const task of tasks) {
    if (isDoneStatus(task.status)) continue;
    const due = parseDate(task.dueDate);
    const statusToken = String(task.status || "").toLowerCase();
    const blocked = statusToken === "blocked" || statusToken === "waiting";

    if (due) {
      const idx = byDate.get(dateKey(due));
      if (idx != null) {
        points[idx].load += 1;
        continue;
      }
      if (isBeforeDay(due, now)) {
        points[0].load += 1;
        continue;
      }
    }

    if (blocked) {
      points[0].load += 1;
      continue;
    }

    assignBacklog();
  }

  return points.map((point) => point.load);
}

function scopedTasksForKaleb(tasks: MapTask[]) {
  const memberId = "member-1";
  const memberName = "kaleb sanders";
  const mine = tasks.filter((task) => {
    const matchById =
      task.assignedUserId != null &&
      (memberId === String(task.assignedUserId) || memberId === `member-${task.assignedUserId}`);
    const matchByName = String(task.suggestedAssignee || "").trim().toLowerCase() === memberName;
    return matchById || matchByName;
  });
  return mine.length > 0 ? mine : tasks;
}

function choosePhase(phases: MapPhase[]) {
  const filtered = phases.filter(
    (phase) => !["screen_fail", "early_termination"].includes(String(phase.phaseType || "").toLowerCase())
  );
  return filtered[0] ?? phases[0] ?? null;
}

async function main() {
  const { apply, mode, count } = parseArgs(process.argv.slice(2));
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
    console.log(JSON.stringify({ apply, mode, count, message: "No trials found." }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));
  const mapsByTrialId = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = mapsByTrialId.get(row.trialId) ?? [];
    list.push(row);
    mapsByTrialId.set(row.trialId, list);
  }

  const selected = trialRows
    .map((trial) => {
      const preferredMap = pickPreferredMap(mapsByTrialId.get(trial.id) ?? []);
      if (!preferredMap) return null;
      return { trialId: trial.id, mapId: preferredMap.id };
    })
    .filter(Boolean) as Array<{ trialId: string; mapId: string }>;
  const mapIds = selected.map((row) => row.mapId);
  if (!mapIds.length) {
    console.log(JSON.stringify({ apply, mode, count, message: "No maps found." }, null, 2));
    return;
  }

  const [phaseRows, taskRows] = await Promise.all([
    db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds)).orderBy(asc(mapPhases.displayOrder), asc(mapPhases.createdAt)),
    db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds)),
  ]);

  const phasesByMapId = new Map<string, MapPhase[]>();
  for (const row of phaseRows) {
    const list = phasesByMapId.get(row.mapId) ?? [];
    list.push(row);
    phasesByMapId.set(row.mapId, list);
  }

  const orderByPhase = new Map<string, number>();
  for (const task of taskRows) {
    const current = orderByPhase.get(task.phaseId) ?? -1;
    orderByPhase.set(task.phaseId, Math.max(current, Number(task.orderInPhase ?? -1)));
  }

  const dates = businessWindow(7);
  const queueBefore = buildPulseLoads(scopedTasksForKaleb(taskRows), dates);

  const now = new Date();
  const currentWeekStart = startOfIsoWeek(now);
  const inserts: Array<typeof mapTasks.$inferInsert> = [];

  for (let index = 0; index < count; index += 1) {
    const spec = SEED_SPECS[index % SEED_SPECS.length]!;
    const target = selected[index % selected.length]!;
    const phase = choosePhase(phasesByMapId.get(target.mapId) ?? []);
    if (!phase) continue;

    const dueDay = dates[Math.max(0, Math.min(dates.length - 1, spec.dayIndex))]!;
    const dueDate = new Date(dueDay.getTime());
    dueDate.setHours(11 + (index % 4), 0, 0, 0);

    const suggestedDate = addDays(dueDate, -1);
    const dueWeekStart = startOfIsoWeek(dueDate);
    const createdAt = new Date(
      (dueWeekStart.getTime() > currentWeekStart.getTime() ? dueWeekStart : now).getTime()
    );
    createdAt.setHours(9 + (index % 3), 0, 0, 0);
    if (createdAt.getTime() > dueDate.getTime()) {
      createdAt.setTime(dueDate.getTime() - 60 * 60 * 1000);
    }

    const nextOrder = (orderByPhase.get(phase.id) ?? -1) + 1;
    orderByPhase.set(phase.id, nextOrder);

    inserts.push({
      id: randomUUID(),
      mapId: target.mapId,
      phaseId: phase.id,
      name: `Kaleb queue seed · ${spec.label}`,
      description: "Targeted queue seed for Home pulse demo visibility.",
      category: "coordination",
      priority: spec.priority,
      status: spec.status,
      blockedReason: spec.status === "blocked" ? "Awaiting sponsor response" : null,
      blockedSince: spec.status === "blocked" ? now : null,
      assignedRole: "study_coordinator",
      assignedUserId: 1,
      suggestedAssignee: "Kaleb Sanders",
      suggestedDate,
      dueDate,
      estimatedDuration: 2,
      startDate: null,
      completedDate: null,
      orderInPhase: nextOrder,
      canvasX: null,
      canvasY: null,
      createdBy: "ai",
      aiConfidence: 0.8,
      conditionalNote: null,
      isCustom: false,
      tags: ["home-pulse", "kaleb", "demo-seed", "future"],
      protocolRefs: [],
      createdAt,
      updatedAt: now,
    });
  }

  if (apply && inserts.length) {
    await db.insert(mapTasks).values(inserts);
  }

  const afterTasks = apply
    ? await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds))
    : [...taskRows, ...inserts];
  const queueAfter = buildPulseLoads(scopedTasksForKaleb(afterTasks), dates);

  const insertedByDay = inserts.reduce<Record<string, number>>((acc, row) => {
    const key = dateKey(new Date(row.dueDate!));
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        requestedCount: count,
        inserted: inserts.length,
        insertedByDay,
        queueBefore,
        queueAfter,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[seed-home-pulse-kaleb] failed", error);
  process.exit(1);
});
