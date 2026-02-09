import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  executionMaps,
  mapPhases,
  mapPhaseTransitions,
  mapTaskDependencies,
  mapTasks,
} from "../drizzle/schema";
import { getDb } from "../server/db";

type SeedTask = {
  name: string;
  category: (typeof mapTasks.category.enumValues)[number];
  role: (typeof mapTasks.assignedRole.enumValues)[number];
  duration: number;
  priority?: (typeof mapTasks.priority.enumValues)[number];
};

const SEED_MAP = {
  protocolTitle: "Phase II Open-Label Study of Tirzepatide in Type 2 Diabetes",
  sponsor: "Novo Nordisk",
  indication: "Type 2 Diabetes Mellitus",
  phases: [
    {
      name: "Screening",
      phaseType: "screening",
      color: "#3B82F6",
      tasks: [
        { name: "Review inclusion/exclusion criteria", category: "eligibility", role: "crc", duration: 30 },
        { name: "Obtain informed consent", category: "consent", role: "pi", duration: 45 },
        { name: "Collect medical history", category: "assessment", role: "crc", duration: 20 },
        { name: "Perform physical examination", category: "assessment", role: "pi", duration: 30 },
        { name: "Draw screening blood samples", category: "lab_sample", role: "nurse", duration: 15 },
        { name: "Perform 12-lead ECG", category: "assessment", role: "nurse", duration: 10 },
        { name: "Record vital signs", category: "vital_signs", role: "nurse", duration: 10 },
        { name: "Enter screening data in EDC", category: "data_entry", role: "crc", duration: 20 },
      ] as SeedTask[],
    },
    {
      name: "Visit 1 - Baseline / Randomization",
      phaseType: "baseline",
      color: "#10B981",
      tasks: [
        { name: "Verify eligibility confirmation", category: "eligibility", role: "crc", duration: 15 },
        { name: "Confirm continued consent", category: "consent", role: "pi", duration: 10 },
        { name: "Record baseline vital signs", category: "vital_signs", role: "nurse", duration: 10 },
        { name: "Draw baseline blood samples", category: "lab_sample", role: "nurse", duration: 15 },
        { name: "Collect baseline urine sample", category: "lab_sample", role: "nurse", duration: 5 },
        { name: "Perform randomization via IRT", category: "coordination", role: "crc", duration: 15 },
        { name: "Administer first dose of study drug", category: "drug_administration", role: "nurse", duration: 20, priority: "critical" },
        { name: "Observe patient for 1 hour post-dose", category: "safety_reporting", role: "nurse", duration: 60, priority: "critical" },
        { name: "Complete baseline CRF pages", category: "data_entry", role: "crc", duration: 30 },
      ] as SeedTask[],
    },
    {
      name: "Visit 2 - Week 4",
      phaseType: "treatment_visit",
      color: "#F59E0B",
      tasks: [
        { name: "Check visit window compliance", category: "coordination", role: "crc", duration: 5 },
        { name: "Assess adverse events since last visit", category: "safety_reporting", role: "pi", duration: 15 },
        { name: "Review concomitant medications", category: "assessment", role: "crc", duration: 10 },
        { name: "Record vital signs", category: "vital_signs", role: "nurse", duration: 10 },
        { name: "Draw Week 4 blood samples", category: "lab_sample", role: "nurse", duration: 15 },
        { name: "Administer study drug dose 2", category: "drug_administration", role: "nurse", duration: 20, priority: "critical" },
        { name: "Complete Visit 2 CRF pages", category: "data_entry", role: "crc", duration: 25 },
        { name: "Schedule next visit with patient", category: "coordination", role: "crc", duration: 10 },
      ] as SeedTask[],
    },
    {
      name: "Screen Fail",
      phaseType: "screen_fail",
      color: "#EF4444",
      tasks: [
        { name: "Document screen failure reason", category: "documentation", role: "crc", duration: 15 },
        { name: "Notify sponsor of screen failure", category: "coordination", role: "crc", duration: 10 },
        { name: "End participation and update CTMS", category: "data_entry", role: "crc", duration: 10 },
      ] as SeedTask[],
    },
    {
      name: "Early Termination",
      phaseType: "early_termination",
      color: "#6366F1",
      tasks: [
        { name: "Document reason for early termination", category: "documentation", role: "pi", duration: 20 },
        { name: "Perform end-of-study assessments", category: "assessment", role: "pi", duration: 30 },
        { name: "Draw final blood samples", category: "lab_sample", role: "nurse", duration: 15 },
        { name: "Complete termination CRF", category: "data_entry", role: "crc", duration: 20 },
        { name: "Notify sponsor and IRB", category: "regulatory", role: "regulatory_coordinator", duration: 30 },
      ] as SeedTask[],
    },
  ] as const,
  transitions: [
    { from: "Screening", to: "Visit 1 - Baseline / Randomization", condition: "Eligible", isDefault: true },
    { from: "Screening", to: "Screen Fail", condition: "Not Eligible", isDefault: false },
    { from: "Visit 1 - Baseline / Randomization", to: "Visit 2 - Week 4", condition: null, isDefault: true },
    { from: "Visit 1 - Baseline / Randomization", to: "Early Termination", condition: "Withdrawn", isDefault: false },
    { from: "Visit 2 - Week 4", to: "Early Termination", condition: "Withdrawn", isDefault: false },
  ],
  dependencies: [
    { source: "Obtain informed consent", target: "Review inclusion/exclusion criteria", type: "finish_to_start" },
    { source: "Obtain informed consent", target: "Collect medical history", type: "finish_to_start" },
    { source: "Obtain informed consent", target: "Perform physical examination", type: "finish_to_start" },
    { source: "Obtain informed consent", target: "Draw screening blood samples", type: "finish_to_start" },
    { source: "Draw screening blood samples", target: "Enter screening data in EDC", type: "finish_to_start" },
    { source: "Perform 12-lead ECG", target: "Enter screening data in EDC", type: "finish_to_start" },
    { source: "Verify eligibility confirmation", target: "Perform randomization via IRT", type: "finish_to_start" },
    { source: "Perform randomization via IRT", target: "Administer first dose of study drug", type: "finish_to_start" },
    { source: "Administer first dose of study drug", target: "Observe patient for 1 hour post-dose", type: "finish_to_start" },
    { source: "Obtain informed consent", target: "Verify eligibility confirmation", type: "finish_to_start" },
  ] as const,
};

