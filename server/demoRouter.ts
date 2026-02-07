import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  documentCategories,
  fileSearchDocuments,
  fileSearchStores,
  phaseTransitions,
  phases,
  protocolSections,
  protocols,
  taskDependencies,
  taskScaffolds,
  tasks,
  trials,
} from "../drizzle/schema";
import { toDemoId, type DemoMode } from "./_core/demoMode";
import { inArray, like, or } from "drizzle-orm";

const DEFAULT_CATEGORIES = [
  "Protocol",
  "Lab Manual",
  "Pharmacy Manual",
  "Schedule of Assessments (SoA)",
  "Informed Consent Form (ICF)",
  "EDC/CRF Completion Guide",
  "Safety Reporting Manual",
  "Monitoring Plan",
];

const SAMPLE_TRIALS = [
  {
    id: "abc-123",
    title: "Phase III Diabetes Study",
    protocolNumber: "DIAB-2024-001",
    description:
      "A randomized, double-blind, placebo-controlled study evaluating the efficacy and safety of a novel diabetes medication in adults with type 2 diabetes.",
    phase: "Phase III",
    status: "active",
    sponsor: "Novo Nordisk",
    location: "Copenhagen, Denmark",
    enrolledPatients: 12,
    targetPatients: 50,
    completionPercentage: 24,
  },
  {
    id: "def-456",
    title: "Oncology Trial",
    protocolNumber: "ONC-2024-002",
    description:
      "Phase II clinical trial investigating a targeted therapy for advanced non-small cell lung cancer patients with specific biomarkers.",
    phase: "Phase II",
    status: "recruiting",
    sponsor: "Roche",
    location: "Basel, Switzerland",
    enrolledPatients: 8,
    targetPatients: 30,
    completionPercentage: 27,
  },
  {
    id: "ghi-789",
    title: "Cardiovascular Study",
    protocolNumber: "CARDIO-2024-003",
    description:
      "Multi-center study assessing the long-term cardiovascular outcomes of a novel anticoagulant in patients with atrial fibrillation.",
    phase: "Phase III",
    status: "active",
    sponsor: "Pfizer",
    location: "Amsterdam, Netherlands",
    enrolledPatients: 25,
    targetPatients: 100,
    completionPercentage: 25,
  },
  {
    id: "jkl-012",
    title: "Neurology Research",
    protocolNumber: "NEURO-2024-004",
    description:
      "First-in-human study evaluating the safety, tolerability, and pharmacokinetics of an investigational drug for Alzheimer’s disease.",
    phase: "Phase I",
    status: "recruiting",
    sponsor: "Biogen",
    location: "Berlin, Germany",
    enrolledPatients: 3,
    targetPatients: 15,
    completionPercentage: 20,
  },
  {
    id: "mno-345",
    title: "Respiratory Trial",
    protocolNumber: "RESP-2024-005",
    description:
      "Phase II trial investigating a novel inhaled therapy for patients with chronic obstructive pulmonary disease (COPD).",
    phase: "Phase II",
    status: "active",
    sponsor: "AstraZeneca",
    location: "Cambridge, UK",
    enrolledPatients: 18,
    targetPatients: 60,
    completionPercentage: 30,
  },
  {
    id: "pqr-678",
    title: "Immunology Study",
    protocolNumber: "IMMUNO-2024-006",
    description:
      "Large-scale study evaluating a biologic therapy for moderate to severe rheumatoid arthritis in adult patients.",
    phase: "Phase III",
    status: "active",
    sponsor: "Johnson & Johnson",
    location: "Brussels, Belgium",
    enrolledPatients: 45,
    targetPatients: 120,
    completionPercentage: 38,
  },
  {
    id: "stu-901",
    title: "Dermatology Research",
    protocolNumber: "DERM-2024-007",
    description:
      "Phase II study investigating a topical treatment for moderate to severe atopic dermatitis in adolescents and adults.",
    phase: "Phase II",
    status: "recruiting",
    sponsor: "Galderma",
    location: "Lausanne, Switzerland",
    enrolledPatients: 6,
    targetPatients: 25,
    completionPercentage: 24,
  },
  {
    id: "vwx-234",
    title: "Gastroenterology Trial",
    protocolNumber: "GASTRO-2024-008",
    description:
      "Phase III trial evaluating a novel treatment for inflammatory bowel disease (IBD) in patients with inadequate response to standard therapies.",
    phase: "Phase III",
    status: "on-hold",
    sponsor: "Takeda",
    location: "Vienna, Austria",
    enrolledPatients: 32,
    targetPatients: 80,
    completionPercentage: 40,
  },
];

