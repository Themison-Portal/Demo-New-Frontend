import { randomUUID } from "crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  executionMaps,
  mapPhases,
  mapTasks,
  protocols,
  trials,
  type ExecutionMap,
  type MapPhase,
  type MapTask,
  type Protocol,
  type Trial,
} from "../drizzle/schema";
import { getDb } from "../server/db";

type ModeFilter = "sample" | "full" | "building" | "all";
type ConcreteMode = "sample" | "full" | "building";

type Summary = {
  trialsScanned: number;
  mapsCreated: number;
  protocolsCreated: number;
  phasesCreated: number;
  phasesUpdated: number;
  tasksCreated: number;
  tasksUpdated: number;
  mapsSkippedNoProtocol: number;
  coverageTaskWeeksMissing: number;
  coverageVisitWeeksMissing: number;
  coverageTaskWeeksPatched: number;
  coverageVisitWeeksPatched: number;
};

const HORIZON_WEEKS = 26;
const COVERAGE_WEEKS = 12;
const MIN_OPEN_TASKS_PER_PHASE = 2;
const GLOBAL_MIN_TASKS_PER_WEEK = 4;
const GLOBAL_MIN_VISITS_PER_WEEK = 2;
const DONE_TASK_STATUSES = new Set(["done", "skipped", "cancelled"]);
const VISIT_EXCLUDED_PHASES = new Set(["screen_fail", "early_termination"]);
const PHASE_PRIORITY: Record<ExecutionMap["status"], number> = {
  active: 0,
  revised: 1,
  draft: 2,
  archived: 3,
};

