import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  telemetryEvents,
  executionMaps,
  mapPhases,
  mapTasks,
  taskScaffolds,
  phases,
  tasks,
  taskDependencies,
  phaseTransitions,
  fileSearchStores,
  aiFeatureSnapshots,
  aiAnalyticsRollups,
  aiTrainingExamples,
  knowledgeGraphNodes,
  knowledgeGraphEdges,
} from "../../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type TelemetryStats = {
  totalEvents: number;
  eventsLast7Days: number;
  aiInvolvedEvents: number;
  aiUsageRate: number;
  byEventType: Record<string, number>;
  byAction: Record<string, number>;
  byEntityType: Record<string, number>;
  lastEventAt: Date | null;
  recent: any[];
  unavailable?: boolean;
};

export type ExecutionStats = {
  scaffolds: number;
  phases: number;
  visitLikePhases: number;
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    blocked: number;
    unassigned: number;
    dueToday: number;
    dueSoon: number;
    overdue: number;
    progressPercent: number;
  };
  unavailable?: boolean;
};

export type TrialChildAggregates = {
  telemetry: TelemetryStats;
  execution: ExecutionStats;
};

function emptyTelemetryStats(): TelemetryStats {
  return {
    totalEvents: 0,
    eventsLast7Days: 0,
    aiInvolvedEvents: 0,
    aiUsageRate: 0,
    byEventType: {},
    byAction: {},
    byEntityType: {},
    lastEventAt: null,
    recent: [],
  };
}

function emptyExecutionStats(): ExecutionStats {
  return {
    scaffolds: 0,
    phases: 0,
    visitLikePhases: 0,
    tasks: {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      blocked: 0,
      unassigned: 0,
      dueToday: 0,
      dueSoon: 0,
      overdue: 0,
      progressPercent: 0,
    },
  };
}

/**
 * Compute the FE-owned child-table aggregates (telemetry + execution) for a
 * trial, keyed by the BE trial UUID (Phase C re-key). Reads ONLY child tables
 * — never the retired FE `trials`/`protocols` tables. Degrades to empty
 * aggregates (never throws) when a query fails or `beTrialUuid` is null.
 */
export async function buildTrialChildAggregates(
  db: Db,
  beTrialUuid: string | null
): Promise<TrialChildAggregates> {
  const telemetry = await buildTelemetryStats(db, beTrialUuid);
  const execution = await buildExecutionStats(db, beTrialUuid);
  return { telemetry, execution };
}

/**
 * Best-effort cascade delete of FE-owned child data for a trial, keyed by the
 * BE trial UUID (Phase C re-key). Never reads/writes the retired FE `trials`
 * table. No-op when `beTrialUuid` is null. Never throws.
 */
export async function cleanupTrialChildData(
  db: Db,
  beTrialUuid: string | null
): Promise<void> {
  if (!beTrialUuid) return;
  try {
    const scaffoldRows = await db
      .select({ id: taskScaffolds.id })
      .from(taskScaffolds)
      .where(eq(taskScaffolds.trialId, beTrialUuid));
    const scaffoldIds = scaffoldRows.map((row) => row.id);

    const phaseRows = scaffoldIds.length
      ? await db
          .select({ id: phases.id })
          .from(phases)
          .where(inArray(phases.scaffoldId, scaffoldIds))
      : [];
    const phaseIds = phaseRows.map((row) => row.id);

    const taskRows = phaseIds.length
      ? await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.phaseId, phaseIds))
      : [];
    const taskIds = taskRows.map((row) => row.id);

    await db.transaction(async (tx) => {
      if (taskIds.length > 0) {
        await tx.delete(taskDependencies).where(inArray(taskDependencies.taskId, taskIds));
        await tx.delete(taskDependencies).where(inArray(taskDependencies.dependsOnTaskId, taskIds));
        await tx.delete(tasks).where(inArray(tasks.id, taskIds));
      }
      if (phaseIds.length > 0) {
        await tx.delete(phaseTransitions).where(inArray(phaseTransitions.fromPhaseId, phaseIds));
        await tx.delete(phaseTransitions).where(inArray(phaseTransitions.toPhaseId, phaseIds));
        await tx.delete(phases).where(inArray(phases.id, phaseIds));
      }
      if (scaffoldIds.length > 0) {
        await tx.delete(taskScaffolds).where(inArray(taskScaffolds.id, scaffoldIds));
      }
      await tx.delete(fileSearchStores).where(eq(fileSearchStores.trialId, beTrialUuid));
      await tx.delete(aiFeatureSnapshots).where(eq(aiFeatureSnapshots.trialId, beTrialUuid));
      await tx.delete(aiAnalyticsRollups).where(eq(aiAnalyticsRollups.trialId, beTrialUuid));
      await tx.delete(aiTrainingExamples).where(eq(aiTrainingExamples.trialId, beTrialUuid));
      await tx.delete(knowledgeGraphNodes).where(eq(knowledgeGraphNodes.trialId, beTrialUuid));
      await tx.delete(knowledgeGraphEdges).where(eq(knowledgeGraphEdges.trialId, beTrialUuid));
      await tx.delete(telemetryEvents).where(eq(telemetryEvents.entityId, beTrialUuid));
    });
  } catch (error) {
    console.warn("[trialContext] FE child cleanup failed (best-effort)", error);
  }
}