const FULL_TRIALS = [
  ...SAMPLE_TRIALS,
  {
    id: "yza-567",
    title: "Trial YZA-567",
    phase: "Phase II",
    status: "active",
    sponsor: "Merck",
    enrolledPatients: 15,
    targetPatients: 45,
    completionPercentage: 33,
  },
  {
    id: "bcd-890",
    title: "Trial BCD-890",
    phase: "Phase III",
    status: "recruiting",
    sponsor: "Sanofi",
    enrolledPatients: 22,
    targetPatients: 75,
    completionPercentage: 29,
  },
  {
    id: "efg-123",
    title: "Trial EFG-123",
    phase: "Phase I",
    status: "active",
    sponsor: "Gilead",
    enrolledPatients: 5,
    targetPatients: 20,
    completionPercentage: 25,
  },
  {
    id: "hij-456",
    title: "Trial HIJ-456",
    phase: "Phase II",
    status: "recruiting",
    sponsor: "Amgen",
    enrolledPatients: 18,
    targetPatients: 55,
    completionPercentage: 33,
  },
  {
    id: "klm-789",
    title: "Trial KLM-789",
    phase: "Phase III",
    status: "active",
    sponsor: "Bristol Myers",
    enrolledPatients: 40,
    targetPatients: 110,
    completionPercentage: 36,
  },
  {
    id: "nop-012",
    title: "Trial NOP-012",
    phase: "Phase II",
    status: "recruiting",
    sponsor: "Eli Lilly",
    enrolledPatients: 12,
    targetPatients: 40,
    completionPercentage: 30,
  },
  {
    id: "qrs-345",
    title: "Trial QRS-345",
    phase: "Phase I",
    status: "active",
    sponsor: "Regeneron",
    enrolledPatients: 7,
    targetPatients: 25,
    completionPercentage: 28,
  },
  {
    id: "tuv-678",
    title: "Trial TUV-678",
    phase: "Phase III",
    status: "recruiting",
    sponsor: "Vertex",
    enrolledPatients: 35,
    targetPatients: 95,
    completionPercentage: 37,
  },
  {
    id: "wxy-901",
    title: "Trial WXY-901",
    phase: "Phase II",
    status: "active",
    sponsor: "Moderna",
    enrolledPatients: 20,
    targetPatients: 60,
    completionPercentage: 33,
  },
  {
    id: "zab-234",
    title: "Trial ZAB-234",
    phase: "Phase III",
    status: "recruiting",
    sponsor: "BioNTech",
    enrolledPatients: 28,
    targetPatients: 85,
    completionPercentage: 33,
  },
  {
    id: "cde-567",
    title: "Trial CDE-567",
    phase: "Phase I",
    status: "active",
    sponsor: "Incyte",
    enrolledPatients: 4,
    targetPatients: 15,
    completionPercentage: 27,
  },
  {
    id: "fgh-890",
    title: "Trial FGH-890",
    phase: "Phase II",
    status: "recruiting",
    sponsor: "Biogen",
    enrolledPatients: 16,
    targetPatients: 50,
    completionPercentage: 32,
  },
  {
    id: "ijk-123",
    title: "Trial IJK-123",
    phase: "Phase III",
    status: "active",
    sponsor: "Alexion",
    enrolledPatients: 42,
    targetPatients: 115,
    completionPercentage: 37,
  },
  {
    id: "lmn-456",
    title: "Trial LMN-456",
    phase: "Phase II",
    status: "recruiting",
    sponsor: "Celgene",
    enrolledPatients: 14,
    targetPatients: 45,
    completionPercentage: 31,
  },
  {
    id: "opq-789",
    title: "Trial OPQ-789",
    phase: "Phase I",
    status: "active",
    sponsor: "Genentech",
    enrolledPatients: 6,
    targetPatients: 20,
    completionPercentage: 30,
  },
  {
    id: "rst-012",
    title: "Trial RST-012",
    phase: "Phase III",
    status: "recruiting",
    sponsor: "Abbvie",
    enrolledPatients: 38,
    targetPatients: 100,
    completionPercentage: 38,
  },
  {
    id: "uvw-345",
    title: "Trial UVW-345",
    phase: "Phase II",
    status: "active",
    sponsor: "Novartis",
    enrolledPatients: 19,
    targetPatients: 55,
    completionPercentage: 35,
  },
  {
    id: "xyz-678",
    title: "Trial XYZ-678",
    phase: "Phase I",
    status: "recruiting",
    sponsor: "GSK",
    enrolledPatients: 8,
    targetPatients: 25,
    completionPercentage: 32,
  },
  {
    id: "abc-901",
    title: "Trial ABC-901",
    phase: "Phase III",
    status: "active",
    sponsor: "Bayer",
    enrolledPatients: 45,
    targetPatients: 120,
    completionPercentage: 38,
  },
];

