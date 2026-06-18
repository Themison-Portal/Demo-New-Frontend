import {
  aiAnalyticsRollups,
  aiFeatureSnapshots,
  aiTrainingExamples,
  fileSearchDocuments,
  protocolChunks,
  phases,
  protocols,
  tasks,
  taskScaffolds,
  telemetryEvents,
  trials,
  knowledgeGraphEdges,
  knowledgeGraphNodes,
} from "../../drizzle/schema";
import { and, desc, eq, inArray, like, notLike } from "drizzle-orm";
import type { DemoMode } from "./demoMode";
import { stripDemoId } from "./demoMode";
import { resolveBeTrialIdForRead } from "./coreBackendDocs";
import { ENV } from "./env";

const USES_EXTERNAL_RAG = ENV.ragProvider === "external";

function toDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampBps(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10000, Math.round(value)));
}

export type TrialIntelligenceSnapshot = {
  trialId: string;
  /**
   * BE trial UUID (migrated child tables are keyed by this), or null when the
   * trial has no BE mapping yet. `trialId` stays the FE id for `trials`/`protocols`.
   */
  beTrialUuid: string | null;
  snapshotDate: string;
  trial: {
    title: string;
    status: string;
    phase: string | null;
    sponsor: string | null;
    indication: string | null;
    startDate: Date | null;
    endDate: Date | null;
    enrolledPatients: number;
    targetPatients: number | null;
  };
  documents: {
    total: number;
    active: number;
    archived: number;
    indexed: number;
    processing: number;
    protocolCount: number;
    latestUploadedAt: Date | null;
    currentProtocolId: number | null;
    aiCoverageScore: number;
  };
  execution: {
    scaffolds: number;
    phases: number;
    visitLikePhases: number;
    taskTotal: number;
    taskPending: number;
    taskCompleted: number;
    taskBlocked: number;
    taskProgressPercent: number;
    taskDueToday: number;
  };
  telemetry: {
    totalEvents: number;
    eventsLast7Days: number;
    aiInvolvedEvents: number;
    aiUsageRate: number;
    byEventType: Record<string, number>;
  };
  scores: {
    readinessScore: number;
    riskScore: number;
    aiCoverageScore: number;
  };
  features: Record<string, unknown>;
};

