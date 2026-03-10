import { randomUUID } from "crypto";
import { asc, desc, eq, inArray, like, notLike } from "drizzle-orm";
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

const BUSINESS_WINDOW_DAYS = 7;
const TARGET_PULSE = [13, 7, 10, 6, 9, 5, 8] as const;
const TARGET_SUMMARY = {
  openOwned: 58,
  dueToday: 12,
  overdue: 0,
  blocked: 7,
  completedToday: 1,
} as const;

const BASELINE_EXPECTED = {
  openOwned: 26,
  dueToday: 0,
  overdue: 12,
  blocked: 2,
  completedToday: 0,
  pulse: [13, 3, 2, 2, 2, 2, 2] as const,
} as const;

const INSERTS_BY_DAY = [0, 4, 8, 4, 7, 3, 6] as const;
const INSERT_BLOCKED_TARGET = TARGET_SUMMARY.blocked - BASELINE_EXPECTED.blocked;
const MAP_STATUS_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes("--apply"),
    force: argv.includes("--force"),
  };
}

function parseDate(value?: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function startOfDay(source: Date) {
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
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

function isDoneStatus(status?: string | null) {
  const token = String(status || "").toLowerCase();
  return token === "done" || token === "completed" || token === "cancelled" || token === "skipped";
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
    if (dow !== 0 && dow !== 6) result.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function modeFromTrialId(trialId: string): "sample" | "full" | "building" | "legacy" {
  if (trialId.startsWith("sample:")) return "sample";
  if (trialId.startsWith("full:")) return "full";
  if (trialId.startsWith("building:")) return "building";
  return "legacy";
}

function shouldIncludeTrialForSample(trialId: string) {
  const mode = modeFromTrialId(trialId);
  return mode === "sample" || mode === "legacy";
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

function choosePhase(phases: MapPhase[]) {
  const filtered = phases.filter(
    (phase) => !["screen_fail", "early_termination"].includes(String(phase.phaseType || "").toLowerCase())
  );
  return filtered[0] ?? phases[0] ?? null;
}

function scopeTasksForKaleb(tasks: MapTask[]) {
  const memberId = "1";
  const memberName = "kaleb sanders";
  const scoped = tasks.filter((task) => {
    const matchById =
      task.assignedUserId != null &&
      (memberId === String(task.assignedUserId) || memberId === `member-${task.assignedUserId}`);
    const matchByName = String(task.suggestedAssignee || "").trim().toLowerCase() === memberName;
    return matchById || matchByName;
  });
  return scoped.length > 0 ? scoped : tasks;
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

function summarize(tasks: MapTask[]) {
  const scoped = scopeTasksForKaleb(tasks);
  const open = scoped.filter((task) => !isDoneStatus(task.status));
  const today = startOfDay(new Date());
  const dueToday = open.filter((task) => {
    const due = parseDate(task.dueDate);
    return Boolean(due && isSameDay(due, today));
  }).length;
  const overdue = open.filter((task) => {
    const due = parseDate(task.dueDate);
    return Boolean(due && isBeforeDay(due, today));
  }).length;
  const blocked = open.filter((task) => {
    const status = String(task.status || "").toLowerCase();
    return status === "blocked" || status === "waiting";
  }).length;
  const completedToday = scoped.filter((task) => {
    const completed = parseDate(task.completedDate);
    return Boolean(completed && isSameDay(completed, today));
  }).length;
  const pulse = buildPulseLoads(scoped, businessWindow(BUSINESS_WINDOW_DAYS));

  return {
    scopedCount: scoped.length,
    openOwned: open.length,
    dueToday,
    overdue,
    blocked,
    completedToday,
    pulse,
  };
}

function matchesBaseline(summary: ReturnType<typeof summarize>) {
  return (
    summary.openOwned === BASELINE_EXPECTED.openOwned &&
    summary.dueToday === BASELINE_EXPECTED.dueToday &&
    summary.overdue === BASELINE_EXPECTED.overdue &&
    summary.blocked === BASELINE_EXPECTED.blocked &&
    summary.completedToday === BASELINE_EXPECTED.completedToday &&
    summary.pulse.length === BASELINE_EXPECTED.pulse.length &&
    summary.pulse.every((value, index) => value === BASELINE_EXPECTED.pulse[index])
  );
}

function matchesTarget(summary: ReturnType<typeof summarize>) {
  return (
    summary.openOwned === TARGET_SUMMARY.openOwned &&
    summary.dueToday === TARGET_SUMMARY.dueToday &&
    summary.overdue === TARGET_SUMMARY.overdue &&
    summary.blocked === TARGET_SUMMARY.blocked &&
    summary.completedToday === TARGET_SUMMARY.completedToday &&
    summary.pulse.length === TARGET_PULSE.length &&
    summary.pulse.every((value, index) => value === TARGET_PULSE[index])
  );
}

async function main() {
  const { apply, force } = parseArgs(process.argv.slice(2));
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const prefixedTrials = await db.select().from(trials).where(like(trials.id, "sample:%"));
  const legacySampleTrials = await db.select().from(trials).where(notLike(trials.id, "%:%"));
  const trialRows = [...prefixedTrials, ...legacySampleTrials].filter((trial) =>
    shouldIncludeTrialForSample(trial.id)
  );
  const trialIds = trialRows.map((trial) => trial.id);
  if (!trialIds.length) throw new Error("No sample trials found");

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
  if (!mapIds.length) throw new Error("No sample maps found");

  const [phaseRows, taskRows] = await Promise.all([
    db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds)).orderBy(asc(mapPhases.displayOrder), asc(mapPhases.createdAt)),
    db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds)),
  ]);

  const baseline = summarize(taskRows);
  const baselineOk = matchesBaseline(baseline);
  if (!baselineOk && !force) {
    console.log(
      JSON.stringify(
        {
          apply,
          force,
          baselineMatchesExpected: false,
          expected: BASELINE_EXPECTED,
          found: baseline,
          hint: "Run with --force only if you still want this preset applied on top of current data.",
        },
        null,
        2
      )
    );
    return;
  }

  const scoped = scopeTasksForKaleb(taskRows);
  const now = new Date();
  const today = startOfDay(now);
  const businessDates = businessWindow(BUSINESS_WINDOW_DAYS);
  const tomorrow = businessDates[1] ?? addDays(today, 1);
  const yesterday = addDays(today, -1);

  const overdueOpen = scoped
    .filter((task) => !isDoneStatus(task.status))
    .filter((task) => {
      const due = parseDate(task.dueDate);
      return Boolean(due && isBeforeDay(due, today));
    })
    .sort((a, b) => (parseDate(a.dueDate)?.getTime() ?? 0) - (parseDate(b.dueDate)?.getTime() ?? 0));

  const updates: Array<{ id: string; set: Partial<typeof mapTasks.$inferInsert> }> = [];
  overdueOpen.forEach((task, index) => {
    const moveToToday = index < TARGET_SUMMARY.dueToday;
    const targetDate = new Date((moveToToday ? today : tomorrow).getTime());
    targetDate.setHours(9 + (index % 6), 0, 0, 0);
    updates.push({
      id: task.id,
      set: {
        dueDate: targetDate,
        suggestedDate: yesterday,
        updatedAt: now,
      },
    });
  });

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

  const insertOpenRows: Array<typeof mapTasks.$inferInsert> = [];
  let blockedRemaining = Math.max(0, INSERT_BLOCKED_TARGET);
  let cursor = 0;
  for (let dayIndex = 0; dayIndex < INSERTS_BY_DAY.length; dayIndex += 1) {
    const count = INSERTS_BY_DAY[dayIndex] ?? 0;
    if (count <= 0) continue;
    const dueBase = businessDates[dayIndex] ?? today;
    for (let i = 0; i < count; i += 1) {
      const target = selected[cursor % selected.length]!;
      cursor += 1;
      const phase = choosePhase(phasesByMapId.get(target.mapId) ?? []);
      if (!phase) continue;
      const nextOrder = (orderByPhase.get(phase.id) ?? -1) + 1;
      orderByPhase.set(phase.id, nextOrder);

      const dueDate = new Date(dueBase.getTime());
      dueDate.setHours(10 + (i % 6), 0, 0, 0);
      const useBlocked = blockedRemaining > 0;
      if (useBlocked) blockedRemaining -= 1;
      const status = useBlocked ? "blocked" : i % 4 === 0 ? "in_progress" : "todo";

      insertOpenRows.push({
        id: randomUUID(),
        mapId: target.mapId,
        phaseId: phase.id,
        name: `Kaleb restore seed · D${dayIndex + 1} #${i + 1}`,
        description: "Restore sample home pulse profile.",
        category: "coordination",
        priority: "medium",
        status,
        blockedReason: useBlocked ? "Awaiting sponsor feedback" : null,
        blockedSince: useBlocked ? now : null,
        assignedRole: "study_coordinator",
        assignedUserId: 1,
        suggestedAssignee: "Kaleb Sanders",
        suggestedDate: yesterday,
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
        tags: ["home-pulse-restore", "kaleb", "sample"],
        protocolRefs: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const doneTarget = selected[0];
  const donePhase = doneTarget ? choosePhase(phasesByMapId.get(doneTarget.mapId) ?? []) : null;
  let doneRow: typeof mapTasks.$inferInsert | null = null;
  if (doneTarget && donePhase) {
    const nextOrder = (orderByPhase.get(donePhase.id) ?? -1) + 1;
    orderByPhase.set(donePhase.id, nextOrder);
    doneRow = {
      id: randomUUID(),
      mapId: doneTarget.mapId,
      phaseId: donePhase.id,
      name: "Kaleb restore seed · Completed today",
      description: "Restore sample home completed today metric.",
      category: "coordination",
      priority: "low",
      status: "done",
      blockedReason: null,
      blockedSince: null,
      assignedRole: "study_coordinator",
      assignedUserId: 1,
      suggestedAssignee: "Kaleb Sanders",
      suggestedDate: yesterday,
      dueDate: new Date(today.getTime() + 12 * 60 * 60 * 1000),
      estimatedDuration: 1,
      startDate: yesterday,
      completedDate: new Date(today.getTime() + 13 * 60 * 60 * 1000),
      orderInPhase: nextOrder,
      canvasX: null,
      canvasY: null,
      createdBy: "ai",
      aiConfidence: 0.9,
      conditionalNote: null,
      isCustom: false,
      tags: ["home-pulse-restore", "kaleb", "sample", "done-today"],
      protocolRefs: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  if (apply) {
    for (const patch of updates) {
      await db.update(mapTasks).set(patch.set).where(eq(mapTasks.id, patch.id));
    }
    if (insertOpenRows.length) {
      await db.insert(mapTasks).values(insertOpenRows);
    }
    if (doneRow) {
      await db.insert(mapTasks).values(doneRow);
    }
  }

  const previewRows = taskRows.map((task) => ({ ...task }));
  const previewById = new Map(previewRows.map((row) => [row.id, row]));
  for (const patch of updates) {
    const row = previewById.get(patch.id);
    if (!row) continue;
    Object.assign(row, patch.set);
  }
  for (const row of insertOpenRows) previewRows.push(row as MapTask);
  if (doneRow) previewRows.push(doneRow as MapTask);

  const projected = summarize(previewRows);

  console.log(
    JSON.stringify(
      {
        apply,
        force,
        baseline,
        updatesCount: updates.length,
        insertsOpenCount: insertOpenRows.length,
        insertBlockedCount: insertOpenRows.filter((row) => row.status === "blocked").length,
        insertDoneCount: doneRow ? 1 : 0,
        projected,
        projectedMatchesTarget: matchesTarget(projected),
        target: { ...TARGET_SUMMARY, pulse: TARGET_PULSE },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[restore-sample-home-pulse-profile] failed", error);
  process.exit(1);
});