async function seedMap({ trialId, protocolId, createdBy }: { trialId: string; protocolId: number; createdBy: number }) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const [existing] = await db
    .select({ id: executionMaps.id })
    .from(executionMaps)
    .where(and(eq(executionMaps.trialId, trialId), eq(executionMaps.status, "draft")))
    .limit(1);

  if (existing) {
    console.log(`Draft map already exists for trial ${trialId}: ${existing.id}`);
    return;
  }

  const mapId = randomUUID();
  await db.insert(executionMaps).values({
    id: mapId,
    trialId,
    protocolId,
    status: "draft",
    version: 1,
    metadata: {
      protocolTitle: SEED_MAP.protocolTitle,
      sponsor: SEED_MAP.sponsor,
      indication: SEED_MAP.indication,
      totalTasks: SEED_MAP.phases.reduce((acc, phase) => acc + phase.tasks.length, 0),
      totalPhases: SEED_MAP.phases.length,
      generatedBy: "hybrid",
    },
    createdBy,
  });

  const phaseIds = new Map<string, string>();
  const taskIds = new Map<string, string>();

  for (let phaseIndex = 0; phaseIndex < SEED_MAP.phases.length; phaseIndex += 1) {
    const phase = SEED_MAP.phases[phaseIndex];
    const phaseId = randomUUID();
    phaseIds.set(phase.name, phaseId);
    await db.insert(mapPhases).values({
      id: phaseId,
      mapId,
      name: phase.name,
      phaseType: phase.phaseType,
      displayOrder: phaseIndex,
      color: phase.color,
    });

    for (let taskIndex = 0; taskIndex < phase.tasks.length; taskIndex += 1) {
      const task = phase.tasks[taskIndex];
      const taskId = randomUUID();
      taskIds.set(task.name, taskId);
      await db.insert(mapTasks).values({
        id: taskId,
        mapId,
        phaseId,
        name: task.name,
        category: task.category,
        priority: task.priority ?? "medium",
        status: "suggested",
        assignedRole: task.role,
        estimatedDuration: task.duration,
        orderInPhase: taskIndex,
        createdBy: "ai",
        aiConfidence: 0.82,
        protocolRefs: [{ documentId: protocolId, section: phase.name }],
      });
    }
  }

  for (const transition of SEED_MAP.transitions) {
    const fromPhaseId = phaseIds.get(transition.from);
    const toPhaseId = phaseIds.get(transition.to);
    if (!fromPhaseId || !toPhaseId) continue;
    await db.insert(mapPhaseTransitions).values({
      id: randomUUID(),
      fromPhaseId,
      toPhaseId,
      conditionLabel: transition.condition,
      isDefault: transition.isDefault,
    });
  }

  for (const dependency of SEED_MAP.dependencies) {
    const sourceTaskId = taskIds.get(dependency.source);
    const targetTaskId = taskIds.get(dependency.target);
    if (!sourceTaskId || !targetTaskId) continue;
    const sourceTask = await db
      .select({ phaseId: mapTasks.phaseId })
      .from(mapTasks)
      .where(eq(mapTasks.id, sourceTaskId))
      .limit(1);
    const targetTask = await db
      .select({ phaseId: mapTasks.phaseId })
      .from(mapTasks)
      .where(eq(mapTasks.id, targetTaskId))
      .limit(1);
    await db.insert(mapTaskDependencies).values({
      id: randomUUID(),
      sourceTaskId,
      targetTaskId,
      dependencyType: dependency.type,
      isCrossPhase: sourceTask[0]?.phaseId !== targetTask[0]?.phaseId,
    });
  }

  console.log(`Seeded execution map ${mapId} for trial ${trialId}`);
}

async function main() {
  const trialId = process.argv[2];
  const protocolIdRaw = process.argv[3];
  const createdByRaw = process.argv[4];

  if (!trialId || !protocolIdRaw) {
    console.error("Usage: tsx scripts/seedMap.ts <trialId> <protocolId> [createdByUserId]");
    process.exit(1);
  }

  await seedMap({
    trialId,
    protocolId: Number(protocolIdRaw),
    createdBy: createdByRaw ? Number(createdByRaw) : 1,
  });
}

main().catch((error) => {
  console.error("Failed to seed map:", error);
  process.exit(1);
});