async function wipeModeData(mode: DemoMode | "all") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    const trialRows = mode === "all"
      ? await tx.select({ id: trials.id }).from(trials)
      : await tx
          .select({ id: trials.id })
          .from(trials)
          .where(like(trials.id, `${mode}:%`));

    const trialIds = trialRows.map((row) => row.id);
    if (trialIds.length === 0) return;

    const protocolRows = await tx
      .select({ id: protocols.id })
      .from(protocols)
      .where(inArray(protocols.trialId, trialIds));
    const protocolIds = protocolRows.map((row) => row.id);

    const scaffoldRows = await tx
      .select({ id: taskScaffolds.id })
      .from(taskScaffolds)
      .where(inArray(taskScaffolds.trialId, trialIds));
    const scaffoldIds = scaffoldRows.map((row) => row.id);

    const phaseRows = scaffoldIds.length > 0
      ? await tx
          .select({ id: phases.id })
          .from(phases)
          .where(inArray(phases.scaffoldId, scaffoldIds))
      : [];
    const phaseIds = phaseRows.map((row) => row.id);

    const taskRows = phaseIds.length > 0
      ? await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(inArray(tasks.phaseId, phaseIds))
      : [];
    const taskIds = taskRows.map((row) => row.id);

    const storeRows = await tx
      .select({ id: fileSearchStores.id })
      .from(fileSearchStores)
      .where(inArray(fileSearchStores.trialId, trialIds));
    const storeIds = storeRows.map((row) => row.id);

    if (taskIds.length > 0) {
      await tx
        .delete(taskDependencies)
        .where(
          or(
            inArray(taskDependencies.taskId, taskIds),
            inArray(taskDependencies.dependsOnTaskId, taskIds)
          )
        );
    }

    if (phaseIds.length > 0) {
      await tx
        .delete(tasks)
        .where(inArray(tasks.phaseId, phaseIds));
      await tx
        .delete(phaseTransitions)
        .where(
          or(
            inArray(phaseTransitions.fromPhaseId, phaseIds),
            inArray(phaseTransitions.toPhaseId, phaseIds)
          )
        );
      await tx
        .delete(phases)
        .where(inArray(phases.scaffoldId, scaffoldIds));
    }

    if (scaffoldIds.length > 0) {
      await tx
        .delete(taskScaffolds)
        .where(inArray(taskScaffolds.id, scaffoldIds));
    }

    if (protocolIds.length > 0) {
      await tx
        .delete(protocolSections)
        .where(inArray(protocolSections.protocolId, protocolIds));
      await tx
        .delete(fileSearchDocuments)
        .where(inArray(fileSearchDocuments.protocolId, protocolIds));
    }

    if (storeIds.length > 0) {
      await tx
        .delete(fileSearchDocuments)
        .where(inArray(fileSearchDocuments.storeId, storeIds));
      await tx
        .delete(fileSearchStores)
        .where(inArray(fileSearchStores.id, storeIds));
    }

    if (protocolIds.length > 0) {
      await tx
        .delete(protocols)
        .where(inArray(protocols.id, protocolIds));
    }

    await tx.delete(trials).where(inArray(trials.id, trialIds));
  });
}

async function seedCategories() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(documentCategories).values(
    DEFAULT_CATEGORIES.map((name) => ({
      name,
      isDefault: true,
    }))
  ).onDuplicateKeyUpdate({
    set: {
      name: documentCategories.name,
    },
  });
}

async function seedTrials(
  data: typeof SAMPLE_TRIALS,
  createdBy: number,
  mode: DemoMode
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(trials).values(
    data.map((trial) => ({
      ...trial,
      id: toDemoId(mode, trial.id),
      createdBy,
    }))
  );
}

export const demoRouter = router({
  resetToEmpty: protectedProcedure.mutation(async () => {
    await wipeModeData("building");
    return { ok: true };
  }),

  loadSampleData: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const existing = await db
      .select({ id: trials.id })
      .from(trials)
      .where(like(trials.id, "sample:%"))
      .limit(1);
    if (existing.length === 0) {
      await seedCategories();
      await seedTrials(SAMPLE_TRIALS, ctx.user.id, "sample");
    }
    return { ok: true, mode: "sample" as const };
  }),

  loadFullDataset: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const existing = await db
      .select({ id: trials.id })
      .from(trials)
      .where(like(trials.id, "full:%"))
      .limit(1);
    if (existing.length === 0) {
      await seedCategories();
      await seedTrials(FULL_TRIALS, ctx.user.id, "full");
    }
    return { ok: true, mode: "full" as const };
  }),

  fullReset: protectedProcedure.mutation(async ({ ctx }) => {
    await wipeModeData("all");
    await seedCategories();
    await seedTrials(SAMPLE_TRIALS, ctx.user.id, "sample");
    await seedTrials(FULL_TRIALS, ctx.user.id, "full");
    return { ok: true };
  }),
});
