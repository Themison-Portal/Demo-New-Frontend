import { randomUUID } from "crypto";
import { desc, eq, inArray, like, notLike } from "drizzle-orm";
import {
  executionMaps,
  mapPhases,
  mapTasks,
  trials,
  type ExecutionMap,
  type MapPhase,
  type MapTask,
  type Trial,
} from "../drizzle/schema";
import { getDb } from "../server/db";

type Mode = "sample" | "full" | "building";

type Summary = {
  trialsScanned: number;
  mapsTouched: number;
  generatedTasksDeleted: number;
  generatedVisitsDeleted: number;
  visitsCreatedFromTemplates: number;
  tasksCreatedFromTemplates: number;
  mapsSkippedNoTemplates: number;
};

const PHASE_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

const DONE_STATUSES = new Set(["done", "skipped", "cancelled"]);
const EXCLUDED_VISIT_TYPES = new Set(["screen_fail", "early_termination"]);

const GENERATED_TASK_PREFIXES = ["Coverage Task", "Planned "];
const GENERATED_VISIT_PREFIXES = ["Coverage Visit", "Future Follow-up"];
const GENERATED_REASON_TOKEN = "auto-rebalanced";

const WEEKS = 12;

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function addDays(source: Date, days: number) {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function startOfIsoWeek(source: Date) {
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function firstDate(...dates: Array<Date | null | undefined>) {
  for (const date of dates) {
    if (date instanceof Date && Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function weekIndex(baseWeekStart: Date, date: Date | null) {
  if (!date) return null;
  const normalized = startOfIsoWeek(date);
  const baseUtc = Date.UTC(baseWeekStart.getFullYear(), baseWeekStart.getMonth(), baseWeekStart.getDate());
  const normalizedUtc = Date.UTC(normalized.getFullYear(), normalized.getMonth(), normalized.getDate());
  const week = Math.floor((normalizedUtc - baseUtc) / (7 * 24 * 60 * 60 * 1000));
  if (week < 0 || week >= WEEKS) return null;
  return week;
}

function isGeneratedTask(task: MapTask) {
  const name = String(task.name || "");
  if (GENERATED_TASK_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  const tags = Array.isArray(task.tags) ? task.tags.map((entry) => String(entry)) : [];
  return tags.includes(GENERATED_REASON_TOKEN);
}

function isGeneratedVisit(phase: MapPhase) {
  const name = String(phase.name || "");
  return GENERATED_VISIT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isOpenTask(task: MapTask) {
  return !DONE_STATUSES.has(normalize(task.status));
}

function isVisitPhase(phase: MapPhase) {
  return !EXCLUDED_VISIT_TYPES.has(normalize(phase.phaseType));
}

function pickPreferredMap(rows: ExecutionMap[]) {
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const rank = PHASE_PRIORITY[a.status] - PHASE_PRIORITY[b.status];
    if (rank !== 0) return rank;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

function statusTargets(status: string) {
  const token = normalize(status);
  if (token === "active" || token === "recruiting") return { tasksPerWeek: 2, visitsPerWeek: 1 };
  if (token === "not-started") return { tasksPerWeek: 1, visitsPerWeek: 1 };
  if (token === "on-hold") return { tasksPerWeek: 1, visitsPerWeek: 0 };
  return { tasksPerWeek: 0, visitsPerWeek: 0 };
}

function modeTrialsFilter(mode: Mode, trialId: string) {
  if (mode === "sample") {
    return trialId.startsWith("sample:") || !trialId.includes(":");
  }
  return trialId.startsWith(`${mode}:`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "sample") as Mode;

  if (!["sample", "full", "building"].includes(mode)) {
    throw new Error("Mode must be sample|full|building");
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const weekStart = startOfIsoWeek(now);
  const summary: Summary = {
    trialsScanned: 0,
    mapsTouched: 0,
    generatedTasksDeleted: 0,
    generatedVisitsDeleted: 0,
    visitsCreatedFromTemplates: 0,
    tasksCreatedFromTemplates: 0,
    mapsSkippedNoTemplates: 0,
  };

  const prefixedTrials = await db.select().from(trials).where(like(trials.id, `${mode}:%`));
  const legacySampleTrials =
    mode === "sample" ? await db.select().from(trials).where(notLike(trials.id, "%:%")) : [];
  const trialRows = [...prefixedTrials, ...legacySampleTrials].filter((trial) => modeTrialsFilter(mode, trial.id));
  summary.trialsScanned = trialRows.length;

  const trialIds = trialRows.map((row) => row.id);
  if (!trialIds.length) {
    console.log(JSON.stringify({ apply, mode, summary }, null, 2));
    return;
  }

  const mapRows = await db
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));
  const mapRowsByTrialId = new Map<string, ExecutionMap[]>();
  for (const map of mapRows) {
    const list = mapRowsByTrialId.get(map.trialId) ?? [];
    list.push(map);
    mapRowsByTrialId.set(map.trialId, list);
  }

  for (const trial of trialRows) {
    const preferredMap = pickPreferredMap(mapRowsByTrialId.get(trial.id) ?? []);
    if (!preferredMap) continue;
    summary.mapsTouched += 1;

    const targets = statusTargets(String(trial.status || ""));
    if (targets.tasksPerWeek === 0 && targets.visitsPerWeek === 0) continue;

    const mapId = preferredMap.id;

    let phases = await db
      .select()
      .from(mapPhases)
      .where(eq(mapPhases.mapId, mapId))
      .orderBy(mapPhases.displayOrder, mapPhases.createdAt);
    let tasks = await db
      .select()
      .from(mapTasks)
      .where(eq(mapTasks.mapId, mapId))
      .orderBy(mapTasks.phaseId, mapTasks.orderInPhase, mapTasks.createdAt);

    const generatedTasks = tasks.filter(isGeneratedTask);
    const generatedTaskIds = generatedTasks.map((task) => task.id);
    if (apply) {
      for (const taskId of generatedTaskIds) {
        await db.delete(mapTasks).where(eq(mapTasks.id, taskId));
      }
    }
    summary.generatedTasksDeleted += generatedTaskIds.length;

    const generatedVisits = phases.filter(isGeneratedVisit);
    const generatedVisitIds = generatedVisits.map((phase) => phase.id);
    if (apply) {
      for (const phaseId of generatedVisitIds) {
        await db.delete(mapPhases).where(eq(mapPhases.id, phaseId));
      }
    }
    summary.generatedVisitsDeleted += generatedVisitIds.length;

    phases = phases.filter((phase) => !generatedVisitIds.includes(phase.id));
    tasks = tasks.filter((task) => !generatedTaskIds.includes(task.id));

    const visitTemplates = phases.filter(isVisitPhase);
    const taskTemplates = tasks.filter((task) => isOpenTask(task) && !isGeneratedTask(task));
    if (!visitTemplates.length || !taskTemplates.length) {
      summary.mapsSkippedNoTemplates += 1;
      continue;
    }

    const openTasks = taskTemplates;
    const taskCounts = Array.from({ length: WEEKS }, () => 0);
    const visitCounts = Array.from({ length: WEEKS }, () => 0);

    for (const task of openTasks) {
      const idx = weekIndex(weekStart, firstDate(task.dueDate, task.suggestedDate));
      if (idx !== null) taskCounts[idx] += 1;
    }
    for (const phase of visitTemplates) {
      const idx = weekIndex(weekStart, firstDate(phase.estimatedDate, phase.windowStart, phase.windowEnd));
      if (idx !== null) visitCounts[idx] += 1;
    }

    const maxDisplayOrder = phases.reduce((max, phase) => Math.max(max, Number(phase.displayOrder || 0)), -1);
    let nextDisplayOrder = maxDisplayOrder + 1;

    const nextOrderByPhase = new Map<string, number>();
    for (const task of tasks) {
      const current = nextOrderByPhase.get(task.phaseId) ?? 0;
      const order = Number(task.orderInPhase || 0) + 1;
      nextOrderByPhase.set(task.phaseId, Math.max(current, order));
    }

    for (let w = 0; w < WEEKS; w += 1) {
      const visitDeficit = Math.max(0, targets.visitsPerWeek - visitCounts[w]!);
      for (let i = 0; i < visitDeficit; i += 1) {
        const template = visitTemplates[(w + i) % visitTemplates.length]!;
        const visitWindowStart = addDays(weekStart, w * 7 + 1 + (i % 2));
        const visitEstimated = addDays(visitWindowStart, 2);
        const visitWindowEnd = addDays(visitWindowStart, 5);
        const phaseId = randomUUID();
        const phaseInsert = {
          id: phaseId,
          mapId,
          name: `${template.name}`,
          phaseType: template.phaseType,
          displayOrder: nextDisplayOrder,
          color: template.color,
          estimatedDate: visitEstimated,
          windowStart: visitWindowStart,
          windowEnd: visitWindowEnd,
          protocolRef: template.protocolRef,
          canvasX: template.canvasX,
          canvasY: template.canvasY,
          createdAt: now,
          updatedAt: now,
        };
        if (apply) {
          await db.insert(mapPhases).values(phaseInsert);
        }
        nextDisplayOrder += 1;
        visitCounts[w]! += 1;
        summary.visitsCreatedFromTemplates += 1;

        const seedTaskTemplate = taskTemplates[(stableHash(`${trial.id}:${w}:${i}`) % taskTemplates.length)]!;
        const dueDate = addDays(weekStart, w * 7 + 3 + (i % 2));
        const suggestedDate = addDays(dueDate, -2);
        const orderInPhase = nextOrderByPhase.get(phaseId) ?? 0;
        const taskInsert = {
          id: randomUUID(),
          phaseId,
          mapId,
          name: seedTaskTemplate.name,
          description: seedTaskTemplate.description,
          category: seedTaskTemplate.category,
          priority: seedTaskTemplate.priority,
          status: "todo" as const,
          blockedReason: null,
          blockedSince: null,
          assignedRole: seedTaskTemplate.assignedRole,
          assignedUserId: seedTaskTemplate.assignedUserId,
          suggestedAssignee: seedTaskTemplate.suggestedAssignee,
          suggestedDate,
          dueDate,
          estimatedDuration: seedTaskTemplate.estimatedDuration,
          startDate: null,
          completedDate: null,
          orderInPhase,
          canvasX: seedTaskTemplate.canvasX,
          canvasY: seedTaskTemplate.canvasY,
          createdBy: "ai" as const,
          aiConfidence: seedTaskTemplate.aiConfidence,
          conditionalNote: seedTaskTemplate.conditionalNote,
          isCustom: seedTaskTemplate.isCustom,
          tags: [...(Array.isArray(seedTaskTemplate.tags) ? seedTaskTemplate.tags : []), GENERATED_REASON_TOKEN],
          protocolRefs: Array.isArray(seedTaskTemplate.protocolRefs) ? seedTaskTemplate.protocolRefs : [],
          createdAt: now,
          updatedAt: now,
        };
        if (apply) {
          await db.insert(mapTasks).values(taskInsert);
        }
        nextOrderByPhase.set(phaseId, orderInPhase + 1);
        taskCounts[w]! += 1;
        summary.tasksCreatedFromTemplates += 1;
      }

      const taskDeficit = Math.max(0, targets.tasksPerWeek - taskCounts[w]!);
      for (let i = 0; i < taskDeficit; i += 1) {
        const template = taskTemplates[(w + i) % taskTemplates.length]!;
        const targetPhase = visitTemplates[(w + i) % visitTemplates.length]!;
        const dueDate = addDays(weekStart, w * 7 + 2 + (i % 3));
        const suggestedDate = addDays(dueDate, -2);
        const orderInPhase = nextOrderByPhase.get(targetPhase.id) ?? 0;
        const taskInsert = {
          id: randomUUID(),
          phaseId: targetPhase.id,
          mapId,
          name: template.name,
          description: template.description,
          category: template.category,
          priority: template.priority,
          status: "todo" as const,
          blockedReason: null,
          blockedSince: null,
          assignedRole: template.assignedRole,
          assignedUserId: template.assignedUserId,
          suggestedAssignee: template.suggestedAssignee,
          suggestedDate,
          dueDate,
          estimatedDuration: template.estimatedDuration,
          startDate: null,
          completedDate: null,
          orderInPhase,
          canvasX: template.canvasX,
          canvasY: template.canvasY,
          createdBy: "ai" as const,
          aiConfidence: template.aiConfidence,
          conditionalNote: template.conditionalNote,
          isCustom: template.isCustom,
          tags: [...(Array.isArray(template.tags) ? template.tags : []), GENERATED_REASON_TOKEN],
          protocolRefs: Array.isArray(template.protocolRefs) ? template.protocolRefs : [],
          createdAt: now,
          updatedAt: now,
        };
        if (apply) {
          await db.insert(mapTasks).values(taskInsert);
        }
        nextOrderByPhase.set(targetPhase.id, orderInPhase + 1);
        taskCounts[w]! += 1;
        summary.tasksCreatedFromTemplates += 1;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        mode,
        weeks: WEEKS,
        perTrialTargets: {
          active: { tasksPerWeek: 2, visitsPerWeek: 1 },
          recruiting: { tasksPerWeek: 2, visitsPerWeek: 1 },
          "not-started": { tasksPerWeek: 1, visitsPerWeek: 1 },
          "on-hold": { tasksPerWeek: 1, visitsPerWeek: 0 },
        },
        summary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[rebalance-realistic-workload] failed", error);
  process.exit(1);
});