async function buildTelemetryStats(
  db: Db,
  beTrialUuid: string | null
): Promise<TelemetryStats> {
  if (!beTrialUuid) return emptyTelemetryStats();
  try {
    const trialEvents = await db
      .select({
        id: telemetryEvents.id,
        eventType: telemetryEvents.eventType,
        action: telemetryEvents.action,
        aiInvolved: telemetryEvents.aiInvolved,
        entityType: telemetryEvents.entityType,
        entityId: telemetryEvents.entityId,
        userId: telemetryEvents.userId,
        timestamp: telemetryEvents.timestamp,
      })
      .from(telemetryEvents)
      .where(eq(telemetryEvents.entityId, beTrialUuid))
      .orderBy(desc(telemetryEvents.timestamp))
      .limit(250);

    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const last7Days = trialEvents.filter((event) => {
      const ts = event.timestamp ? new Date(event.timestamp).getTime() : 0;
      return ts >= since;
    });
    const aiEvents = trialEvents.filter((event) => !!event.aiInvolved);

    const byEventType = trialEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
      return acc;
    }, {});
    const byAction = trialEvents.reduce<Record<string, number>>((acc, event) => {
      acc[event.action] = (acc[event.action] ?? 0) + 1;
      return acc;
    }, {});
    const byEntityType = trialEvents.reduce<Record<string, number>>((acc, event) => {
      const key = event.entityType ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    return {
      totalEvents: trialEvents.length,
      eventsLast7Days: last7Days.length,
      aiInvolvedEvents: aiEvents.length,
      aiUsageRate: trialEvents.length
        ? Number((aiEvents.length / trialEvents.length).toFixed(3))
        : 0,
      byEventType,
      byAction,
      byEntityType,
      lastEventAt: trialEvents[0]?.timestamp ?? null,
      recent: trialEvents.slice(0, 12),
    };
  } catch (error) {
    console.warn("[trialContext] Unable to build telemetry context", error);
    return { ...emptyTelemetryStats(), unavailable: true };
  }
}