export async function computeTrialIntelligenceSnapshot(
  db: any,
  trialId: string,
  beTrialUuid: string | null = null
): Promise<TrialIntelligenceSnapshot | null> {
  const [trial] = await db.select().from(trials).where(eq(trials.id, trialId)).limit(1);
  if (!trial) return null;

  const protocolRows = await db
    .select()
    .from(protocols)
    .where(eq(protocols.trialId, trialId))
    .orderBy(desc(protocols.createdAt));

  const protocolIds = protocolRows.map((row: any) => row.id);
  const indexedIds =
    protocolIds.length > 0
      ? new Set(
          (
            USES_EXTERNAL_RAG
              ? await db
                  .select({ protocolId: protocolChunks.protocolId })
                  .from(protocolChunks)
                  .where(inArray(protocolChunks.protocolId, protocolIds))
              : await db
                  .select({ protocolId: fileSearchDocuments.protocolId })
                  .from(fileSearchDocuments)
                  .where(inArray(fileSearchDocuments.protocolId, protocolIds))
          ).map((row: any) => row.protocolId)
        )
      : new Set<number>();

  const activeDocs = protocolRows.filter((doc: any) => !doc.archivedAt);
  const archivedDocs = protocolRows.filter((doc: any) => !!doc.archivedAt);
  const indexedDocs = activeDocs.filter((doc: any) => indexedIds.has(doc.id));
  const processingDocs = activeDocs.filter((doc: any) => !indexedIds.has(doc.id));
  const protocolDocs = protocolRows.filter((doc: any) =>
    String(doc.category || "").toLowerCase() === "protocol"
  );
  const currentProtocol =
    protocolDocs.find((doc: any) => !!doc.isCurrent && !doc.archivedAt) ??
    protocolDocs.find((doc: any) => !doc.archivedAt) ??
    protocolDocs[0] ??
    null;
  const aiCoverageScore = activeDocs.length
    ? clampPercent((indexedDocs.length / activeDocs.length) * 100)
    : 0;

  // taskScaffolds is BE-keyed: query by the BE trial UUID, never the FE id.
  const scaffoldRows = beTrialUuid
    ? await db
        .select({ id: taskScaffolds.id })
        .from(taskScaffolds)
        .where(eq(taskScaffolds.trialId, beTrialUuid))
    : [];
  const scaffoldIds = scaffoldRows.map((row: any) => row.id);

  const phaseRows = scaffoldIds.length
    ? await db
        .select({ id: phases.id, name: phases.name })
        .from(phases)
        .where(inArray(phases.scaffoldId, scaffoldIds))
    : [];
  const phaseIds = phaseRows.map((row: any) => row.id);

  const taskRows = phaseIds.length
    ? await db
        .select({
          id: tasks.id,
          status: tasks.status,
          suggestedDate: tasks.suggestedDate,
        })
        .from(tasks)
        .where(inArray(tasks.phaseId, phaseIds))
    : [];

  const todayKey = toDayKey();
  const taskPending = taskRows.filter((task: any) => task.status === "pending").length;
  const taskCompleted = taskRows.filter((task: any) => task.status === "completed").length;
  const taskBlocked = taskRows.filter((task: any) => task.status === "blocked").length;
  const taskTotal = taskRows.length;
  const taskDueToday = taskRows.filter((task: any) => {
    if (!task.suggestedDate || task.status === "completed") return false;
    return new Date(task.suggestedDate).toISOString().slice(0, 10) === todayKey;
  }).length;
  const taskProgressPercent = taskTotal ? clampPercent((taskCompleted / taskTotal) * 100) : 0;
  const visitLikePhases = phaseRows.filter((row: any) =>
    /(visit|screening|follow-up|baseline|eos|week)/i.test(String(row.name || ""))
  ).length;

  const relatedEntityIds = [trialId, ...protocolIds.map((id: number) => String(id))];
  const eventRows = await db
    .select({
      id: telemetryEvents.id,
      eventType: telemetryEvents.eventType,
      aiInvolved: telemetryEvents.aiInvolved,
      timestamp: telemetryEvents.timestamp,
    })
    .from(telemetryEvents)
    .where(
      relatedEntityIds.length > 1
        ? inArray(telemetryEvents.entityId, relatedEntityIds)
        : eq(telemetryEvents.entityId, trialId)
    )
    .orderBy(desc(telemetryEvents.timestamp))
    .limit(500);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const eventsLast7Days = eventRows.filter((event: any) => {
    const ts = event.timestamp ? new Date(event.timestamp).getTime() : 0;
    return ts >= sevenDaysAgo;
  });
  const aiEventsLast7Days = eventsLast7Days.filter((event: any) => !!event.aiInvolved);
  const aiUsageRate = eventsLast7Days.length
    ? Number((aiEventsLast7Days.length / eventsLast7Days.length).toFixed(4))
    : 0;

  const byEventType = eventsLast7Days.reduce((acc: Record<string, number>, event: any) => {
    const key = event.eventType || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const timelineSet = Boolean(trial.startDate) && Boolean(trial.endDate);
  const readinessParts = [
    protocolRows.length > 0,
    indexedDocs.length > 0,
    taskTotal > 0,
    timelineSet,
    (trial.status || "not-started") !== "not-started",
  ];
  const readinessScore = clampPercent(
    (readinessParts.filter(Boolean).length / readinessParts.length) * 100
  );

  const riskScore = clampPercent(
    taskBlocked * 25 +
      (processingDocs.length > 0 ? 20 : 0) +
      (taskDueToday > 0 ? Math.min(25, taskDueToday * 5) : 0) +
      (eventsLast7Days.length === 0 ? 10 : 0) +
      ((trial.status || "not-started") === "on-hold" ? 20 : 0)
  );

  const features: Record<string, unknown> = {
    documents_total: protocolRows.length,
    documents_active: activeDocs.length,
    documents_archived: archivedDocs.length,
    documents_indexed: indexedDocs.length,
    documents_processing: processingDocs.length,
    tasks_total: taskTotal,
    tasks_pending: taskPending,
    tasks_completed: taskCompleted,
    tasks_blocked: taskBlocked,
    tasks_due_today: taskDueToday,
    task_progress_percent: taskProgressPercent,
    visit_like_phase_count: visitLikePhases,
    telemetry_events_7d: eventsLast7Days.length,
    ai_events_7d: aiEventsLast7Days.length,
    ai_usage_rate: aiUsageRate,
    trial_status: trial.status,
    timeline_set: timelineSet,
    enrolled_patients: trial.enrolledPatients ?? 0,
    target_patients: trial.targetPatients ?? null,
  };

  return {
    trialId,
    beTrialUuid,
    snapshotDate: toDayKey(),
    trial: {
      title: trial.title,
      status: trial.status,
      phase: trial.phase,
      sponsor: trial.sponsor,
      indication: trial.indication,
      startDate: trial.startDate,
      endDate: trial.endDate,
      enrolledPatients: trial.enrolledPatients ?? 0,
      targetPatients: trial.targetPatients ?? null,
    },
    documents: {
      total: protocolRows.length,
      active: activeDocs.length,
      archived: archivedDocs.length,
      indexed: indexedDocs.length,
      processing: processingDocs.length,
      protocolCount: protocolDocs.length,
      latestUploadedAt: protocolRows[0]?.createdAt ?? null,
      currentProtocolId: currentProtocol?.id ?? null,
      aiCoverageScore,
    },
    execution: {
      scaffolds: scaffoldRows.length,
      phases: phaseRows.length,
      visitLikePhases,
      taskTotal,
      taskPending,
      taskCompleted,
      taskBlocked,
      taskProgressPercent,
      taskDueToday,
    },
    telemetry: {
      totalEvents: eventRows.length,
      eventsLast7Days: eventsLast7Days.length,
      aiInvolvedEvents: aiEventsLast7Days.length,
      aiUsageRate,
      byEventType,
    },
    scores: {
      readinessScore,
      riskScore,
      aiCoverageScore,
    },
    features,
  };
}

export async function persistTrialSnapshot(
  db: any,
  snapshot: TrialIntelligenceSnapshot,
  snapshotVersion = "v1"
) {
  // aiFeatureSnapshots / aiAnalyticsRollups are BE-keyed: skip persistence when
  // the trial has no BE mapping yet (never write a null/FE trialId).
  const beTrialUuid = snapshot.beTrialUuid;
  if (!beTrialUuid) return;

  await db.insert(aiFeatureSnapshots).values({
    trialId: beTrialUuid,
    snapshotDate: snapshot.snapshotDate,
    snapshotVersion,
    featureVector: snapshot.features,
    readinessScore: snapshot.scores.readinessScore,
    riskScore: snapshot.scores.riskScore,
    aiCoverageScore: snapshot.scores.aiCoverageScore,
    createdAt: new Date(),
  });

  await db
    .delete(aiAnalyticsRollups)
    .where(and(eq(aiAnalyticsRollups.trialId, beTrialUuid), eq(aiAnalyticsRollups.rollupDate, snapshot.snapshotDate)));

  await db.insert(aiAnalyticsRollups).values({
    trialId: beTrialUuid,
    rollupDate: snapshot.snapshotDate,
    documentTotal: snapshot.documents.total,
    documentIndexed: snapshot.documents.indexed,
    taskTotal: snapshot.execution.taskTotal,
    taskPending: snapshot.execution.taskPending,
    taskBlocked: snapshot.execution.taskBlocked,
    taskCompleted: snapshot.execution.taskCompleted,
    telemetryEvents7d: snapshot.telemetry.eventsLast7Days,
    aiInvolvedEvents7d: snapshot.telemetry.aiInvolvedEvents,
    aiUsageRateBps: clampBps(snapshot.telemetry.aiUsageRate * 10000),
    riskScore: snapshot.scores.riskScore,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function syncTrialKnowledgeGraph(
  db: any,
  trialId: string,
  beTrialUuid: string | null = null
) {
  const [trial] = await db.select().from(trials).where(eq(trials.id, trialId)).limit(1);
  if (!trial) {
    return {
      trialId,
      nodesCreated: 0,
      edgesCreated: 0,
      skipped: true,
      reason: "Trial not found",
    } as const;
  }

  // knowledgeGraphNodes/Edges and taskScaffolds are BE-keyed: without a BE trial
  // UUID there is nothing to key these reads/writes on, so skip.
  if (!beTrialUuid) {
    return {
      trialId,
      nodesCreated: 0,
      edgesCreated: 0,
      skipped: true,
      reason: "No BE trial mapping",
    } as const;
  }

  const protocolRows = await db.select().from(protocols).where(eq(protocols.trialId, trialId));
  const scaffoldRows = await db.select().from(taskScaffolds).where(eq(taskScaffolds.trialId, beTrialUuid));
  const scaffoldIds = scaffoldRows.map((row: any) => row.id);
  const phaseRows = scaffoldIds.length
    ? await db.select().from(phases).where(inArray(phases.scaffoldId, scaffoldIds))
    : [];
  const phaseIds = phaseRows.map((row: any) => row.id);
  const taskRows = phaseIds.length
    ? await db.select().from(tasks).where(inArray(tasks.phaseId, phaseIds))
    : [];

  await db.delete(knowledgeGraphEdges).where(eq(knowledgeGraphEdges.trialId, beTrialUuid));
  await db.delete(knowledgeGraphNodes).where(eq(knowledgeGraphNodes.trialId, beTrialUuid));

  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  const knownSections = new Set<string>();

  const trialNodeKey = `trial:${trial.id}`;
  nodes.push({
    trialId: beTrialUuid,
    nodeType: "Trial",
    nodeKey: trialNodeKey,
    displayName: trial.investigationalProduct || trial.title || trial.id,
    properties: {
      title: trial.title,
      status: trial.status,
      phase: trial.phase,
      sponsor: trial.sponsor,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  for (const doc of protocolRows) {
    const docNodeKey = `document:${doc.id}`;
    nodes.push({
      trialId: beTrialUuid,
      nodeType: "Document",
      nodeKey: docNodeKey,
      displayName: doc.filename,
      properties: {
        category: doc.category,
        isCurrent: doc.isCurrent,
        archivedAt: doc.archivedAt,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    edges.push({
      trialId: beTrialUuid,
      edgeType: "HAS_DOCUMENT",
      fromNodeKey: trialNodeKey,
      toNodeKey: docNodeKey,
      properties: {
        category: doc.category,
      },
      createdAt: new Date(),
    });
  }

  for (const phase of phaseRows) {
    const phaseNodeKey = `phase:${phase.id}`;
    nodes.push({
      trialId: beTrialUuid,
      nodeType: "Phase",
      nodeKey: phaseNodeKey,
      displayName: phase.name,
      properties: {
        scaffoldId: phase.scaffoldId,
        color: phase.color,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    edges.push({
      trialId: beTrialUuid,
      edgeType: "HAS_PHASE",
      fromNodeKey: trialNodeKey,
      toNodeKey: phaseNodeKey,
      properties: null,
      createdAt: new Date(),
    });
  }

  for (const task of taskRows) {
    const taskNodeKey = `task:${task.id}`;
    nodes.push({
      trialId: beTrialUuid,
      nodeType: "Task",
      nodeKey: taskNodeKey,
      displayName: task.name,
      properties: {
        phaseId: task.phaseId,
        status: task.status,
        suggestedDate: task.suggestedDate,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    edges.push({
      trialId: beTrialUuid,
      edgeType: "HAS_TASK",
      fromNodeKey: `phase:${task.phaseId}`,
      toNodeKey: taskNodeKey,
      properties: null,
      createdAt: new Date(),
    });

    if (task.protocolSection) {
      const sectionNodeKey = `section:${String(task.protocolSection).trim().toLowerCase()}`;
      if (!knownSections.has(sectionNodeKey)) {
        knownSections.add(sectionNodeKey);
        nodes.push({
          trialId: beTrialUuid,
          nodeType: "Section",
          nodeKey: sectionNodeKey,
          displayName: task.protocolSection,
          properties: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      edges.push({
        trialId: beTrialUuid,
        edgeType: "DERIVED_FROM",
        fromNodeKey: taskNodeKey,
        toNodeKey: sectionNodeKey,
        properties: task.protocolPage ? { protocolPage: task.protocolPage } : null,
        createdAt: new Date(),
      });
    }
  }

  if (nodes.length) {
    await db.insert(knowledgeGraphNodes).values(nodes as any);
  }
  if (edges.length) {
    await db.insert(knowledgeGraphEdges).values(edges as any);
  }

  return {
    trialId,
    nodesCreated: nodes.length,
    edgesCreated: edges.length,
  } as const;
}

async function getTrialsForMode(db: any, mode: DemoMode) {
  const prefixed = await db
    .select()
    .from(trials)
    .where(like(trials.id, `${mode}:%`))
    .orderBy(trials.createdAt);

  if (prefixed.length > 0) return prefixed;
  if (mode === "building") return [];

  return await db
    .select()
    .from(trials)
    .where(notLike(trials.id, "%:%"))
    .orderBy(trials.createdAt);
}

export async function buildCrossTrialAnalytics(db: any, mode: DemoMode, persistRollups = false) {
  const trialRows = await getTrialsForMode(db, mode);
  const snapshots = (
    await Promise.all(
      trialRows.map(async (trial: any) => {
        // Migrated child tables (taskScaffolds, ai_* rollups) are BE-keyed:
        // resolve each FE trial id to its BE trial UUID (or null).
        const beTrialUuid = await resolveBeTrialIdForRead(db, mode, stripDemoId(String(trial.id)));
        return computeTrialIntelligenceSnapshot(db, trial.id, beTrialUuid);
      })
    )
  ).filter((snapshot): snapshot is TrialIntelligenceSnapshot => Boolean(snapshot));

  if (persistRollups) {
    for (const snapshot of snapshots) {
      await persistTrialSnapshot(db, snapshot, "v1");
    }
  }

  const totalTrials = snapshots.length;
  const avg = (values: number[]) =>
    values.length ? Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(2)) : 0;

  const averageReadiness = avg(snapshots.map((snapshot) => snapshot.scores.readinessScore));
  const averageRisk = avg(snapshots.map((snapshot) => snapshot.scores.riskScore));
  const averageAiCoverage = avg(snapshots.map((snapshot) => snapshot.scores.aiCoverageScore));

  const atRiskTrials = snapshots
    .filter((snapshot) => snapshot.scores.riskScore >= 60)
    .sort((a, b) => b.scores.riskScore - a.scores.riskScore)
    .map((snapshot) => ({
      trialId: snapshot.trialId,
      title: snapshot.trial.title,
      riskScore: snapshot.scores.riskScore,
      blockedTasks: snapshot.execution.taskBlocked,
      processingDocuments: snapshot.documents.processing,
    }));

  const benchmark = {
    medianTaskCompletion:
      snapshots.length > 0
        ? [...snapshots]
            .map((snapshot) => snapshot.execution.taskProgressPercent)
            .sort((a, b) => a - b)[Math.floor(snapshots.length / 2)] ?? 0
        : 0,
    highAiAdoptionTrials: snapshots.filter((snapshot) => snapshot.telemetry.aiUsageRate >= 0.3).length,
    lowReadinessTrials: snapshots.filter((snapshot) => snapshot.scores.readinessScore < 50).length,
  };

  return {
    mode,
    generatedAt: new Date().toISOString(),
    totalTrials,
    averageReadiness,
    averageRisk,
    averageAiCoverage,
    benchmark,
    atRiskTrials,
    topSignals: {
      blockedTaskTrials: snapshots.filter((snapshot) => snapshot.execution.taskBlocked > 0).length,
      indexingLagTrials: snapshots.filter((snapshot) => snapshot.documents.processing > 0).length,
      timelineMissingTrials: snapshots.filter(
        (snapshot) => !(snapshot.trial.startDate && snapshot.trial.endDate)
      ).length,
    },
  };
}

export async function exportTrainingDataset(db: any, limit = 500) {
  const cappedLimit = Math.max(1, Math.min(limit, 5000));
  const examples = await db
    .select()
    .from(aiTrainingExamples)
    .orderBy(desc(aiTrainingExamples.createdAt))
    .limit(cappedLimit);

  const trialIds = Array.from(
    new Set(examples.map((example: any) => example.trialId).filter((id: string | null) => !!id))
  ) as string[];

  const snapshotRows = trialIds.length
    ? await db
        .select()
        .from(aiFeatureSnapshots)
        .where(inArray(aiFeatureSnapshots.trialId, trialIds))
        .orderBy(desc(aiFeatureSnapshots.createdAt))
    : [];

  const latestSnapshotByTrial = new Map<string, any>();
  for (const snapshot of snapshotRows) {
    if (!latestSnapshotByTrial.has(snapshot.trialId)) {
      latestSnapshotByTrial.set(snapshot.trialId, snapshot);
    }
  }

  const records: Array<{
    id: number;
    sourceEventId: string | null;
    trialId: string | null;
    userId: string | null;
    label: string;
    prompt: string | null;
    response: string | null;
    correction: string | null;
    metadata: unknown;
    featureVector: unknown;
    featureSnapshotDate: string | null;
    createdAt: Date;
  }> = examples.map((example: any) => {
    const snapshot = example.trialId ? latestSnapshotByTrial.get(example.trialId) : null;
    return {
      id: example.id,
      sourceEventId: example.sourceEventId,
      trialId: example.trialId,
      userId: example.userId,
      label: example.label,
      prompt: example.prompt,
      response: example.response,
      correction: example.correction,
      metadata: example.metadata ?? {},
      featureVector: snapshot?.featureVector ?? {},
      featureSnapshotDate: snapshot?.snapshotDate ?? null,
      createdAt: example.createdAt,
    };
  });

  const jsonl = records.map((record) => JSON.stringify(record)).join("\n");
  const labelDistribution = records.reduce((acc: Record<string, number>, record) => {
    acc[record.label] = (acc[record.label] ?? 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    count: records.length,
    labelDistribution,
    records,
    jsonl,
  };
}