const FALLBACK_PHASE_BLUEPRINT: Array<{
  name: string;
  phaseType: MapPhase["phaseType"];
  color: string;
}> = [
  { name: "Screening", phaseType: "screening", color: "#3B82F6" },
  { name: "Baseline", phaseType: "baseline", color: "#10B981" },
  { name: "Visit 1", phaseType: "treatment_visit", color: "#F59E0B" },
  { name: "Visit 2", phaseType: "treatment_visit", color: "#8B5CF6" },
  { name: "Visit 3", phaseType: "treatment_visit", color: "#06B6D4" },
  { name: "Follow-up", phaseType: "follow_up", color: "#14B8A6" },
];

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addDays(source: Date, days: number): Date {
  const date = new Date(source.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

function startOfIsoWeek(source: Date): Date {
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function normalizeToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isOpenTaskStatus(status: MapTask["status"]) {
  return !DONE_TASK_STATUSES.has(normalizeToken(status));
}

function isVisitPhase(phaseType: MapPhase["phaseType"]) {
  return !VISIT_EXCLUDED_PHASES.has(normalizeToken(phaseType));
}

function modeFromTrialId(trialId: string): "sample" | "full" | "building" | "legacy" {
  if (trialId.startsWith("sample:")) return "sample";
  if (trialId.startsWith("full:")) return "full";
  if (trialId.startsWith("building:")) return "building";
  return "legacy";
}

function shouldIncludeTrialForMode(trialId: string, mode: ModeFilter | ConcreteMode) {
  if (mode === "all") return true;
  const trialMode = modeFromTrialId(trialId);
  if (trialMode === mode) return true;
  return mode === "sample" && trialMode === "legacy";
}

function pickPreferredMap(rows: ExecutionMap[]) {
  if (!rows.length) return null;
  const nonArchived = rows.filter((row) => row.status !== "archived");
  if (!nonArchived.length) return null;
  return [...nonArchived].sort((a, b) => {
    const statusOrder = PHASE_PRIORITY[a.status] - PHASE_PRIORITY[b.status];
    if (statusOrder !== 0) return statusOrder;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })[0]!;
}

function normalizePhaseDates(baseWeekStart: Date, mapId: string, phaseId: string, index: number, total: number) {
  const mapShift = stableHash(`${mapId}:phase-shift`) % HORIZON_WEEKS;
  const stride = Math.max(2, Math.floor(HORIZON_WEEKS / Math.max(total, 2)));
  const jitter = stableHash(`${phaseId}:phase-jitter`) % 2;
  const weekOffset = (mapShift + index * stride + jitter) % HORIZON_WEEKS;
  const windowStart = addDays(baseWeekStart, weekOffset * 7);
  const estimatedDate = addDays(windowStart, 2);
  const windowEnd = addDays(windowStart, 5);
  return { estimatedDate, windowStart, windowEnd };
}

function scheduleTaskDates(baseWeekStart: Date, mapId: string, phaseId: string, slot: number, seed: string) {
  const baseOffset = stableHash(`${mapId}:${phaseId}:task-offset`) % HORIZON_WEEKS;
  const weekOffset = (baseOffset + slot + (stableHash(`${seed}:task-jitter`) % 2)) % HORIZON_WEEKS;
  const dayOffset = 1 + (stableHash(`${seed}:task-day`) % 5);
  const dueDate = addDays(baseWeekStart, weekOffset * 7 + dayOffset);
  const suggestedDate = addDays(dueDate, -2);
  return { suggestedDate, dueDate };
}

function resolveTaskCategory(phaseType: MapPhase["phaseType"]): MapTask["category"] {
  if (phaseType === "screening") return "eligibility";
  if (phaseType === "baseline") return "assessment";
  if (phaseType === "treatment_visit") return "drug_administration";
  if (phaseType === "follow_up") return "follow_up";
  if (phaseType === "end_of_study") return "documentation";
  return "coordination";
}

function resolveTaskRole(phaseType: MapPhase["phaseType"]): MapTask["assignedRole"] {
  if (phaseType === "screening") return "crc";
  if (phaseType === "baseline") return "pi";
  if (phaseType === "treatment_visit") return "nurse";
  if (phaseType === "follow_up") return "study_coordinator";
  if (phaseType === "end_of_study") return "data_manager";
  return "study_coordinator";
}

function sanitizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseTaskOrder(task: MapTask, fallback: number) {
  const order = Number(task.orderInPhase);
  return Number.isFinite(order) ? Math.max(0, order) : fallback;
}

function firstDate(...dates: Array<Date | null | undefined>) {
  for (const date of dates) {
    if (date instanceof Date && Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function weekIndexFromDate(baseWeekStart: Date, date: Date | null, maxWeeks: number) {
  if (!date) return null;
  const normalized = startOfIsoWeek(date);
  const baseUtc = Date.UTC(baseWeekStart.getFullYear(), baseWeekStart.getMonth(), baseWeekStart.getDate());
  const normalizedUtc = Date.UTC(normalized.getFullYear(), normalized.getMonth(), normalized.getDate());
  const weekIndex = Math.floor((normalizedUtc - baseUtc) / (7 * 24 * 60 * 60 * 1000));
  if (weekIndex < 0 || weekIndex >= maxWeeks) return null;
  return weekIndex;
}

async function ensureProtocolIdForTrial(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  trial: Trial,
  protocolRows: Protocol[],
  apply: boolean,
  summary: Summary
) {
  if (protocolRows.length > 0) {
    return protocolRows[0]!.id;
  }
  if (!apply) return null;

  const protocolKey = `system/generated/${trial.id}/${Date.now()}-${randomUUID()}.pdf`;
  const filenameBase = String(trial.title || "Trial").replace(/[^\w\s()-]+/g, "").trim() || "Trial";
  const filename = `${filenameBase} - System Schedule Placeholder.pdf`;
  const uploadedBy = Number.isFinite(Number(trial.createdBy)) ? Number(trial.createdBy) : 1;

  await db.insert(protocols).values({
    trialId: trial.id,
    filename,
    fileUrl: "https://example.com/system-generated-protocol.pdf",
    fileKey: protocolKey,
    fileSize: 0,
    category: "Protocol",
    isCurrent: true,
    sourceType: "system",
    sourceReference: "future-workload-reconfigure",
    uploadedBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const inserted = await db
    .select({ id: protocols.id })
    .from(protocols)
    .where(eq(protocols.fileKey, protocolKey))
    .limit(1);

  if (!inserted[0]?.id) return null;
  summary.protocolsCreated += 1;
  return inserted[0].id;
}

async function ensureCoverageForMode(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  args: {
    apply: boolean;
    mode: ConcreteMode;
    weekStart: Date;
    now: Date;
    trialIds: string[];
    mapIdByTrialId: Map<string, string>;
    summary: Summary;
  }
) {
  const { apply, mode, weekStart, now, trialIds, mapIdByTrialId, summary } = args;
  if (!trialIds.length) return;

  const mapIds = trialIds
    .map((trialId) => mapIdByTrialId.get(trialId))
    .filter((value): value is string => Boolean(value));
  if (!mapIds.length) return;

  const phases = await db
    .select()
    .from(mapPhases)
    .where(inArray(mapPhases.mapId, mapIds))
    .orderBy(asc(mapPhases.mapId), asc(mapPhases.displayOrder), asc(mapPhases.createdAt));

  const tasks = await db
    .select()
    .from(mapTasks)
    .where(inArray(mapTasks.mapId, mapIds))
    .orderBy(asc(mapTasks.mapId), asc(mapTasks.phaseId), asc(mapTasks.orderInPhase), asc(mapTasks.createdAt));

  const openTasks = tasks.filter((task) => isOpenTaskStatus(task.status));
  const visitPhases = phases.filter((phase) => isVisitPhase(phase.phaseType));

  const taskWeekCounts = Array.from({ length: COVERAGE_WEEKS }, () => 0);
  const visitWeekCounts = Array.from({ length: COVERAGE_WEEKS }, () => 0);

  for (const task of openTasks) {
    const anchor = firstDate(task.dueDate, task.suggestedDate);
    const weekIndex = weekIndexFromDate(weekStart, anchor, COVERAGE_WEEKS);
    if (weekIndex !== null) taskWeekCounts[weekIndex] += 1;
  }
  for (const phase of visitPhases) {
    const anchor = firstDate(phase.estimatedDate, phase.windowStart, phase.windowEnd);
    const weekIndex = weekIndexFromDate(weekStart, anchor, COVERAGE_WEEKS);
    if (weekIndex !== null) visitWeekCounts[weekIndex] += 1;
  }

  const taskWeekDeficits = taskWeekCounts
    .map((count, weekIndex) => ({ count, weekIndex, deficit: Math.max(0, GLOBAL_MIN_TASKS_PER_WEEK - count) }))
    .filter((entry) => entry.deficit > 0);
  const visitWeekDeficits = visitWeekCounts
    .map((count, weekIndex) => ({ count, weekIndex, deficit: Math.max(0, GLOBAL_MIN_VISITS_PER_WEEK - count) }))
    .filter((entry) => entry.deficit > 0);

  summary.coverageTaskWeeksMissing += taskWeekDeficits.length;
  summary.coverageVisitWeeksMissing += visitWeekDeficits.length;
  if (!apply) return;

  let mutablePhases = [...phases];
  let mutableVisitPhases = [...visitPhases];
  let mutableOpenTasks = [...openTasks];
  const firstMapId = mapIds[0]!;

  const createCoveragePhase = async (weekIndex: number) => {
    const windowStart = addDays(weekStart, weekIndex * 7 + 1);
    const estimatedDate = addDays(windowStart, 2);
    const windowEnd = addDays(windowStart, 5);
    const phase = {
      id: randomUUID(),
      mapId: firstMapId,
      name: `Coverage Visit W${weekIndex + 1}`,
      phaseType: "follow_up" as const,
      displayOrder: mutablePhases.filter((row) => row.mapId === firstMapId).length,
      color: "#14B8A6",
      estimatedDate,
      windowStart,
      windowEnd,
      protocolRef: { generated: true, mode, weekIndex },
      canvasX: null,
      canvasY: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(mapPhases).values(phase);
    mutablePhases.push(phase as unknown as MapPhase);
    mutableVisitPhases.push(phase as unknown as MapPhase);
    summary.phasesCreated += 1;
    summary.coverageVisitWeeksPatched += 1;
    return phase;
  };

  const createCoverageTask = async (phaseId: string, weekIndex: number) => {
    const dueDate = addDays(weekStart, weekIndex * 7 + 3);
    const suggestedDate = addDays(dueDate, -2);
    const task = {
      id: randomUUID(),
      phaseId,
      mapId: firstMapId,
      name: `Coverage Task W${weekIndex + 1}`,
      description: "System-generated task to guarantee weekly future workload coverage.",
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
      orderInPhase: 999,
      canvasX: null,
      canvasY: null,
      createdBy: "ai" as const,
      aiConfidence: 0.7,
      conditionalNote: null,
      isCustom: false,
      tags: ["future", "coverage"],
      protocolRefs: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(mapTasks).values(task);
    mutableOpenTasks.push(task as unknown as MapTask);
    summary.tasksCreated += 1;
    summary.coverageTaskWeeksPatched += 1;
    return task;
  };

  for (const entry of visitWeekDeficits) {
    for (let index = 0; index < entry.deficit; index += 1) {
      await createCoveragePhase(entry.weekIndex);
    }
  }

  if (!mutableVisitPhases.length && taskWeekDeficits.length > 0) {
    await createCoveragePhase(0);
  }

  const taskPhaseFallbackId = mutableVisitPhases[0]?.id || mutablePhases[0]?.id;
  for (const entry of taskWeekDeficits) {
    if (taskPhaseFallbackId) {
      for (let index = 0; index < entry.deficit; index += 1) {
        await createCoverageTask(taskPhaseFallbackId, entry.weekIndex);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.replace("--mode=", "") : "all") as ModeFilter;

  if (!["sample", "full", "building", "all"].includes(mode)) {
    throw new Error(`Unsupported --mode value '${mode}'. Expected sample|full|building|all.`);
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const now = new Date();
  const weekStart = startOfIsoWeek(now);
  const summary: Summary = {
    trialsScanned: 0,
    mapsCreated: 0,
    protocolsCreated: 0,
    phasesCreated: 0,
    phasesUpdated: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    mapsSkippedNoProtocol: 0,
    coverageTaskWeeksMissing: 0,
    coverageVisitWeeksMissing: 0,
    coverageTaskWeeksPatched: 0,
    coverageVisitWeeksPatched: 0,
  };

  const trialRows = await db.select().from(trials).orderBy(trials.createdAt);
  const filteredTrials = trialRows.filter((trial) => shouldIncludeTrialForMode(trial.id, mode));
  summary.trialsScanned = filteredTrials.length;

  const mapRows = await db.select().from(executionMaps).orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));
  const mapsByTrialId = new Map<string, ExecutionMap[]>();
  for (const row of mapRows) {
    const list = mapsByTrialId.get(row.trialId) ?? [];
    list.push(row);
    mapsByTrialId.set(row.trialId, list);
  }

  const protocolRows = await db.select().from(protocols).orderBy(desc(protocols.createdAt));
  const protocolsByTrialId = new Map<string, Protocol[]>();
  for (const row of protocolRows) {
    const list = protocolsByTrialId.get(row.trialId) ?? [];
    list.push(row);
    protocolsByTrialId.set(row.trialId, list);
  }

  const selectedMapIdByTrialId = new Map<string, string>();

  for (const trial of filteredTrials) {
    const trialMaps = mapsByTrialId.get(trial.id) ?? [];
    let selectedMap = pickPreferredMap(trialMaps);

    if (!selectedMap) {
      const protocolId = await ensureProtocolIdForTrial(
        db,
        trial,
        protocolsByTrialId.get(trial.id) ?? [],
        apply,
        summary
      );
      if (!protocolId) {
        summary.mapsSkippedNoProtocol += 1;
        continue;
      }

      const newMap: ExecutionMap = {
        id: randomUUID(),
        trialId: trial.id,
        protocolId,
        status: "draft",
        version: 1,
        metadata: {
          generatedBy: "system",
          reason: "future-workload-reconfigure",
          trialTitle: trial.title,
        },
        createdBy: Number.isFinite(Number(trial.createdBy)) ? Number(trial.createdBy) : 1,
        createdAt: now,
        launchedAt: null,
        updatedAt: now,
      };

      if (apply) {
        await db.insert(executionMaps).values(newMap);
        summary.mapsCreated += 1;
      }
      selectedMap = newMap;
    }

    const mapId = selectedMap.id;
    selectedMapIdByTrialId.set(trial.id, mapId);

    let phases = await db
      .select()
      .from(mapPhases)
      .where(eq(mapPhases.mapId, mapId))
      .orderBy(asc(mapPhases.displayOrder), asc(mapPhases.createdAt));

    if (phases.length === 0) {
      const fallbackPhases = FALLBACK_PHASE_BLUEPRINT.map((blueprint, index, all) => {
        const dates = normalizePhaseDates(weekStart, mapId, `${mapId}:phase:${index}`, index, all.length);
        return {
          id: randomUUID(),
          mapId,
          name: blueprint.name,
          phaseType: blueprint.phaseType,
          displayOrder: index,
          color: blueprint.color,
          estimatedDate: dates.estimatedDate,
          windowStart: dates.windowStart,
          windowEnd: dates.windowEnd,
          protocolRef: { section: blueprint.name, generated: true },
          canvasX: null,
          canvasY: null,
          createdAt: now,
          updatedAt: now,
        } as const;
      });

      if (apply) {
        await db.insert(mapPhases).values(fallbackPhases);
      }
      summary.phasesCreated += fallbackPhases.length;
      phases = fallbackPhases as unknown as MapPhase[];
    } else {
      for (let index = 0; index < phases.length; index += 1) {
        const phase = phases[index]!;
        const dates = normalizePhaseDates(weekStart, mapId, phase.id, index, phases.length);
        if (apply) {
          await db
            .update(mapPhases)
            .set({
              estimatedDate: dates.estimatedDate,
              windowStart: dates.windowStart,
              windowEnd: dates.windowEnd,
              updatedAt: now,
            })
            .where(eq(mapPhases.id, phase.id));
        }
        summary.phasesUpdated += 1;
        phases[index] = {
          ...phase,
          estimatedDate: dates.estimatedDate,
          windowStart: dates.windowStart,
          windowEnd: dates.windowEnd,
          updatedAt: now,
        };
      }
    }

    const hasVisitPhase = phases.some((phase) => isVisitPhase(phase.phaseType));
    if (!hasVisitPhase) {
      const extraPhaseDates = normalizePhaseDates(weekStart, mapId, `${mapId}:extra-follow-up`, 1, 4);
      const newPhase = {
        id: randomUUID(),
        mapId,
        name: "Future Follow-up",
        phaseType: "follow_up" as const,
        displayOrder: phases.length,
        color: "#14B8A6",
        estimatedDate: extraPhaseDates.estimatedDate,
        windowStart: extraPhaseDates.windowStart,
        windowEnd: extraPhaseDates.windowEnd,
        protocolRef: { section: "Follow-up", generated: true },
        canvasX: null,
        canvasY: null,
        createdAt: now,
        updatedAt: now,
      };
      if (apply) {
        await db.insert(mapPhases).values(newPhase);
      }
      phases.push(newPhase as MapPhase);
      summary.phasesCreated += 1;
    }

    let tasks = await db
      .select()
      .from(mapTasks)
      .where(eq(mapTasks.mapId, mapId))
      .orderBy(asc(mapTasks.phaseId), asc(mapTasks.orderInPhase), asc(mapTasks.createdAt));

    const tasksByPhaseId = new Map<string, MapTask[]>();
    for (const task of tasks) {
      const list = tasksByPhaseId.get(task.phaseId) ?? [];
      list.push(task);
      tasksByPhaseId.set(task.phaseId, list);
    }

    for (const phase of phases) {
      const phaseTasks = tasksByPhaseId.get(phase.id) ?? [];

      for (let index = 0; index < phaseTasks.length; index += 1) {
        const task = phaseTasks[index]!;
        const slot = parseTaskOrder(task, index);
        const dates = scheduleTaskDates(weekStart, mapId, phase.id, slot, task.id);
        if (apply) {
          await db
            .update(mapTasks)
            .set({
              suggestedDate: dates.suggestedDate,
              dueDate: dates.dueDate,
              startDate: normalizeToken(task.status) === "in_progress" ? dates.suggestedDate : task.startDate,
              completedDate: DONE_TASK_STATUSES.has(normalizeToken(task.status)) ? task.completedDate : null,
              updatedAt: now,
            })
            .where(eq(mapTasks.id, task.id));
        }
        summary.tasksUpdated += 1;
      }

      let openCount = phaseTasks.filter((task) => isOpenTaskStatus(task.status)).length;
      let nextOrder = phaseTasks.reduce((max, task) => Math.max(max, Number(task.orderInPhase || 0)), -1) + 1;

      while (openCount < MIN_OPEN_TASKS_PER_PHASE) {
        const slot = Math.max(0, nextOrder);
        const generatedId = randomUUID();
        const dates = scheduleTaskDates(weekStart, mapId, phase.id, slot, generatedId);
        const insertTask = {
          id: generatedId,
          phaseId: phase.id,
          mapId,
          name: `Planned ${phase.name} Task ${openCount + 1}`,
          description: "System-generated future task to ensure forward workload coverage.",
          category: resolveTaskCategory(phase.phaseType),
          priority: "medium" as const,
          status: "todo" as const,
          blockedReason: null,
          blockedSince: null,
          assignedRole: resolveTaskRole(phase.phaseType),
          assignedUserId: null,
          suggestedAssignee: null,
          suggestedDate: dates.suggestedDate,
          dueDate: dates.dueDate,
          estimatedDuration: 2,
          startDate: null,
          completedDate: null,
          orderInPhase: slot,
          canvasX: null,
          canvasY: null,
          createdBy: "ai" as const,
          aiConfidence: 0.75,
          conditionalNote: null,
          isCustom: false,
          tags: ["future", "auto-generated", "workload"],
          protocolRefs: [],
          createdAt: now,
          updatedAt: now,
        };

        if (apply) {
          await db.insert(mapTasks).values(insertTask);
        }
        summary.tasksCreated += 1;
        openCount += 1;
        nextOrder += 1;
      }
    }

    tasks = await db
      .select({ id: mapTasks.id })
      .from(mapTasks)
      .where(eq(mapTasks.mapId, mapId));

    const nextMetadata = {
      ...sanitizeObject(selectedMap.metadata),
      totalTasks: tasks.length,
      totalPhases: phases.length,
      futureConfiguredAt: now.toISOString(),
      futureHorizonWeeks: HORIZON_WEEKS,
      generatedBy: "future-workload-reconfigure",
    };

    if (apply) {
      await db
        .update(executionMaps)
        .set({
          metadata: nextMetadata,
          updatedAt: now,
        })
        .where(eq(executionMaps.id, mapId));
    }
  }

  const coverageModes: ConcreteMode[] =
    mode === "all" ? ["sample", "full", "building"] : [mode];

  for (const concreteMode of coverageModes) {
    const trialIds = filteredTrials
      .filter((trial) => shouldIncludeTrialForMode(trial.id, concreteMode))
      .map((trial) => trial.id);
    await ensureCoverageForMode(db, {
      apply,
      mode: concreteMode,
      weekStart,
      now,
      trialIds,
      mapIdByTrialId: selectedMapIdByTrialId,
      summary,
    });
  }

  const modeLabel = mode === "all" ? "all modes" : `${mode} mode`;
  console.log(
    JSON.stringify(
      {
        apply,
        mode: modeLabel,
        horizonWeeks: HORIZON_WEEKS,
        guaranteedCoverageWeeks: COVERAGE_WEEKS,
        summary,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[reconfigure-future-workload] failed", error);
  process.exit(1);
});