async function buildExecutionStats(
  db: Db,
  beTrialUuid: string | null
): Promise<ExecutionStats> {
  if (!beTrialUuid) return emptyExecutionStats();
  try {
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const terminalStatuses = new Set(["done", "completed", "cancelled", "skipped"]);
    const blockedStatuses = new Set(["blocked", "waiting"]);
    const inProgressStatuses = new Set(["in_progress"]);

    const executionMapRows = await db
      .select({
        id: executionMaps.id,
        status: executionMaps.status,
        updatedAt: executionMaps.updatedAt,
      })
      .from(executionMaps)
      .where(eq(executionMaps.trialId, beTrialUuid))
      .orderBy(desc(executionMaps.updatedAt));

    const activeExecutionMap = executionMapRows.find((row) => row.status !== "archived") ?? null;
    const activeMapId = activeExecutionMap?.id ?? null;

    if (activeMapId) {
      const phaseRows = await db
        .select({
          id: mapPhases.id,
          name: mapPhases.name,
        })
        .from(mapPhases)
        .where(eq(mapPhases.mapId, activeMapId));

      const taskRows = await db
        .select({
          id: mapTasks.id,
          name: mapTasks.name,
          status: mapTasks.status,
          suggestedDate: mapTasks.suggestedDate,
          dueDate: mapTasks.dueDate,
          assignedUserId: mapTasks.assignedUserId,
        })
        .from(mapTasks)
        .where(eq(mapTasks.mapId, activeMapId));

      const normalizeStatus = (status: unknown) => String(status || "").toLowerCase();
      const totalTasks = taskRows.length;
      const completedTasks = taskRows.filter((task) => terminalStatuses.has(normalizeStatus(task.status))).length;
      const blockedTasks = taskRows.filter((task) => blockedStatuses.has(normalizeStatus(task.status))).length;
      const inProgressTasks = taskRows.filter((task) => inProgressStatuses.has(normalizeStatus(task.status))).length;
      const pendingTasks = taskRows.filter((task) => {
        const normalized = normalizeStatus(task.status);
        if (terminalStatuses.has(normalized)) return false;
        if (blockedStatuses.has(normalized)) return false;
        if (inProgressStatuses.has(normalized)) return false;
        return true;
      }).length;
      const unassignedTasks = taskRows.filter((task) => task.assignedUserId == null).length;
      const dueTodayTasks = taskRows.filter((task) => {
        const normalized = normalizeStatus(task.status);
        if (terminalStatuses.has(normalized)) return false;
        const candidateDate = task.dueDate || task.suggestedDate;
        if (!candidateDate) return false;
        return new Date(candidateDate).toISOString().slice(0, 10) === todayIso;
      }).length;
      const dueSoonTasks = taskRows.filter((task) => {
        const normalized = normalizeStatus(task.status);
        if (terminalStatuses.has(normalized)) return false;
        const candidateDate = task.dueDate || task.suggestedDate;
        if (!candidateDate) return false;
        const candidate = new Date(candidateDate);
        const deltaMs = candidate.getTime() - now.getTime();
        const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
        return deltaDays > 0 && deltaDays <= 3;
      }).length;
      const overdueTasks = taskRows.filter((task) => {
        const normalized = normalizeStatus(task.status);
        if (terminalStatuses.has(normalized)) return false;
        const candidateDate = task.dueDate || task.suggestedDate;
        if (!candidateDate) return false;
        return new Date(candidateDate) < now;
      }).length;
      const progressPercent = totalTasks
        ? Number(((completedTasks / totalTasks) * 100).toFixed(1))
        : 0;

      const visitLikePhases = phaseRows.filter((phase) =>
        /(visit|screening|follow-up|baseline|eos|week)/i.test(phase.name)
      );

      return {
        scaffolds: executionMapRows.length,
        phases: phaseRows.length,
        visitLikePhases: visitLikePhases.length,
        tasks: {
          total: totalTasks,
          pending: pendingTasks,
          inProgress: inProgressTasks,
          completed: completedTasks,
          blocked: blockedTasks,
          unassigned: unassignedTasks,
          dueToday: dueTodayTasks,
          dueSoon: dueSoonTasks,
          overdue: overdueTasks,
          progressPercent,
        },
      };
    }

    const scaffoldRows = await db
      .select({
        id: taskScaffolds.id,
        status: taskScaffolds.status,
      })
      .from(taskScaffolds)
      .where(eq(taskScaffolds.trialId, beTrialUuid));

    const scaffoldIds = scaffoldRows.map((row) => row.id);
    const phaseRows = scaffoldIds.length
      ? await db
          .select({
            id: phases.id,
            scaffoldId: phases.scaffoldId,
            name: phases.name,
          })
          .from(phases)
          .where(inArray(phases.scaffoldId, scaffoldIds))
      : [];

    const phaseIds = phaseRows.map((row) => row.id);
    const taskRows = phaseIds.length
      ? await db
          .select({
            id: tasks.id,
            phaseId: tasks.phaseId,
            name: tasks.name,
            suggestedDate: tasks.suggestedDate,
            status: tasks.status,
          })
          .from(tasks)
          .where(inArray(tasks.phaseId, phaseIds))
      : [];

    const pendingTasks = taskRows.filter((task) => task.status === "pending").length;
    const completedTasks = taskRows.filter((task) => task.status === "completed").length;
    const blockedTasks = taskRows.filter((task) => task.status === "blocked").length;
    const dueTodayTasks = taskRows.filter((task) => {
      if (!task.suggestedDate || task.status === "completed") return false;
      return new Date(task.suggestedDate).toISOString().slice(0, 10) === todayIso;
    }).length;
    const dueSoonTasks = taskRows.filter((task) => {
      if (!task.suggestedDate || task.status === "completed") return false;
      const candidate = new Date(task.suggestedDate);
      const deltaMs = candidate.getTime() - now.getTime();
      const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
      return deltaDays > 0 && deltaDays <= 3;
    }).length;
    const overdueTasks = taskRows.filter((task) => {
      if (!task.suggestedDate || task.status === "completed") return false;
      return new Date(task.suggestedDate) < now;
    }).length;
    const totalTasks = taskRows.length;
    const progressPercent = totalTasks
      ? Number(((completedTasks / totalTasks) * 100).toFixed(1))
      : 0;

    const visitLikePhases = phaseRows.filter((phase) =>
      /(visit|screening|follow-up|baseline|eos|week)/i.test(phase.name)
    );

    return {
      scaffolds: scaffoldRows.length,
      phases: phaseRows.length,
      visitLikePhases: visitLikePhases.length,
      tasks: {
        total: totalTasks,
        pending: pendingTasks,
        inProgress: 0,
        completed: completedTasks,
        blocked: blockedTasks,
        unassigned: 0,
        dueToday: dueTodayTasks,
        dueSoon: dueSoonTasks,
        overdue: overdueTasks,
        progressPercent,
      },
    };
  } catch (error) {
    console.warn("[trialContext] Unable to build execution context", error);
    return { ...emptyExecutionStats(), unavailable: true };
  }
}
