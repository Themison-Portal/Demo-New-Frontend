import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { randomUUID } from "crypto";
import {
  aiAnalyticsRollups,
  aiFeatureSnapshots,
  aiTrainingExamples,
  collabTelemetryEvents,
  conversationParticipants,
  conversations,
  crossReferences,
  documentCategories,
  emailChains,
  executionMaps,
  fileSearchDocuments,
  fileSearchStores,
  mapPhaseTransitions,
  mapPhases,
  mapTaskDependencies,
  mapTaskStatusHistory,
  mapTasks,
  mapTelemetryEvents,
  messages,
  knowledgeGraphEdges,
  knowledgeGraphNodes,
  phaseTransitions,
  phases,
  protocolMapSections,
  protocolChunks,
  protocolSections,
  protocols,
  taskDependencies,
  taskScaffolds,
  tasks,
  threadAnchors,
  threadParticipants,
  threads,
  trialInboxes,
} from "../drizzle/schema";
import { toDemoId, type DemoMode } from "./_core/demoMode";
import { callBackend } from "./_core/backendClient";
import { eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";

// FE UI statuses -> BE CHECK (planning|active|completed|paused|cancelled).
// Mirrors scripts/backfill-trials-to-be.ts so demo-seeded BE trials match.
const FE_TO_BE_STATUS: Record<string, string> = {
  "not-started": "planning",
  recruiting: "active",
  "on-hold": "paused",
  terminated: "cancelled",
};
function beStatus(s: string | null | undefined): string {
  if (!s) return "planning";
  return FE_TO_BE_STATUS[s] ?? s;
}

function toBeIso(v: unknown): string | null {
  if (!v) return null;
  try {
    return new Date(v as any).toISOString();
  } catch {
    return null;
  }
}

// Map a seeded FE trial onto the BE `/api/trials` body. `demoMode` tags the
// trial as demo-owned so the BE-sourced trial list surfaces it. The BE assigns
// the trial UUID. Field mapping matches the backfill script.
function feTrialToBeBody(t: any, demoMode: DemoMode) {
  return {
    demo_mode: demoMode,
    name: t.title || "Untitled Trial",
    phase: t.phase || "Phase I",
    location: t.location || "",
    sponsor: t.sponsor || "",
    status: beStatus(t.status),
    description: t.description ?? null,
    indication: t.indication ?? null,
    study_start: toBeIso(t.startDate),
    estimated_close_out: toBeIso(t.endDate),
    protocol_number: t.protocolNumber ?? null,
    investigational_product: t.investigationalProduct ?? null,
    nct_number: t.nctNumber ?? null,
    current_version: t.currentVersion ?? null,
    amendment_version: t.amendmentVersion ?? null,
    release_date: t.releaseDate ?? null,
    sample_size: t.sampleSize ?? null,
    number_of_sites: t.numberOfSites ?? null,
    study_duration: t.studyDuration ?? null,
    study_design_type: t.studyDesignType ?? null,
    primary_objective: t.primaryObjective ?? null,
    primary_endpoint: t.primaryEndpoint ?? null,
    principal_investigator: t.principalInvestigator ?? null,
    enrolled_patients: t.enrolledPatients ?? null,
    target_patients: t.targetPatients ?? null,
    completion_percentage: t.completionPercentage ?? null,
  };
}

// BE is now the source of truth for trials. List the demo-owned trials for a
// mode (or every demo-owned trial when `mode === "all"`). The returned `id` is
// the BE UUID — the key every FE child table is now re-keyed by (Phase D).
async function listBeTrials(mode: DemoMode | "all"): Promise<any[]> {
  if (mode === "all") {
    const all = await callBackend<any[]>(`/api/trials`).catch(() => []);
    return (all ?? []).filter(
      (t) => t?.demo_mode === "sample" || t?.demo_mode === "full" || t?.demo_mode === "building"
    );
  }
  const list = await callBackend<any[]>(`/api/trials`, {
    query: { demo_mode: mode },
  }).catch(() => []);
  // Defend against a BE that ignores the demo_mode filter.
  return (list ?? []).filter((t) => t?.demo_mode === mode);
}

// Child tables whose `trialId` column carries the (now BE-UUID) trial key.
// Mirrors scripts/rekey-child-trialid.sql. `protocols` is intentionally
// excluded (document logic retired). Used by both the re-key (seed) and the
// BE-UUID-scoped clear (wipe) paths. `trialId` is an untyped string column on
// each of these, so these are traced manually rather than type-checked.
const TRIAL_KEYED_CHILD_TABLES = [
  taskScaffolds,
  executionMaps,
  mapTelemetryEvents,
  mapTaskStatusHistory,
  protocolChunks,
  fileSearchStores,
  aiFeatureSnapshots,
  aiAnalyticsRollups,
  aiTrainingExamples,
  knowledgeGraphNodes,
  knowledgeGraphEdges,
  conversations,
  threads,
  trialInboxes,
  collabTelemetryEvents,
] as const;

// For each seeded trial, create a BE trial and return a Map<prefixedId, beUuid>
// for re-keying the just-seeded child data. Trials are UUID-identified (slugs
// are gone), so the BE assigns the UUID on POST. This always runs after the
// target mode has been wiped (resetModeToDefault → wipeModeData), so creating
// fresh rows cannot accumulate duplicates.
async function ensureBeTrialsForSeed(
  _db: DbClient,
  data: typeof SAMPLE_TRIALS,
  mode: DemoMode
): Promise<Map<string, string>> {
  const beUuidByPrefixed = new Map<string, string>();
  if (data.length === 0) return beUuidByPrefixed;

  for (const trial of data) {
    const prefixedId = toDemoId(mode, trial.id);
    const body = feTrialToBeBody(trial, mode);
    try {
      const beTrial: any = await callBackend(`/api/trials/with-assignments`, {
        method: "POST",
        body: { ...body, members: [], pending_members: [] },
      });
      if (beTrial?.id) beUuidByPrefixed.set(prefixedId, beTrial.id);
    } catch (error) {
      console.warn(
        `[demo] Failed to create BE trial for ${prefixedId}; child data stays keyed by the prefixed id.`,
        error
      );
    }
  }

  return beUuidByPrefixed;
}

// Re-key just-seeded child rows from the prefixed FE id to the BE UUID across
// every trial-keyed child table. Scoped to the seeded trials only; skips any
// trial that has no resolved BE UUID (its child rows stay prefixed). Mirrors
// scripts/rekey-child-trialid.sql in code.
async function rekeySeededChildData(
  db: DbClient,
  beUuidByPrefixed: Map<string, string>
) {
  for (const [prefixedId, beUuid] of Array.from(beUuidByPrefixed.entries())) {
    if (!beUuid || beUuid === prefixedId) continue;
    for (const table of TRIAL_KEYED_CHILD_TABLES) {
      try {
        await db
          .update(table as never)
          .set({ trialId: beUuid } as never)
          .where(eq((table as any).trialId, prefixedId));
      } catch (error) {
        console.warn(
          `[demo] Re-key skipped for a child table (${prefixedId} -> ${beUuid}) due to schema compatibility issue.`,
          error
        );
      }
    }
  }
}

// Delete BE-UUID-keyed child rows for the given prefixed trials. Prior seeds
// left child rows keyed by the BE UUID, so the prefixed-id deletes in
// wipeModeData would miss them and duplicate on re-seed. Resolve the BE UUIDs
// and delete every trial-keyed child table by them.
async function clearBeKeyedChildData(
  tx: DbTransaction,
  beUuids: string[]
) {
  if (beUuids.length === 0) return;
  for (const table of TRIAL_KEYED_CHILD_TABLES) {
    try {
      await tx
        .delete(table as never)
        .where(inArray((table as any).trialId, beUuids));
    } catch (error) {
      console.warn(
        "[demo] BE-UUID-keyed child clear skipped for a table due to schema compatibility issue.",
        error
      );
    }
  }
}

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

type TrialSeed = {
  id: string;
  title: string;
  protocolNumber?: string;
  description?: string;
  phase?: string;
  status: "not-started" | "active" | "recruiting" | "on-hold" | "completed" | "terminated";
  sponsor?: string;
  location?: string;
  enrolledPatients?: number;
  targetPatients?: number;
  completionPercentage?: number;
  investigationalProduct?: string;
  indication?: string;
  nctNumber?: string;
  currentVersion?: string;
  amendmentVersion?: string;
  releaseDate?: string;
  sampleSize?: string;
  numberOfSites?: string;
  studyDuration?: string;
  studyDesignType?: string;
  primaryObjective?: string;
  primaryEndpoint?: string;
  startDate?: Date;
  endDate?: Date;
};

const SAMPLE_TRIALS_BASE: TrialSeed[] = [
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
    enrolledPatients: 120,
    targetPatients: 150,
    completionPercentage: 80,
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

const SAMPLE_TRIAL_DETAILS: Record<string, Partial<TrialSeed>> = {
  "abc-123": {
    investigationalProduct: "Semaglutide XR (NN-045)",
    indication: "Type 2 Diabetes Mellitus",
    nctNumber: "NCT05841230",
    currentVersion: "3.1",
    amendmentVersion: "2.0",
    releaseDate: "2025-09-12",
    sampleSize: "480",
    numberOfSites: "65",
    studyDuration: "72 weeks",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess efficacy of Semaglutide XR on HbA1c reduction at Week 36.",
    primaryEndpoint: "Change from baseline in HbA1c at Week 36.",
    startDate: new Date("2025-10-01"),
    endDate: new Date("2027-03-15"),
  },
  "def-456": {
    investigationalProduct: "Roche R-137 (TKI)",
    indication: "Advanced NSCLC with EGFR mutation",
    nctNumber: "NCT05851201",
    currentVersion: "2.0",
    amendmentVersion: "1.0",
    releaseDate: "2025-06-18",
    sampleSize: "180",
    numberOfSites: "40",
    studyDuration: "36 months",
    studyDesignType: "Open-label, multicenter, single-arm",
    primaryObjective: "Evaluate objective response rate in EGFR+ NSCLC.",
    primaryEndpoint: "Objective response rate (RECIST 1.1).",
    startDate: new Date("2025-07-10"),
    endDate: new Date("2028-01-20"),
  },
  "ghi-789": {
    status: "not-started",
    investigationalProduct: "Apixaban-LX",
    indication: "Atrial Fibrillation",
    nctNumber: "NCT05799174",
    currentVersion: "4.0",
    amendmentVersion: "2.0",
    releaseDate: "2025-04-02",
    sampleSize: "1200",
    numberOfSites: "110",
    studyDuration: "5 years",
    studyDesignType: "Randomized, event-driven, parallel-group",
    primaryObjective: "Compare stroke/systemic embolism prevention.",
    primaryEndpoint: "Time to first stroke or systemic embolism.",
    enrolledPatients: 0,
    completionPercentage: 0,
    startDate: new Date("2025-05-01"),
    endDate: new Date("2030-05-01"),
  },
  "jkl-012": {
    status: "completed",
    investigationalProduct: "B-112",
    indication: "Early Alzheimer’s Disease",
    nctNumber: "NCT05814422",
    currentVersion: "1.2",
    amendmentVersion: "0.3",
    releaseDate: "2025-11-05",
    sampleSize: "60",
    numberOfSites: "12",
    studyDuration: "18 months",
    studyDesignType: "First-in-human, dose-escalation",
    primaryObjective: "Assess safety and tolerability of B-112.",
    primaryEndpoint: "Incidence of treatment-emergent adverse events.",
    enrolledPatients: 15,
    completionPercentage: 100,
    startDate: new Date("2025-12-01"),
    endDate: new Date("2027-06-01"),
  },
  "mno-345": {
    investigationalProduct: "AZD-Respira",
    indication: "Moderate to severe COPD",
    nctNumber: "NCT05877812",
    currentVersion: "2.3",
    amendmentVersion: "1.1",
    releaseDate: "2025-08-22",
    sampleSize: "320",
    numberOfSites: "55",
    studyDuration: "52 weeks",
    studyDesignType: "Randomized, double-blind, active-controlled",
    primaryObjective: "Evaluate lung function improvement (FEV1).",
    primaryEndpoint: "Change from baseline in trough FEV1 at Week 24.",
    startDate: new Date("2025-09-15"),
    endDate: new Date("2027-02-01"),
  },
  "pqr-678": {
    status: "terminated",
    investigationalProduct: "J&J-RA1",
    indication: "Rheumatoid Arthritis",
    nctNumber: "NCT05899544",
    currentVersion: "5.0",
    amendmentVersion: "2.2",
    releaseDate: "2025-03-10",
    sampleSize: "950",
    numberOfSites: "130",
    studyDuration: "3 years",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Demonstrate improvement in ACR20 at Week 24.",
    primaryEndpoint: "Proportion of patients achieving ACR20 at Week 24.",
    completionPercentage: 54,
    startDate: new Date("2025-04-01"),
    endDate: new Date("2028-04-01"),
  },
  "stu-901": {
    status: "on-hold",
    investigationalProduct: "GAL-Topica",
    indication: "Atopic Dermatitis",
    nctNumber: "NCT05911203",
    currentVersion: "1.9",
    amendmentVersion: "0.8",
    releaseDate: "2025-07-01",
    sampleSize: "150",
    numberOfSites: "28",
    studyDuration: "28 weeks",
    studyDesignType: "Randomized, double-blind, vehicle-controlled",
    primaryObjective: "Assess improvement in EASI score.",
    primaryEndpoint: "Change in EASI score at Week 16.",
    startDate: new Date("2025-08-01"),
    endDate: new Date("2026-12-01"),
  },
  "vwx-234": {
    investigationalProduct: "TAK-IBD",
    indication: "Inflammatory Bowel Disease",
    nctNumber: "NCT05866721",
    currentVersion: "3.4",
    amendmentVersion: "1.5",
    releaseDate: "2025-02-12",
    sampleSize: "540",
    numberOfSites: "90",
    studyDuration: "30 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess clinical remission at Week 12.",
    primaryEndpoint: "Proportion achieving clinical remission at Week 12.",
    startDate: new Date("2025-03-01"),
    endDate: new Date("2027-09-01"),
  },
};

const SAMPLE_TRIALS = SAMPLE_TRIALS_BASE.map((trial) => ({
  ...trial,
  ...SAMPLE_TRIAL_DETAILS[trial.id],
}));

const FULL_TRIALS_BASE: TrialSeed[] = [
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

const FULL_TRIAL_DETAILS: Record<string, Partial<(typeof FULL_TRIALS_BASE)[number]>> = {
  "yza-567": {
    investigationalProduct: "MK-771",
    indication: "Metastatic Melanoma",
    nctNumber: "NCT05920011",
    currentVersion: "1.0",
    amendmentVersion: "0.1",
    releaseDate: "2025-10-05",
    sampleSize: "220",
    numberOfSites: "35",
    studyDuration: "24 months",
    studyDesignType: "Randomized, open-label, active-controlled",
    primaryObjective: "Compare progression-free survival.",
    primaryEndpoint: "Progression-free survival (RECIST 1.1).",
    startDate: new Date("2025-11-01"),
    endDate: new Date("2027-11-01"),
  },
  "bcd-890": {
    status: "on-hold",
    investigationalProduct: "San-201",
    indication: "Chronic Rhinosinusitis",
    nctNumber: "NCT05921044",
    currentVersion: "2.1",
    amendmentVersion: "1.0",
    releaseDate: "2025-05-19",
    sampleSize: "300",
    numberOfSites: "42",
    studyDuration: "18 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Evaluate symptom score reduction.",
    primaryEndpoint: "Change in SNOT-22 score at Week 24.",
    completionPercentage: 41,
    startDate: new Date("2025-06-15"),
    endDate: new Date("2027-01-15"),
  },
  "efg-123": {
    investigationalProduct: "GIL-510",
    indication: "Chronic Hepatitis B",
    nctNumber: "NCT05922018",
    currentVersion: "1.5",
    amendmentVersion: "0.2",
    releaseDate: "2025-08-08",
    sampleSize: "90",
    numberOfSites: "15",
    studyDuration: "12 months",
    studyDesignType: "Dose-escalation, open-label",
    primaryObjective: "Assess safety and antiviral activity.",
    primaryEndpoint: "Change in HBV DNA at Week 12.",
    startDate: new Date("2025-09-01"),
    endDate: new Date("2026-09-01"),
  },
  "hij-456": {
    investigationalProduct: "AMG-349",
    indication: "Severe Asthma",
    nctNumber: "NCT05923055",
    currentVersion: "2.4",
    amendmentVersion: "1.2",
    releaseDate: "2025-04-25",
    sampleSize: "260",
    numberOfSites: "48",
    studyDuration: "20 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Evaluate reduction in exacerbations.",
    primaryEndpoint: "Annualized rate of asthma exacerbations.",
    startDate: new Date("2025-05-20"),
    endDate: new Date("2027-01-20"),
  },
  "klm-789": {
    investigationalProduct: "BMS-902",
    indication: "Systemic Lupus Erythematosus",
    nctNumber: "NCT05924077",
    currentVersion: "3.0",
    amendmentVersion: "1.1",
    releaseDate: "2025-02-02",
    sampleSize: "400",
    numberOfSites: "60",
    studyDuration: "30 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess SRI-4 response at Week 52.",
    primaryEndpoint: "SRI-4 response rate at Week 52.",
    startDate: new Date("2025-03-01"),
    endDate: new Date("2027-09-01"),
  },
  "nop-012": {
    investigationalProduct: "LLY-321",
    indication: "Type 2 Diabetes Mellitus",
    nctNumber: "NCT05925010",
    currentVersion: "2.2",
    amendmentVersion: "0.9",
    releaseDate: "2025-07-14",
    sampleSize: "210",
    numberOfSites: "33",
    studyDuration: "18 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Evaluate HbA1c reduction at Week 26.",
    primaryEndpoint: "Change from baseline in HbA1c at Week 26.",
    startDate: new Date("2025-08-01"),
    endDate: new Date("2027-02-01"),
  },
  "qrs-345": {
    investigationalProduct: "REG-88",
    indication: "Atopic Dermatitis",
    nctNumber: "NCT05926088",
    currentVersion: "1.3",
    amendmentVersion: "0.4",
    releaseDate: "2025-09-03",
    sampleSize: "140",
    numberOfSites: "20",
    studyDuration: "16 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess pruritus reduction.",
    primaryEndpoint: "Change in itch NRS at Week 16.",
    startDate: new Date("2025-10-01"),
    endDate: new Date("2027-02-01"),
  },
  "tuv-678": {
    investigationalProduct: "VRTX-210",
    indication: "Cystic Fibrosis",
    nctNumber: "NCT05927012",
    currentVersion: "4.1",
    amendmentVersion: "2.0",
    releaseDate: "2025-01-20",
    sampleSize: "360",
    numberOfSites: "58",
    studyDuration: "24 months",
    studyDesignType: "Randomized, double-blind, active-controlled",
    primaryObjective: "Assess ppFEV1 improvement at Week 24.",
    primaryEndpoint: "Change in ppFEV1 at Week 24.",
    startDate: new Date("2025-02-15"),
    endDate: new Date("2027-02-15"),
  },
  "wxy-901": {
    investigationalProduct: "mRNA-4157",
    indication: "Seasonal Influenza",
    nctNumber: "NCT05928066",
    currentVersion: "2.0",
    amendmentVersion: "0.6",
    releaseDate: "2025-08-30",
    sampleSize: "500",
    numberOfSites: "70",
    studyDuration: "12 months",
    studyDesignType: "Randomized, observer-blind, active-controlled",
    primaryObjective: "Assess immunogenicity vs. standard vaccine.",
    primaryEndpoint: "Geometric mean titer at Day 28.",
    startDate: new Date("2025-09-15"),
    endDate: new Date("2026-09-15"),
  },
  "zab-234": {
    status: "on-hold",
    investigationalProduct: "BNT-349",
    indication: "HPV-Associated Cancer",
    nctNumber: "NCT05929021",
    currentVersion: "1.8",
    amendmentVersion: "0.7",
    releaseDate: "2025-06-02",
    sampleSize: "240",
    numberOfSites: "32",
    studyDuration: "22 months",
    studyDesignType: "Randomized, open-label, active-controlled",
    primaryObjective: "Evaluate overall response rate.",
    primaryEndpoint: "Overall response rate (RECIST 1.1).",
    completionPercentage: 47,
    startDate: new Date("2025-07-01"),
    endDate: new Date("2027-05-01"),
  },
  "cde-567": {
    investigationalProduct: "INC-144",
    indication: "Myelofibrosis",
    nctNumber: "NCT05930044",
    currentVersion: "2.6",
    amendmentVersion: "1.3",
    releaseDate: "2025-03-12",
    sampleSize: "160",
    numberOfSites: "22",
    studyDuration: "20 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess spleen volume reduction.",
    primaryEndpoint: "Proportion with ≥35% spleen volume reduction.",
    startDate: new Date("2025-04-10"),
    endDate: new Date("2027-01-10"),
  },
  "fgh-890": {
    status: "completed",
    investigationalProduct: "BIO-212",
    indication: "Multiple Sclerosis",
    nctNumber: "NCT05931091",
    currentVersion: "3.3",
    amendmentVersion: "1.4",
    releaseDate: "2025-05-04",
    sampleSize: "280",
    numberOfSites: "45",
    studyDuration: "24 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess ARR reduction.",
    primaryEndpoint: "Annualized relapse rate at Week 48.",
    enrolledPatients: 50,
    completionPercentage: 100,
    startDate: new Date("2025-06-01"),
    endDate: new Date("2027-06-01"),
  },
  "ijk-123": {
    investigationalProduct: "ALX-011",
    indication: "Paroxysmal Nocturnal Hemoglobinuria",
    nctNumber: "NCT05932033",
    currentVersion: "2.9",
    amendmentVersion: "1.1",
    releaseDate: "2025-02-28",
    sampleSize: "120",
    numberOfSites: "18",
    studyDuration: "18 months",
    studyDesignType: "Randomized, open-label, active-controlled",
    primaryObjective: "Evaluate hemolysis control vs. SOC.",
    primaryEndpoint: "Change in LDH at Week 26.",
    startDate: new Date("2025-03-20"),
    endDate: new Date("2026-09-20"),
  },
  "lmn-456": {
    investigationalProduct: "CEL-009",
    indication: "Ulcerative Colitis",
    nctNumber: "NCT05933077",
    currentVersion: "2.0",
    amendmentVersion: "0.5",
    releaseDate: "2025-07-22",
    sampleSize: "260",
    numberOfSites: "36",
    studyDuration: "20 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess clinical remission at Week 10.",
    primaryEndpoint: "Clinical remission at Week 10 (Mayo score).",
    startDate: new Date("2025-08-15"),
    endDate: new Date("2027-04-15"),
  },
  "opq-789": {
    status: "not-started",
    investigationalProduct: "GEN-778",
    indication: "HER2+ Breast Cancer",
    nctNumber: "NCT05934012",
    currentVersion: "1.7",
    amendmentVersion: "0.8",
    releaseDate: "2025-09-18",
    sampleSize: "190",
    numberOfSites: "30",
    studyDuration: "24 months",
    studyDesignType: "Randomized, open-label, active-controlled",
    primaryObjective: "Assess pathologic complete response.",
    primaryEndpoint: "pCR rate at surgery.",
    enrolledPatients: 0,
    completionPercentage: 0,
    startDate: new Date("2025-10-10"),
    endDate: new Date("2027-10-10"),
  },
  "rst-012": {
    status: "completed",
    investigationalProduct: "ABB-401",
    indication: "Psoriasis",
    nctNumber: "NCT05935022",
    currentVersion: "3.5",
    amendmentVersion: "1.9",
    releaseDate: "2025-01-05",
    sampleSize: "420",
    numberOfSites: "68",
    studyDuration: "30 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Evaluate PASI 75 response at Week 16.",
    primaryEndpoint: "PASI 75 response at Week 16.",
    enrolledPatients: 100,
    completionPercentage: 100,
    startDate: new Date("2025-02-01"),
    endDate: new Date("2027-08-01"),
  },
  "uvw-345": {
    investigationalProduct: "NOV-311",
    indication: "Chronic Heart Failure",
    nctNumber: "NCT05936077",
    currentVersion: "2.2",
    amendmentVersion: "0.7",
    releaseDate: "2025-04-11",
    sampleSize: "350",
    numberOfSites: "50",
    studyDuration: "28 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess reduction in CV death or HF hospitalization.",
    primaryEndpoint: "Time to CV death or HF hospitalization.",
    startDate: new Date("2025-05-10"),
    endDate: new Date("2027-09-10"),
  },
  "xyz-678": {
    status: "terminated",
    investigationalProduct: "GSK-555",
    indication: "Seasonal Allergic Rhinitis",
    nctNumber: "NCT05937009",
    currentVersion: "1.4",
    amendmentVersion: "0.4",
    releaseDate: "2025-08-02",
    sampleSize: "160",
    numberOfSites: "22",
    studyDuration: "12 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Assess symptom score reduction.",
    primaryEndpoint: "Change in TNSS at Week 4.",
    completionPercentage: 36,
    startDate: new Date("2025-09-01"),
    endDate: new Date("2026-09-01"),
  },
  "abc-901": {
    investigationalProduct: "BAY-904",
    indication: "Prostate Cancer",
    nctNumber: "NCT05938055",
    currentVersion: "4.0",
    amendmentVersion: "2.1",
    releaseDate: "2025-03-25",
    sampleSize: "500",
    numberOfSites: "80",
    studyDuration: "36 months",
    studyDesignType: "Randomized, double-blind, placebo-controlled",
    primaryObjective: "Evaluate overall survival benefit.",
    primaryEndpoint: "Overall survival.",
    startDate: new Date("2025-04-20"),
    endDate: new Date("2028-04-20"),
  },
};

const FULL_TRIALS = FULL_TRIALS_BASE.map((trial) => ({
  ...trial,
  ...FULL_TRIAL_DETAILS[trial.id],
}));

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

const DEMO_MODE_VALUES = ["sample", "full", "building"] as const;
const demoModeSchema = z.enum(DEMO_MODE_VALUES);
const modeLoadInputSchema = z.object({ resetToDefault: z.boolean().optional() }).optional();

const SNAPSHOT_ROW_KEYS = [
  "trials",
  "protocols",
  "protocolSections",
  "protocolChunks",
  "fileSearchStores",
  "fileSearchDocuments",
  "taskScaffolds",
  "phases",
  "tasks",
  "taskDependencies",
  "phaseTransitions",
  "executionMaps",
  "mapPhases",
  "mapTasks",
  "mapTaskDependencies",
  "mapPhaseTransitions",
  "protocolMapSections",
  "mapTelemetryEvents",
  "mapTaskStatusHistory",
  "conversations",
  "conversationParticipants",
  "threads",
  "threadAnchors",
  "threadParticipants",
  "trialInboxes",
  "emailChains",
  "messages",
  "crossReferences",
  "collabTelemetryEvents",
  "aiFeatureSnapshots",
  "aiAnalyticsRollups",
  "aiTrainingExamples",
  "knowledgeGraphNodes",
  "knowledgeGraphEdges",
] as const;

type SnapshotRows = Record<(typeof SNAPSHOT_ROW_KEYS)[number], unknown[]>;

const demoModeSnapshotSchema = z.object({
  version: z.literal(1),
  mode: demoModeSchema,
  capturedAt: z.string(),
  rows: z.record(z.string(), z.array(z.unknown())),
});
type DemoModeSnapshot = z.infer<typeof demoModeSnapshotSchema>;

type ModeRowCollection = {
  rows: SnapshotRows;
  trialIds: string[];
  protocolIds: number[];
  protocolDocIds: string[];
  scaffoldIds: number[];
  phaseIds: number[];
  taskIds: number[];
  storeIds: number[];
  mapIds: string[];
  mapPhaseIds: string[];
  mapTaskIds: string[];
  conversationIds: string[];
  threadIds: string[];
  inboxIds: string[];
  emailChainIds: string[];
  messageIds: string[];
  crossReferenceIds: string[];
};

const DEMO_MODE_DEFAULTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS demo_mode_defaults (
    mode varchar(16) NOT NULL PRIMARY KEY,
    payload json NOT NULL,
    updatedBy int NOT NULL,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let demoModeDefaultsTableReady = false;
let mapTaskStatusHistoryTableReady = false;

const MAP_TASK_STATUS_HISTORY_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS map_task_status_history (
    id varchar(36) NOT NULL PRIMARY KEY,
    mapId varchar(36) NOT NULL,
    trialId varchar(50) NOT NULL,
    taskId varchar(36) NOT NULL,
    fromStatus enum('suggested','confirmed','todo','in_progress','blocked','waiting','done','skipped','cancelled') NULL,
    toStatus enum('suggested','confirmed','todo','in_progress','blocked','waiting','done','skipped','cancelled') NOT NULL,
    reason text NULL,
    source varchar(32) NOT NULL DEFAULT 'status_change',
    changedBy int NULL,
    enteredAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    exitedAt timestamp NULL,
    durationSeconds int NULL,
    createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_task_status_history_map_task_entered (mapId, taskId, enteredAt),
    KEY idx_task_status_history_trial_entered (trialId, enteredAt),
    KEY idx_task_status_history_task_open (taskId, exitedAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

function emptySnapshotRows(): SnapshotRows {
  return {
    trials: [],
    protocols: [],
    protocolSections: [],
    protocolChunks: [],
    fileSearchStores: [],
    fileSearchDocuments: [],
    taskScaffolds: [],
    phases: [],
    tasks: [],
    taskDependencies: [],
    phaseTransitions: [],
    executionMaps: [],
    mapPhases: [],
    mapTasks: [],
    mapTaskDependencies: [],
    mapPhaseTransitions: [],
    protocolMapSections: [],
    mapTelemetryEvents: [],
    mapTaskStatusHistory: [],
    conversations: [],
    conversationParticipants: [],
    threads: [],
    threadAnchors: [],
    threadParticipants: [],
    trialInboxes: [],
    emailChains: [],
    messages: [],
    crossReferences: [],
    collabTelemetryEvents: [],
    aiFeatureSnapshots: [],
    aiAnalyticsRollups: [],
    aiTrainingExamples: [],
    knowledgeGraphNodes: [],
    knowledgeGraphEdges: [],
  };
}

function normalizeSnapshotRows(input: Record<string, unknown[]>): SnapshotRows {
  const next = emptySnapshotRows();
  for (const key of SNAPSHOT_ROW_KEYS) {
    const value = input[key];
    next[key] = Array.isArray(value) ? value : [];
  }
  return next;
}

function extractExecuteRows(result: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result && typeof result === "object" && "rows" in result
    ? ((result as { rows?: unknown }).rows ?? [])
    : [];

  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
}

function coerceDateValue(value: unknown): unknown {
  if (value instanceof Date || value === null || value === undefined) return value;
  if (typeof value !== "string") return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed;
}

function coerceJsonValue(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const couldBeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!couldBeJson) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function toRowObjects(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
}

function asTypedRows<T extends Record<string, unknown>>(rows: unknown[]): T[] {
  return toRowObjects(rows) as T[];
}

function normalizeRowsForInsert(
  rows: unknown[],
  options?: { dateFields?: readonly string[]; jsonFields?: readonly string[] }
): Array<Record<string, unknown>> {
  const dateFields = options?.dateFields ?? [];
  const jsonFields = options?.jsonFields ?? [];
  return toRowObjects(rows).map((row) => {
    const next = { ...row };
    for (const field of dateFields) {
      next[field] = coerceDateValue(next[field]);
    }
    for (const field of jsonFields) {
      next[field] = coerceJsonValue(next[field]);
    }
    return next;
  });
}

async function insertSnapshotRows(
  tx: DbTransaction,
  table: unknown,
  rows: unknown[],
  options?: { dateFields?: readonly string[]; jsonFields?: readonly string[] }
) {
  const normalized = normalizeRowsForInsert(rows, options);
  if (normalized.length === 0) return;
  await tx.insert(table as never).values(normalized as never);
}

async function ensureDemoModeDefaultsTable(db: DbClient) {
  if (demoModeDefaultsTableReady) return;
  try {
    await db.execute(sql.raw(DEMO_MODE_DEFAULTS_TABLE_SQL));
  } catch {
    /* best-effort auto-creation for dialect compatibility */
  }
  demoModeDefaultsTableReady = true;
}

async function ensureMapTaskStatusHistoryTable(db: DbClient) {
  if (mapTaskStatusHistoryTableReady) return;
  try {
    await db.execute(sql.raw(MAP_TASK_STATUS_HISTORY_TABLE_SQL));
  } catch {
    /* best-effort auto-creation for dialect compatibility */
  }
  mapTaskStatusHistoryTableReady = true;
}

async function readSavedModeSnapshot(
  db: DbClient,
  mode: DemoMode
): Promise<DemoModeSnapshot | null> {
  try {
    await ensureDemoModeDefaultsTable(db);
  } catch (error) {
    console.warn("[demo] Could not access demo_mode_defaults table. Continuing without saved defaults.", error);
    return null;
  }
  const result = await db.execute(
    sql`SELECT payload FROM demo_mode_defaults WHERE mode = ${mode} LIMIT 1`
  );
  const rows = extractExecuteRows(result);
  if (rows.length === 0) return null;
  const payloadRaw = rows[0]?.payload;
  let payload: unknown = payloadRaw;
  if (typeof payloadRaw === "string") {
    try {
      payload = JSON.parse(payloadRaw);
    } catch (error) {
      console.warn("[demo] Failed to parse saved demo mode snapshot payload", error);
      return null;
    }
  }
  const parsed = demoModeSnapshotSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn("[demo] Invalid saved demo mode snapshot payload", parsed.error.flatten());
    return null;
  }
  return {
    ...parsed.data,
    mode,
    rows: normalizeSnapshotRows(parsed.data.rows),
  };
}

async function writeSavedModeSnapshot(
  db: DbClient,
  mode: DemoMode,
  snapshot: DemoModeSnapshot,
  updatedBy: number
) {
  await ensureDemoModeDefaultsTable(db);
  const payload = JSON.stringify(snapshot);
  await db.execute(
    sql`
      INSERT INTO demo_mode_defaults (mode, payload, updatedBy)
      VALUES (${mode}, ${payload}, ${updatedBy})
      ON DUPLICATE KEY UPDATE
        payload = VALUES(payload),
        updatedBy = VALUES(updatedBy),
        updatedAt = CURRENT_TIMESTAMP
    `
  );
}

async function collectModeRows(
  tx: DbTransaction,
  mode: DemoMode | "all"
): Promise<ModeRowCollection> {
  // Trials are BE-owned now. Source the trial list from the BE; its `id` is the
  // BE UUID that every FE child table is keyed by, so use it to scope all the
  // child-table reads below.
  const trialRows = await listBeTrials(mode);
  const trialIds = trialRows.map((row) => String(row.id));

  if (trialIds.length === 0) {
    return {
      rows: emptySnapshotRows(),
      trialIds: [],
      protocolIds: [],
      protocolDocIds: [],
      scaffoldIds: [],
      phaseIds: [],
      taskIds: [],
      storeIds: [],
      mapIds: [],
      mapPhaseIds: [],
      mapTaskIds: [],
      conversationIds: [],
      threadIds: [],
      inboxIds: [],
      emailChainIds: [],
      messageIds: [],
      crossReferenceIds: [],
    };
  }

  const protocolRows = await tx
    .select()
    .from(protocols)
    .where(inArray(protocols.trialId, trialIds));
  const protocolIds = protocolRows.map((row) => row.id);
  const protocolDocIds = protocolRows.map((row) => String(row.id));

  const protocolSectionRows = protocolIds.length > 0
    ? await tx
        .select()
        .from(protocolSections)
        .where(inArray(protocolSections.protocolId, protocolDocIds))
    : [];

  const protocolChunkRows = protocolIds.length > 0
    ? await tx
        .select()
        .from(protocolChunks)
        .where(inArray(protocolChunks.protocolId, protocolDocIds))
    : [];

  const scaffoldRows = await tx
    .select()
    .from(taskScaffolds)
    .where(inArray(taskScaffolds.trialId, trialIds));
  const scaffoldIds = scaffoldRows.map((row) => row.id);

  const phaseRows = scaffoldIds.length > 0
    ? await tx
        .select()
        .from(phases)
        .where(inArray(phases.scaffoldId, scaffoldIds))
    : [];
  const phaseIds = phaseRows.map((row) => row.id);

  const taskRows = phaseIds.length > 0
    ? await tx
        .select()
        .from(tasks)
        .where(inArray(tasks.phaseId, phaseIds))
    : [];
  const taskIds = taskRows.map((row) => row.id);

  const taskDependencyRows = taskIds.length > 0
    ? await tx
        .select()
        .from(taskDependencies)
        .where(
          or(
            inArray(taskDependencies.taskId, taskIds),
            inArray(taskDependencies.dependsOnTaskId, taskIds)
          )
        )
    : [];

  const phaseTransitionRows = phaseIds.length > 0
    ? await tx
        .select()
        .from(phaseTransitions)
        .where(
          or(
            inArray(phaseTransitions.fromPhaseId, phaseIds),
            inArray(phaseTransitions.toPhaseId, phaseIds)
          )
        )
    : [];

  const storeRows = await tx
    .select()
    .from(fileSearchStores)
    .where(inArray(fileSearchStores.trialId, trialIds));
  const storeIds = storeRows.map((row) => row.id);

  const fileDocumentRows =
    protocolIds.length > 0 && storeIds.length > 0
      ? await tx
          .select()
          .from(fileSearchDocuments)
          .where(
            or(
              inArray(fileSearchDocuments.protocolId, protocolDocIds),
              inArray(fileSearchDocuments.storeId, storeIds)
            )
          )
      : protocolIds.length > 0
      ? await tx
          .select()
          .from(fileSearchDocuments)
          .where(inArray(fileSearchDocuments.protocolId, protocolDocIds))
      : storeIds.length > 0
      ? await tx
          .select()
          .from(fileSearchDocuments)
          .where(inArray(fileSearchDocuments.storeId, storeIds))
      : [];

  const executionMapRows = await tx
    .select()
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds));
  const mapIds = executionMapRows.map((row) => row.id);

  const mapPhaseRows = mapIds.length > 0
    ? await tx
        .select()
        .from(mapPhases)
        .where(inArray(mapPhases.mapId, mapIds))
    : [];
  const mapPhaseIds = mapPhaseRows.map((row) => row.id);

  const mapTaskRows = mapIds.length > 0
    ? await tx
        .select()
        .from(mapTasks)
        .where(inArray(mapTasks.mapId, mapIds))
    : [];
  const mapTaskIds = mapTaskRows.map((row) => row.id);

  const mapTaskDependencyRows = mapTaskIds.length > 0
    ? await tx
        .select()
        .from(mapTaskDependencies)
        .where(
          or(
            inArray(mapTaskDependencies.sourceTaskId, mapTaskIds),
            inArray(mapTaskDependencies.targetTaskId, mapTaskIds)
          )
        )
    : [];

  const mapPhaseTransitionRows = mapPhaseIds.length > 0
    ? await tx
        .select()
        .from(mapPhaseTransitions)
        .where(
          or(
            inArray(mapPhaseTransitions.fromPhaseId, mapPhaseIds),
            inArray(mapPhaseTransitions.toPhaseId, mapPhaseIds)
          )
        )
    : [];

  const protocolMapSectionRows = mapIds.length > 0
    ? await tx
        .select()
        .from(protocolMapSections)
        .where(inArray(protocolMapSections.mapId, mapIds))
    : [];

  const mapTelemetryRows =
    mapIds.length > 0
      ? await tx
          .select()
          .from(mapTelemetryEvents)
          .where(
            or(
              inArray(mapTelemetryEvents.mapId, mapIds),
              inArray(mapTelemetryEvents.trialId, trialIds)
            )
          )
      : await tx
          .select()
          .from(mapTelemetryEvents)
          .where(inArray(mapTelemetryEvents.trialId, trialIds));

  let mapTaskStatusHistoryRows: typeof mapTaskStatusHistory.$inferSelect[] = [];
  try {
    mapTaskStatusHistoryRows =
      mapIds.length > 0
        ? await tx
            .select()
            .from(mapTaskStatusHistory)
            .where(
              or(
                inArray(mapTaskStatusHistory.mapId, mapIds),
                inArray(mapTaskStatusHistory.trialId, trialIds)
              )
            )
        : await tx
            .select()
            .from(mapTaskStatusHistory)
            .where(inArray(mapTaskStatusHistory.trialId, trialIds));
  } catch (error) {
    console.warn("[demo] mapTaskStatusHistory read skipped due to schema compatibility issue.", error);
    mapTaskStatusHistoryRows = [];
  }

  const conversationRows = await tx
    .select()
    .from(conversations)
    .where(inArray(conversations.trialId, trialIds));
  const conversationIds = conversationRows.map((row) => row.id);

  const conversationParticipantRows = conversationIds.length > 0
    ? await tx
        .select()
        .from(conversationParticipants)
        .where(inArray(conversationParticipants.conversationId, conversationIds))
    : [];

  const threadRows = await tx
    .select()
    .from(threads)
    .where(inArray(threads.trialId, trialIds));
  const threadIds = threadRows.map((row) => row.id);

  const threadAnchorRows = threadIds.length > 0
    ? await tx
        .select()
        .from(threadAnchors)
        .where(inArray(threadAnchors.threadId, threadIds))
    : [];

  const threadParticipantRows = threadIds.length > 0
    ? await tx
        .select()
        .from(threadParticipants)
        .where(inArray(threadParticipants.threadId, threadIds))
    : [];

  const trialInboxRows = await tx
    .select()
    .from(trialInboxes)
    .where(inArray(trialInboxes.trialId, trialIds));
  const inboxIds = trialInboxRows.map((row) => row.id);

  const emailChainRows = inboxIds.length > 0
    ? await tx
        .select()
        .from(emailChains)
        .where(inArray(emailChains.inboxId, inboxIds))
    : [];
  const emailChainIds = emailChainRows.map((row) => row.id);

  const messageRows =
    conversationIds.length > 0 && threadIds.length > 0 && emailChainIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(
            or(
              inArray(messages.conversationId, conversationIds),
              inArray(messages.threadId, threadIds),
              inArray(messages.emailChainId, emailChainIds)
            )
          )
      : conversationIds.length > 0 && threadIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(
            or(
              inArray(messages.conversationId, conversationIds),
              inArray(messages.threadId, threadIds)
            )
          )
      : conversationIds.length > 0 && emailChainIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(
            or(
              inArray(messages.conversationId, conversationIds),
              inArray(messages.emailChainId, emailChainIds)
            )
          )
      : threadIds.length > 0 && emailChainIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(
            or(
              inArray(messages.threadId, threadIds),
              inArray(messages.emailChainId, emailChainIds)
            )
          )
      : conversationIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(inArray(messages.conversationId, conversationIds))
      : threadIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(inArray(messages.threadId, threadIds))
      : emailChainIds.length > 0
      ? await tx
          .select()
          .from(messages)
          .where(inArray(messages.emailChainId, emailChainIds))
      : [];
  const messageIds = messageRows.map((row) => row.id);

  const crossRefEntityIds = Array.from(
    new Set<string>([
      ...messageIds,
      ...threadIds,
      ...emailChainIds,
      ...mapTaskIds.map((id) => String(id)),
      ...taskIds.map((id) => String(id)),
    ])
  );

  const crossReferenceRows = crossRefEntityIds.length > 0
    ? await tx
        .select()
        .from(crossReferences)
        .where(
          or(
            inArray(crossReferences.sourceId, crossRefEntityIds),
            inArray(crossReferences.targetId, crossRefEntityIds)
          )
        )
    : [];
  const crossReferenceIds = crossReferenceRows.map((row) => row.id);

  const collabTelemetryRows = await tx
    .select()
    .from(collabTelemetryEvents)
    .where(inArray(collabTelemetryEvents.trialId, trialIds));

  const aiFeatureSnapshotRows = await tx
    .select()
    .from(aiFeatureSnapshots)
    .where(inArray(aiFeatureSnapshots.trialId, trialIds));

  const aiAnalyticsRollupRows = await tx
    .select()
    .from(aiAnalyticsRollups)
    .where(inArray(aiAnalyticsRollups.trialId, trialIds));

  const aiTrainingExampleRows = await tx
    .select()
    .from(aiTrainingExamples)
    .where(inArray(aiTrainingExamples.trialId, trialIds));

  const knowledgeGraphNodeRows = await tx
    .select()
    .from(knowledgeGraphNodes)
    .where(inArray(knowledgeGraphNodes.trialId, trialIds));

  const knowledgeGraphEdgeRows = await tx
    .select()
    .from(knowledgeGraphEdges)
    .where(inArray(knowledgeGraphEdges.trialId, trialIds));

  return {
    rows: {
      trials: trialRows,
      protocols: protocolRows,
      protocolSections: protocolSectionRows,
      protocolChunks: protocolChunkRows,
      fileSearchStores: storeRows,
      fileSearchDocuments: fileDocumentRows,
      taskScaffolds: scaffoldRows,
      phases: phaseRows,
      tasks: taskRows,
      taskDependencies: taskDependencyRows,
      phaseTransitions: phaseTransitionRows,
      executionMaps: executionMapRows,
      mapPhases: mapPhaseRows,
      mapTasks: mapTaskRows,
      mapTaskDependencies: mapTaskDependencyRows,
      mapPhaseTransitions: mapPhaseTransitionRows,
      protocolMapSections: protocolMapSectionRows,
      mapTelemetryEvents: mapTelemetryRows,
      mapTaskStatusHistory: mapTaskStatusHistoryRows,
      conversations: conversationRows,
      conversationParticipants: conversationParticipantRows,
      threads: threadRows,
      threadAnchors: threadAnchorRows,
      threadParticipants: threadParticipantRows,
      trialInboxes: trialInboxRows,
      emailChains: emailChainRows,
      messages: messageRows,
      crossReferences: crossReferenceRows,
      collabTelemetryEvents: collabTelemetryRows,
      aiFeatureSnapshots: aiFeatureSnapshotRows,
      aiAnalyticsRollups: aiAnalyticsRollupRows,
      aiTrainingExamples: aiTrainingExampleRows,
      knowledgeGraphNodes: knowledgeGraphNodeRows,
      knowledgeGraphEdges: knowledgeGraphEdgeRows,
    },
    trialIds,
    protocolIds,
    protocolDocIds,
    scaffoldIds,
    phaseIds,
    taskIds,
    storeIds,
    mapIds,
    mapPhaseIds,
    mapTaskIds,
    conversationIds,
    threadIds,
    inboxIds,
    emailChainIds,
    messageIds,
    crossReferenceIds,
  };
}

async function captureModeSnapshot(
  mode: DemoMode,
  dbClient?: DbClient
): Promise<DemoModeSnapshot> {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");
  await ensureMapTaskStatusHistoryTable(db);
  const rows = await db.transaction(async (tx) => {
    const collected = await collectModeRows(tx, mode);
    return collected.rows;
  });
  return {
    version: 1,
    mode,
    capturedAt: new Date().toISOString(),
    rows,
  };
}

async function restoreModeSnapshot(
  snapshot: DemoModeSnapshot,
  dbClient?: DbClient
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");
  await ensureMapTaskStatusHistoryTable(db);
  const rows = normalizeSnapshotRows(snapshot.rows);

  // Trials are BE-owned. The snapshot's `rows.trials` holds the SOURCE BE trial
  // objects; child rows are keyed by the source BE UUID. Recreate each trial in
  // the BE (a POST assigns a fresh UUID), build a source->new UUID map, and
  // re-key every trial-keyed child row array before it is inserted.
  const restoreTrialIdMap = new Map<string, string>();
  const snapshotMode = snapshot.mode;
  for (const sourceRow of asTypedRows<Record<string, any>>(rows.trials)) {
    const sourceBeId = String(sourceRow.id);
    const {
      id: _id,
      slug: _slug,
      demo_mode: _demoMode,
      organization_id: _org,
      created_by: _createdBy,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...rest
    } = sourceRow;
    const body = { ...rest, demo_mode: snapshotMode, name: sourceRow.name ?? "Untitled Trial" };
    try {
      // The mode was wiped before restore, so always create a fresh BE trial
      // (UUID assigned by the BE) and map source UUID -> new UUID.
      const beTrial: any = await callBackend(`/api/trials/with-assignments`, {
        method: "POST",
        body: { ...body, members: [], pending_members: [] },
      });
      const beId: string | null = beTrial?.id ?? null;
      if (beId) restoreTrialIdMap.set(sourceBeId, beId);
    } catch (error) {
      console.warn(
        `[demo] Failed to recreate BE trial (source=${sourceBeId}) during snapshot restore; its child data keeps the source key.`,
        error
      );
    }
  }

  // Re-key the `trialId` of every trial-keyed snapshot row array to the new BE
  // UUID before inserting the child data.
  const remapTrialId = (list: unknown[]) => {
    for (const row of list as Array<Record<string, unknown>>) {
      if (!row || typeof row !== "object") continue;
      const current = row.trialId;
      if (typeof current === "string") {
        const next = restoreTrialIdMap.get(current);
        if (next) row.trialId = next;
      }
    }
  };
  for (const key of [
    "protocols",
    "protocolChunks",
    "fileSearchStores",
    "taskScaffolds",
    "executionMaps",
    "mapTelemetryEvents",
    "mapTaskStatusHistory",
    "conversations",
    "threads",
    "trialInboxes",
    "collabTelemetryEvents",
    "aiFeatureSnapshots",
    "aiAnalyticsRollups",
    "aiTrainingExamples",
    "knowledgeGraphNodes",
    "knowledgeGraphEdges",
  ] as const) {
    remapTrialId(rows[key]);
  }

  await db.transaction(async (tx) => {
    await insertSnapshotRows(tx, protocols, rows.protocols, {
      dateFields: ["archivedAt", "createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, protocolSections, rows.protocolSections, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, protocolChunks, rows.protocolChunks, {
      dateFields: ["createdAt", "updatedAt"],
      jsonFields: ["metadata"],
    });
    await insertSnapshotRows(tx, fileSearchStores, rows.fileSearchStores, {
      dateFields: ["createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, fileSearchDocuments, rows.fileSearchDocuments, {
      dateFields: ["uploadedAt"],
    });
    await insertSnapshotRows(tx, taskScaffolds, rows.taskScaffolds, {
      dateFields: ["confirmedAt", "createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, phases, rows.phases, {
      dateFields: ["createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, tasks, rows.tasks, {
      dateFields: ["suggestedDate", "createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, taskDependencies, rows.taskDependencies, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, phaseTransitions, rows.phaseTransitions, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, executionMaps, rows.executionMaps, {
      dateFields: ["createdAt", "launchedAt", "updatedAt"],
      jsonFields: ["metadata"],
    });
    await insertSnapshotRows(tx, mapPhases, rows.mapPhases, {
      dateFields: ["estimatedDate", "windowStart", "windowEnd", "createdAt", "updatedAt"],
      jsonFields: ["protocolRef"],
    });
    await insertSnapshotRows(tx, mapTasks, rows.mapTasks, {
      dateFields: [
        "blockedSince",
        "suggestedDate",
        "dueDate",
        "startDate",
        "completedDate",
        "createdAt",
        "updatedAt",
      ],
      jsonFields: ["tags", "protocolRefs"],
    });
    await insertSnapshotRows(tx, mapTaskDependencies, rows.mapTaskDependencies, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, mapPhaseTransitions, rows.mapPhaseTransitions, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, protocolMapSections, rows.protocolMapSections, {
      dateFields: ["dateReference", "createdAt"],
      jsonFields: ["linkedPhaseIds", "linkedTaskIds"],
    });
    await insertSnapshotRows(tx, mapTelemetryEvents, rows.mapTelemetryEvents, {
      dateFields: ["createdAt"],
      jsonFields: ["payload"],
    });
    await insertSnapshotRows(tx, mapTaskStatusHistory, rows.mapTaskStatusHistory, {
      dateFields: ["enteredAt", "exitedAt", "createdAt"],
    });
    await insertSnapshotRows(tx, conversations, rows.conversations, {
      dateFields: ["createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, conversationParticipants, rows.conversationParticipants, {
      dateFields: ["joinedAt", "lastReadAt"],
    });
    await insertSnapshotRows(tx, threads, rows.threads, {
      dateFields: ["resolvedAt", "createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, threadAnchors, rows.threadAnchors, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, threadParticipants, rows.threadParticipants, {
      dateFields: ["joinedAt", "lastReadAt"],
    });
    await insertSnapshotRows(tx, trialInboxes, rows.trialInboxes, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, emailChains, rows.emailChains, {
      dateFields: ["createdAt", "updatedAt"],
      jsonFields: ["aiLabels", "toAddresses", "ccAddresses"],
    });
    await insertSnapshotRows(tx, messages, rows.messages, {
      dateFields: ["editedAt", "createdAt"],
      jsonFields: ["embeddedContent"],
    });
    await insertSnapshotRows(tx, crossReferences, rows.crossReferences, {
      dateFields: ["createdAt"],
    });
    await insertSnapshotRows(tx, collabTelemetryEvents, rows.collabTelemetryEvents, {
      dateFields: ["createdAt"],
      jsonFields: ["eventData"],
    });
    await insertSnapshotRows(tx, aiFeatureSnapshots, rows.aiFeatureSnapshots, {
      dateFields: ["createdAt"],
      jsonFields: ["featureVector"],
    });
    await insertSnapshotRows(tx, aiAnalyticsRollups, rows.aiAnalyticsRollups, {
      dateFields: ["createdAt", "updatedAt"],
    });
    await insertSnapshotRows(tx, aiTrainingExamples, rows.aiTrainingExamples, {
      dateFields: ["createdAt"],
      jsonFields: ["metadata"],
    });
    await insertSnapshotRows(tx, knowledgeGraphNodes, rows.knowledgeGraphNodes, {
      dateFields: ["createdAt", "updatedAt"],
      jsonFields: ["properties"],
    });
    await insertSnapshotRows(tx, knowledgeGraphEdges, rows.knowledgeGraphEdges, {
      dateFields: ["createdAt"],
      jsonFields: ["properties"],
    });
  });
}

async function wipeModeData(mode: DemoMode | "all", dbClient?: DbClient) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");
  await ensureMapTaskStatusHistoryTable(db);

  await db.transaction(async (tx) => {
    const collected = await collectModeRows(tx, mode);
    const {
      trialIds,
      protocolIds,
      protocolDocIds,
      scaffoldIds,
      phaseIds,
      taskIds,
      storeIds,
      mapIds,
      mapPhaseIds,
      mapTaskIds,
      conversationIds,
      threadIds,
      inboxIds,
      emailChainIds,
      messageIds,
      crossReferenceIds,
    } = collected;
    if (trialIds.length === 0) return;

    // `trialIds` are the BE trial UUIDs (the key every FE child table is now
    // keyed by). Clear every BE-UUID-keyed child table by them first; the
    // id-scoped deletes below then remove the rest of the child graph.
    await clearBeKeyedChildData(tx, trialIds);

    if (crossReferenceIds.length > 0) {
      await tx
        .delete(crossReferences)
        .where(inArray(crossReferences.id, crossReferenceIds));
    }

    if (messageIds.length > 0) {
      await tx.delete(messages).where(inArray(messages.id, messageIds));
    }

    if (emailChainIds.length > 0) {
      await tx
        .delete(emailChains)
        .where(inArray(emailChains.id, emailChainIds));
    }

    if (inboxIds.length > 0) {
      await tx
        .delete(trialInboxes)
        .where(inArray(trialInboxes.id, inboxIds));
    }

    if (threadIds.length > 0) {
      await tx
        .delete(threadAnchors)
        .where(inArray(threadAnchors.threadId, threadIds));
      await tx
        .delete(threadParticipants)
        .where(inArray(threadParticipants.threadId, threadIds));
      await tx
        .delete(threads)
        .where(inArray(threads.id, threadIds));
    }

    if (conversationIds.length > 0) {
      await tx
        .delete(conversationParticipants)
        .where(inArray(conversationParticipants.conversationId, conversationIds));
      await tx
        .delete(conversations)
        .where(inArray(conversations.id, conversationIds));
    }

    await tx
      .delete(collabTelemetryEvents)
      .where(inArray(collabTelemetryEvents.trialId, trialIds));

    if (mapTaskIds.length > 0) {
      try {
        await tx
          .delete(mapTaskStatusHistory)
          .where(inArray(mapTaskStatusHistory.taskId, mapTaskIds));
      } catch (error) {
        console.warn("[demo] mapTaskStatusHistory cleanup by task skipped due to schema compatibility issue.", error);
      }
      await tx
        .delete(mapTaskDependencies)
        .where(
          or(
            inArray(mapTaskDependencies.sourceTaskId, mapTaskIds),
            inArray(mapTaskDependencies.targetTaskId, mapTaskIds)
          )
        );
      await tx
        .delete(mapTasks)
        .where(inArray(mapTasks.id, mapTaskIds));
    }

    if (mapPhaseIds.length > 0) {
      await tx
        .delete(mapPhaseTransitions)
        .where(
          or(
            inArray(mapPhaseTransitions.fromPhaseId, mapPhaseIds),
            inArray(mapPhaseTransitions.toPhaseId, mapPhaseIds)
          )
        );
      await tx
        .delete(mapPhases)
        .where(inArray(mapPhases.id, mapPhaseIds));
    }

    if (mapIds.length > 0) {
      await tx
        .delete(protocolMapSections)
        .where(inArray(protocolMapSections.mapId, mapIds));
      try {
        await tx
          .delete(mapTaskStatusHistory)
          .where(
            or(
              inArray(mapTaskStatusHistory.mapId, mapIds),
              inArray(mapTaskStatusHistory.trialId, trialIds)
            )
          );
      } catch (error) {
        console.warn("[demo] mapTaskStatusHistory cleanup by map skipped due to schema compatibility issue.", error);
      }
      await tx
        .delete(mapTelemetryEvents)
        .where(
          or(
            inArray(mapTelemetryEvents.mapId, mapIds),
            inArray(mapTelemetryEvents.trialId, trialIds)
          )
        );
      await tx
        .delete(executionMaps)
        .where(inArray(executionMaps.id, mapIds));
    } else {
      try {
        await tx
          .delete(mapTaskStatusHistory)
          .where(inArray(mapTaskStatusHistory.trialId, trialIds));
      } catch (error) {
        console.warn("[demo] mapTaskStatusHistory cleanup by trial skipped due to schema compatibility issue.", error);
      }
      await tx
        .delete(mapTelemetryEvents)
        .where(inArray(mapTelemetryEvents.trialId, trialIds));
    }

    await tx
      .delete(knowledgeGraphEdges)
      .where(inArray(knowledgeGraphEdges.trialId, trialIds));
    await tx
      .delete(knowledgeGraphNodes)
      .where(inArray(knowledgeGraphNodes.trialId, trialIds));

    await tx
      .delete(aiTrainingExamples)
      .where(inArray(aiTrainingExamples.trialId, trialIds));
    await tx
      .delete(aiAnalyticsRollups)
      .where(inArray(aiAnalyticsRollups.trialId, trialIds));
    await tx
      .delete(aiFeatureSnapshots)
      .where(inArray(aiFeatureSnapshots.trialId, trialIds));

    if (taskIds.length > 0) {
      await tx
        .delete(taskDependencies)
        .where(
          or(
            inArray(taskDependencies.taskId, taskIds),
            inArray(taskDependencies.dependsOnTaskId, taskIds)
          )
        );
      await tx
        .delete(tasks)
        .where(inArray(tasks.id, taskIds));
    }

    if (phaseIds.length > 0) {
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
        .where(inArray(phases.id, phaseIds));
    }

    if (scaffoldIds.length > 0) {
      await tx
        .delete(taskScaffolds)
        .where(inArray(taskScaffolds.id, scaffoldIds));
    }

    if (protocolIds.length > 0) {
      await tx
        .delete(protocolSections)
        .where(inArray(protocolSections.protocolId, protocolDocIds));
      await tx
        .delete(protocolChunks)
        .where(inArray(protocolChunks.protocolId, protocolDocIds));
      await tx
        .delete(fileSearchDocuments)
        .where(inArray(fileSearchDocuments.protocolId, protocolDocIds));
      await tx
        .delete(protocols)
        .where(inArray(protocols.id, protocolIds));
    }

    if (storeIds.length > 0) {
      await tx
        .delete(fileSearchDocuments)
        .where(inArray(fileSearchDocuments.storeId, storeIds));
      await tx
        .delete(fileSearchStores)
        .where(inArray(fileSearchStores.id, storeIds));
    }

    // Trials are BE-owned: delete each demo trial in the BE (cascades BE docs /
    // members). `trialIds` are BE UUIDs. Best-effort per trial so one failure
    // doesn't abort the wipe; the FE child rows are already cleared above.
    for (const beTrialId of trialIds) {
      try {
        await callBackend(`/api/trials/${beTrialId}`, { method: "DELETE" });
      } catch (error) {
        console.warn(`[demo] Failed to delete BE trial ${beTrialId} during wipe.`, error);
      }
    }
  });
}

async function seedCategories(dbClient?: DbClient) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(documentCategories)
    .values(
      DEFAULT_CATEGORIES.map((name) => ({
        name,
        isDefault: true,
      }))
    )
    .onConflictDoUpdate({
      target: documentCategories.name,
      set: {
        isDefault: true,
      },
    });
}

// Trials are BE-owned now; there is no FE `trials` table to seed. The BE trial
// rows are created by `ensureBeTrialsForSeed` (called from seedBaseModeData),
// and the seeded child data is keyed by the prefixed id then re-keyed to the BE
// UUID. This is kept as an intentional no-op so the seed orchestration reads
// the same and a future change can hook trial-level seeding back in here.
async function seedTrials(
  _data: typeof SAMPLE_TRIALS,
  _createdBy: number,
  _mode: DemoMode,
  _dbClient?: DbClient
) {
  /* no-op: BE owns the trial row (see ensureBeTrialsForSeed) */
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SEED_ASSIGNEE_IDS = [1, 2, 3, 4, 5, 6] as const;
const SEED_ASSIGNEE_NAMES: Record<number, string> = {
  1: "Kaleb Sanders",
  2: "Ava Patel",
  3: "Liam Chen",
  4: "Maya Rodriguez",
  5: "Noah Brooks",
  6: "Olivia Hart",
};
const LEGACY_PHASE_BLUEPRINT = [
  { name: "Screening", color: "#6366F1" },
  { name: "Treatment", color: "#3B82F6" },
  { name: "Follow-up", color: "#10B981" },
] as const;
const LEGACY_TASK_BLUEPRINT = [
  ["Finalize site package", "Confirm inclusion/exclusion checklist"],
  ["Run visit schedule training", "Dispense investigational product"],
  ["Reconcile open data queries", "Perform close-out readiness review"],
] as const;
const MAP_PHASE_BLUEPRINT = [
  { label: "Screening", phaseType: "screening" as const, color: "#6366F1" },
  { label: "Visit Cycle", phaseType: "treatment_visit" as const, color: "#3B82F6" },
  { label: "Follow-up", phaseType: "follow_up" as const, color: "#10B981" },
] as const;
const MAP_TASK_BLUEPRINT = [
  {
    name: "Validate eligibility criteria",
    description: "Confirm inclusion/exclusion criteria and upload source confirmations.",
    category: "eligibility" as const,
    section: "Eligibility",
  },
  {
    name: "Schedule site readiness call",
    description: "Coordinate PI + CRC + support roles and confirm launch timeline.",
    category: "coordination" as const,
    section: "Study Coordination",
  },
  {
    name: "Submit safety package",
    description: "Prepare safety documents and submit to sponsor/monitor.",
    category: "safety_reporting" as const,
    section: "Safety Reporting",
  },
] as const;
const MAP_PRIORITY_ROTATION = ["high", "medium", "critical", "medium", "low"] as const;
const MAP_ROLE_ROTATION = [
  "pi",
  "crc",
  "nurse",
  "lab_tech",
  "data_manager",
  "regulatory_coordinator",
] as const;

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

function toYyyyMmDd(date: Date) {
  return date.toISOString().slice(0, 10);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function resolveScaffoldStatus(status: TrialSeed["status"]): "draft" | "confirmed" | "active" {
  if (status === "not-started") return "draft";
  if (status === "on-hold" || status === "terminated") return "confirmed";
  return "active";
}

function resolveMapStatus(status: TrialSeed["status"]): "draft" | "active" | "revised" | "archived" {
  if (status === "not-started") return "draft";
  if (status === "terminated") return "archived";
  if (status === "on-hold") return "revised";
  return "active";
}

function resolveLegacyTaskStatus(
  trialStatus: TrialSeed["status"],
  phaseIndex: number,
  taskIndex: number
): "pending" | "completed" | "blocked" {
  if (trialStatus === "completed") return "completed";
  if (trialStatus === "not-started") return "pending";
  if (trialStatus === "terminated") return taskIndex === 0 ? "completed" : "blocked";
  if (trialStatus === "on-hold") return taskIndex === 0 ? "blocked" : "pending";
  if (trialStatus === "active" || trialStatus === "recruiting") {
    if (phaseIndex === 0 && taskIndex === 0) return "completed";
    if (phaseIndex === 2 && taskIndex === 1) return "blocked";
    return "pending";
  }
  return "pending";
}

function resolveMapTaskStatus(
  trialStatus: TrialSeed["status"],
  phaseIndex: number,
  taskIndex: number
):
  | "suggested"
  | "confirmed"
  | "todo"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "done"
  | "skipped"
  | "cancelled" {
  if (trialStatus === "completed") return phaseIndex === 2 && taskIndex === 2 ? "skipped" : "done";
  if (trialStatus === "terminated") return taskIndex === 0 ? "cancelled" : "blocked";
  if (trialStatus === "not-started") return phaseIndex === 0 ? "suggested" : "confirmed";
  if (trialStatus === "on-hold") return taskIndex === 0 ? "waiting" : "blocked";
  if (phaseIndex === 0 && taskIndex === 0) return "done";
  if (phaseIndex === 1 && taskIndex === 1) return "in_progress";
  if (phaseIndex === 2 && taskIndex === 2) return "blocked";
  return "todo";
}

function isMapTaskDoneStatus(status: string | null | undefined) {
  const token = String(status || "").toLowerCase();
  return token === "done" || token === "skipped" || token === "cancelled";
}

function computeSeedTaskTimelineDateSet({
  mode,
  seedKey,
  status,
  now,
}: {
  mode: "sample" | "full";
  seedKey: string;
  status: string | null | undefined;
  now: Date;
}) {
  const token = String(status || "todo").toLowerCase();
  const hash = stableHash(`${mode}:${seedKey}:${token}`);
  const done = isMapTaskDoneStatus(token);

  const openMaxWeeks = mode === "full" ? 10 : 8;
  const doneMaxWeeks = mode === "full" ? 10 : 9;

  let createdWeeksAgo = 0;
  let completedWeeksAgo: number | null = null;

  if (done) {
    completedWeeksAgo = 1 + (hash % doneMaxWeeks);
    createdWeeksAgo = Math.min(11, completedWeeksAgo + 1 + (hash % 2));
  } else if (token === "blocked" || token === "waiting") {
    createdWeeksAgo = 2 + (hash % Math.max(2, openMaxWeeks - 1));
  } else if (token === "in_progress") {
    createdWeeksAgo = 1 + (hash % Math.max(2, openMaxWeeks - 2));
  } else if (token === "suggested" || token === "confirmed") {
    createdWeeksAgo = hash % 3;
  } else {
    createdWeeksAgo = hash % (openMaxWeeks + 1);
  }

  const createdAt = addDays(now, -(createdWeeksAgo * 7 + (hash % 6)));
  let completedDate: Date | null = null;
  let updatedAt = addDays(createdAt, 1 + ((hash >> 1) % 4));

  if (completedWeeksAgo !== null) {
    completedDate = addDays(now, -(completedWeeksAgo * 7 + ((hash >> 3) % 5)));
    if (completedDate.getTime() < createdAt.getTime()) {
      completedDate = addDays(createdAt, 1 + ((hash >> 5) % 3));
    }
    updatedAt = completedDate;
  } else {
    const recentFloor = addDays(now, -(token === "blocked" || token === "waiting" ? 3 : 5));
    if (updatedAt.getTime() < recentFloor.getTime()) updatedAt = recentFloor;
    if (updatedAt.getTime() < createdAt.getTime()) updatedAt = createdAt;
  }

  if (updatedAt.getTime() > now.getTime()) updatedAt = new Date(now);
  return { createdAt, updatedAt, completedDate };
}

function startOfIsoWeek(source: Date) {
  const date = new Date(source.getFullYear(), source.getMonth(), source.getDate());
  const day = date.getDay();
  const daysFromMonday = (day + 6) % 7;
  date.setDate(date.getDate() - daysFromMonday);
  date.setHours(0, 0, 0, 0);
  return date;
}

function parseSeedOrdinal(seedKey: string, suffix: "t" | "ph") {
  const match = String(seedKey).match(new RegExp(`-${suffix}(\\d+)$`, "i"));
  if (!match) return 0;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed - 1;
}

function computeSeedTaskScheduleDateSet({
  mode,
  mapId,
  seedKey,
  status,
  now,
  timeline,
}: {
  mode: "sample" | "full";
  mapId: string;
  seedKey: string;
  status: string | null | undefined;
  now: Date;
  timeline: { completedDate: Date | null };
}) {
  const token = String(status || "todo").toLowerCase();
  const hash = stableHash(`${mode}:${mapId}:${seedKey}:${token}`);
  const done = isMapTaskDoneStatus(token);
  const currentWeekStart = startOfIsoWeek(now);

  if (done) {
    const completionDate = timeline.completedDate ?? addDays(now, -(7 + (hash % 35)));
    const dueDate = addDays(completionDate, -(1 + (hash % 3)));
    const suggestedDate = addDays(dueDate, -(2 + ((hash >> 2) % 4)));
    const startDate = addDays(suggestedDate, 1);
    return {
      suggestedDate,
      dueDate,
      startDate,
    };
  }

  const taskOrdinal = parseSeedOrdinal(seedKey, "t");
  const phaseIndex = Math.floor(taskOrdinal / MAP_TASK_BLUEPRINT.length);
  const taskIndex = taskOrdinal % MAP_TASK_BLUEPRINT.length;
  const trialShiftWeeks = stableHash(`${mode}:${mapId}:trial`) % 3;

  let weekOffset = trialShiftWeeks + phaseIndex * 4 + taskIndex;
  if (token === "blocked" || token === "waiting") {
    weekOffset = Math.min(weekOffset, 2 + (hash % 2));
  } else if (token === "in_progress") {
    weekOffset = Math.min(weekOffset, 3 + (hash % 2));
  } else if (token === "suggested" || token === "confirmed") {
    weekOffset = Math.max(weekOffset, 2 + phaseIndex * 2 + (hash % 2));
  }

  weekOffset = Math.max(0, Math.min(11, weekOffset));
  const weekStart = addDays(currentWeekStart, weekOffset * 7);
  const dueDate = addDays(weekStart, hash % 5);
  const suggestedLeadDays =
    token === "in_progress"
      ? 2
      : token === "blocked" || token === "waiting"
      ? 1
      : 3 + ((hash >> 3) % 3);
  const suggestedDate = addDays(dueDate, -suggestedLeadDays);
  const startDate = token === "in_progress" ? addDays(suggestedDate, 1) : null;

  return {
    suggestedDate,
    dueDate,
    startDate,
  };
}

function computeSeedPhaseWindowDateSet({
  mode,
  mapId,
  phaseId,
  now,
}: {
  mode: "sample" | "full";
  mapId: string;
  phaseId: string;
  now: Date;
}) {
  const phaseOrdinal = parseSeedOrdinal(phaseId, "ph");
  const hash = stableHash(`${mode}:${mapId}:${phaseId}`);
  const currentWeekStart = startOfIsoWeek(now);
  const trialShiftWeeks = stableHash(`${mode}:${mapId}:phase`) % 3;
  const weekOffset = Math.max(0, Math.min(11, trialShiftWeeks + phaseOrdinal * 4 + (hash % 2)));
  const windowStart = addDays(currentWeekStart, weekOffset * 7);
  const estimatedDate = addDays(windowStart, 2 + (hash % 2));
  const windowEnd = addDays(windowStart, 5);
  return {
    estimatedDate,
    windowStart,
    windowEnd,
  };
}

async function rebalanceSeedTaskTimelines(
  mode: "sample" | "full",
  dbClient?: DbClient
) {
  try {
    const db = dbClient ?? await getDb();
    if (!db) throw new Error("Database not available");

    const maps = await db
      .select({ id: executionMaps.id })
      .from(executionMaps)
      .where(like(executionMaps.id, `${mode}-map-%`));
    const mapIds = maps.map((row) => row.id);
    if (mapIds.length === 0) return false;

    const rows = await db
      .select({
        id: mapTasks.id,
        status: mapTasks.status,
        mapId: mapTasks.mapId,
      })
      .from(mapTasks)
      .where(inArray(mapTasks.mapId, mapIds));

    const seededRows = rows.filter((row) => /^.+-t\d{2,}$/i.test(String(row.id)));
    if (seededRows.length === 0) return false;

    const now = new Date();
    let canWriteHistory = true;
    try {
      await ensureMapTaskStatusHistoryTable(db);
    } catch {
      canWriteHistory = false;
    }

    for (const row of seededRows) {
      const dates = computeSeedTaskTimelineDateSet({
        mode,
        seedKey: row.id,
        status: row.status,
        now,
      });
      const scheduleDates = computeSeedTaskScheduleDateSet({
        mode,
        mapId: row.mapId,
        seedKey: row.id,
        status: row.status,
        now,
        timeline: dates,
      });

      await db
        .update(mapTasks)
        .set({
          createdAt: dates.createdAt,
          updatedAt: dates.updatedAt,
          completedDate: dates.completedDate,
          suggestedDate: scheduleDates.suggestedDate,
          dueDate: scheduleDates.dueDate,
          startDate: scheduleDates.startDate,
        })
        .where(eq(mapTasks.id, row.id));

      if (canWriteHistory) {
        const historyAnchor = dates.completedDate ?? dates.updatedAt;
        try {
          await db
            .update(mapTaskStatusHistory)
            .set({
              enteredAt: historyAnchor,
              createdAt: historyAnchor,
            })
            .where(eq(mapTaskStatusHistory.taskId, row.id));
        } catch {
          canWriteHistory = false;
        }
      }
    }

    const phaseRows = await db
      .select({
        id: mapPhases.id,
        mapId: mapPhases.mapId,
      })
      .from(mapPhases)
      .where(inArray(mapPhases.mapId, mapIds));

    const seededPhaseRows = phaseRows.filter((row) => /^.+-ph\d+$/i.test(String(row.id)));
    for (const row of seededPhaseRows) {
      const windowDates = computeSeedPhaseWindowDateSet({
        mode,
        mapId: row.mapId,
        phaseId: row.id,
        now,
      });

      await db
        .update(mapPhases)
        .set({
          estimatedDate: windowDates.estimatedDate,
          windowStart: windowDates.windowStart,
          windowEnd: windowDates.windowEnd,
          updatedAt: now,
        })
        .where(eq(mapPhases.id, row.id));
    }

    return true;
  } catch (error) {
    console.warn(`[demo] ${mode} task timeline rebalance skipped due to compatibility issue.`, error);
    return false;
  }
}

async function seedModeOperationalData(
  data: typeof SAMPLE_TRIALS,
  createdBy: number,
  mode: DemoMode,
  dbClient?: DbClient
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");
  await ensureMapTaskStatusHistoryTable(db);

  const now = new Date();
  const seededTrials = data.map((trial, index) => ({
    seed: trial,
    trialId: toDemoId(mode, trial.id),
    index,
    startDate: trial.startDate ?? addDays(new Date("2025-01-01T12:00:00.000Z"), index * 9),
  }));
  const seededTrialIds = seededTrials.map((entry) => entry.trialId);

  if (seededTrialIds.length === 0) return;

  const protocolInserts: Array<typeof protocols.$inferInsert> = [];
  const protocolSeedMeta: Array<{
    trialId: string;
    fileKey: string;
    category: string;
    shouldIndex: boolean;
    primary: boolean;
  }> = [];

  // Documents are now owned by the BE (`trial_documents`); the FE `protocols`
  // table is retired. The demo was a content-less UI mock (placeholder PDF URLs
  // + synthetic one-line chunks) with no real documents to seed into the BE, so
  // demo trials intentionally seed NO documents. Consequently every block below
  // that is anchored to a protocol (file-search docs, protocol sections/chunks,
  // task scaffolds, phases/tasks, execution maps + children) no-ops via its
  // existing `if (!primaryProtocol) continue` / `if (!scaffold) continue` guard.
  // Leaving `protocolInserts` / `protocolSeedMeta` empty is deliberate.

  if (protocolInserts.length > 0) {
    await db.insert(protocols).values(protocolInserts);
  }

  const insertedProtocols = await db
    .select()
    .from(protocols)
    .where(inArray(protocols.trialId, seededTrialIds));
  const protocolByFileKey = new Map(insertedProtocols.map((row) => [row.fileKey, row]));
  const primaryProtocolByTrialId = new Map<string, (typeof insertedProtocols)[number]>();
  const documentTotalsByTrialId = new Map<string, number>();

  for (const protocolRow of insertedProtocols) {
    documentTotalsByTrialId.set(
      protocolRow.trialId,
      (documentTotalsByTrialId.get(protocolRow.trialId) ?? 0) + 1
    );
    if (
      String(protocolRow.category || "").toLowerCase() === "protocol" &&
      !primaryProtocolByTrialId.has(protocolRow.trialId)
    ) {
      primaryProtocolByTrialId.set(protocolRow.trialId, protocolRow);
    }
  }

  const storeInserts: Array<typeof fileSearchStores.$inferInsert> = seededTrials.map((trial) => ({
    trialId: trial.trialId,
    storeName: `seed-${mode}-store-${String(trial.index + 1).padStart(3, "0")}`,
    displayName: `${trial.seed.title} (${mode}) File Search`,
    createdAt: addDays(now, -(20 + trial.index)),
    updatedAt: addDays(now, -(4 + (trial.index % 5))),
  }));
  if (storeInserts.length > 0) {
    await db.insert(fileSearchStores).values(storeInserts);
  }

  const storeRows = await db
    .select()
    .from(fileSearchStores)
    .where(inArray(fileSearchStores.trialId, seededTrialIds));
  const storeByTrialId = new Map(storeRows.map((row) => [row.trialId, row]));

  const fileDocInserts: Array<typeof fileSearchDocuments.$inferInsert> = [];
  const indexedDocumentTotalsByTrialId = new Map<string, number>();
  for (const protocolMeta of protocolSeedMeta) {
    if (!protocolMeta.shouldIndex) continue;
    const protocolRow = protocolByFileKey.get(protocolMeta.fileKey);
    const storeRow = storeByTrialId.get(protocolMeta.trialId);
    if (!protocolRow || !storeRow) continue;
    fileDocInserts.push({
      storeId: storeRow.id,
      protocolId: String(protocolRow.id),
      documentName: `seed-file-${mode}-${protocolRow.id}`,
      displayName: protocolRow.filename,
      uploadedAt: addDays(now, -(2 + (protocolRow.id % 4))),
    });
    indexedDocumentTotalsByTrialId.set(
      protocolMeta.trialId,
      (indexedDocumentTotalsByTrialId.get(protocolMeta.trialId) ?? 0) + 1
    );
  }
  if (fileDocInserts.length > 0) {
    await db.insert(fileSearchDocuments).values(fileDocInserts);
  }

  const protocolSectionInserts: Array<typeof protocolSections.$inferInsert> = [];
  const protocolChunkInserts: Array<typeof protocolChunks.$inferInsert> = [];
  for (const trial of seededTrials) {
    const primaryProtocol = primaryProtocolByTrialId.get(trial.trialId);
    if (!primaryProtocol) continue;
    const basePage = 6 + (trial.index % 4) * 3;
    const sectionSeed = [
      { name: "Synopsis", pageReference: `p. ${basePage}-${basePage + 2}` },
      { name: "Eligibility", pageReference: `p. ${basePage + 3}-${basePage + 5}` },
      { name: "Schedule of Activities", pageReference: `p. ${basePage + 6}-${basePage + 10}` },
      { name: "Safety", pageReference: `p. ${basePage + 11}-${basePage + 14}` },
    ];
    sectionSeed.forEach((section, sectionIndex) => {
      protocolSectionInserts.push({
        protocolId: String(primaryProtocol.id),
        name: section.name,
        pageReference: section.pageReference,
        dateReference: null,
        orderIndex: sectionIndex,
        parentSectionId: null,
        createdAt: addDays(now, -(10 + sectionIndex + trial.index)),
      });
    });

    const shouldCreateChunks = (indexedDocumentTotalsByTrialId.get(trial.trialId) ?? 0) > 0;
    if (!shouldCreateChunks) continue;

    const chunkSeed = [
      { sectionType: "synopsis", sectionTitle: "Synopsis" },
      { sectionType: "criteria", sectionTitle: "Eligibility Criteria" },
      { sectionType: "visit", sectionTitle: "Schedule of Activities" },
    ];
    chunkSeed.forEach((chunk, chunkIndex) => {
      protocolChunkInserts.push({
        protocolId: String(primaryProtocol.id),
        trialId: trial.trialId,
        chunkIndex,
        sectionType: chunk.sectionType,
        sectionTitle: chunk.sectionTitle,
        pageStart: basePage + chunkIndex * 3,
        pageEnd: basePage + chunkIndex * 3 + 1,
        tokenEstimate: 240 + chunkIndex * 40,
        contentHash: `${mode}-${trial.seed.id}-${chunk.sectionType}-${chunkIndex}`.slice(0, 64),
        chunkText: `${chunk.sectionTitle} guidance for ${trial.seed.title}: coordinator-facing protocol instructions and source-grounded evidence.`,
        metadata: {
          chunkType: chunk.sectionType,
          seeded: true,
          mode,
          trialId: trial.seed.id,
        },
        createdAt: addDays(now, -(8 + chunkIndex + trial.index)),
        updatedAt: addDays(now, -(8 + chunkIndex + trial.index)),
      });
    });
  }
  if (protocolSectionInserts.length > 0) {
    await db.insert(protocolSections).values(protocolSectionInserts);
  }
  if (protocolChunkInserts.length > 0) {
    await db.insert(protocolChunks).values(protocolChunkInserts);
  }

  const scaffoldInserts: Array<typeof taskScaffolds.$inferInsert> = [];
  for (const trial of seededTrials) {
    const primaryProtocol = primaryProtocolByTrialId.get(trial.trialId);
    if (!primaryProtocol) continue;
    const scaffoldStatus = resolveScaffoldStatus(trial.seed.status);
    const confirmedAt = scaffoldStatus === "draft" ? null : addDays(now, -(6 + (trial.index % 7)));
    scaffoldInserts.push({
      protocolId: String(primaryProtocol.id),
      trialId: trial.trialId,
      status: scaffoldStatus,
      confirmedAt,
      confirmedBy: confirmedAt ? createdBy : null,
      createdAt: addDays(now, -(14 + trial.index)),
      updatedAt: addDays(now, -(2 + (trial.index % 4))),
    });
  }
  if (scaffoldInserts.length > 0) {
    await db.insert(taskScaffolds).values(scaffoldInserts);
  }

  const scaffoldRows = await db
    .select()
    .from(taskScaffolds)
    .where(inArray(taskScaffolds.trialId, seededTrialIds));
  const scaffoldByTrialId = new Map(scaffoldRows.map((row) => [row.trialId, row]));

  const phaseInserts: Array<typeof phases.$inferInsert> = [];
  for (const trial of seededTrials) {
    const scaffold = scaffoldByTrialId.get(trial.trialId);
    if (!scaffold) continue;
    LEGACY_PHASE_BLUEPRINT.forEach((phaseBlueprint, phaseIndex) => {
      phaseInserts.push({
        scaffoldId: scaffold.id,
        name: phaseBlueprint.name,
        color: phaseBlueprint.color,
        orderIndex: phaseIndex,
        createdAt: addDays(now, -(12 + phaseIndex + trial.index)),
        updatedAt: addDays(now, -(6 + phaseIndex + trial.index)),
      });
    });
  }
  if (phaseInserts.length > 0) {
    await db.insert(phases).values(phaseInserts);
  }

  const phaseRows = await db
    .select()
    .from(phases)
    .where(inArray(phases.scaffoldId, scaffoldRows.map((row) => row.id)));
  const phasesByScaffoldId = new Map<number, Array<(typeof phaseRows)[number]>>();
  for (const phaseRow of phaseRows) {
    const list = phasesByScaffoldId.get(phaseRow.scaffoldId) ?? [];
    list.push(phaseRow);
    phasesByScaffoldId.set(phaseRow.scaffoldId, list);
  }
  Array.from(phasesByScaffoldId.values()).forEach((list) => {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  });

  const legacyTaskInserts: Array<typeof tasks.$inferInsert> = [];
  for (const trial of seededTrials) {
    const scaffold = scaffoldByTrialId.get(trial.trialId);
    if (!scaffold) continue;
    const scaffoldPhases = phasesByScaffoldId.get(scaffold.id) ?? [];
    for (let phaseIndex = 0; phaseIndex < scaffoldPhases.length; phaseIndex += 1) {
      const phaseRow = scaffoldPhases[phaseIndex];
      const taskNames = LEGACY_TASK_BLUEPRINT[Math.min(phaseIndex, LEGACY_TASK_BLUEPRINT.length - 1)];
      taskNames.forEach((taskName, taskIndex) => {
        legacyTaskInserts.push({
          phaseId: phaseRow.id,
          name: taskName,
          suggestedAssigneeId: SEED_ASSIGNEE_IDS[(trial.index + phaseIndex + taskIndex) % SEED_ASSIGNEE_IDS.length],
          suggestedDate: addDays(trial.startDate, phaseIndex * 14 + taskIndex * 3),
          duration: 2 + ((phaseIndex + taskIndex) % 3),
          protocolSection: phaseIndex === 0 ? "Eligibility" : phaseIndex === 1 ? "SoA" : "Close-out",
          protocolPage: 9 + phaseIndex * 6 + taskIndex * 2,
          status: resolveLegacyTaskStatus(trial.seed.status, phaseIndex, taskIndex),
          orderIndex: taskIndex,
          createdAt: addDays(now, -(10 + phaseIndex + taskIndex + trial.index)),
          updatedAt: addDays(now, -(2 + (trial.index % 5))),
        });
      });
    }
  }
  if (legacyTaskInserts.length > 0) {
    await db.insert(tasks).values(legacyTaskInserts);
  }

  const legacyTaskRows = phaseRows.length > 0
    ? await db.select().from(tasks).where(inArray(tasks.phaseId, phaseRows.map((row) => row.id)))
    : [];
  const tasksByPhaseId = new Map<number, Array<(typeof legacyTaskRows)[number]>>();
  for (const taskRow of legacyTaskRows) {
    const list = tasksByPhaseId.get(taskRow.phaseId) ?? [];
    list.push(taskRow);
    tasksByPhaseId.set(taskRow.phaseId, list);
  }
  Array.from(tasksByPhaseId.values()).forEach((list) => {
    list.sort((a, b) => a.orderIndex - b.orderIndex);
  });

  const taskDependencyInserts: Array<typeof taskDependencies.$inferInsert> = [];
  const phaseTransitionInserts: Array<typeof phaseTransitions.$inferInsert> = [];
  for (const trial of seededTrials) {
    const scaffold = scaffoldByTrialId.get(trial.trialId);
    if (!scaffold) continue;
    const scaffoldPhases = phasesByScaffoldId.get(scaffold.id) ?? [];
    for (let phaseIndex = 0; phaseIndex < scaffoldPhases.length; phaseIndex += 1) {
      const phaseRow = scaffoldPhases[phaseIndex];
      const phaseTasks = tasksByPhaseId.get(phaseRow.id) ?? [];
      for (let taskIndex = 1; taskIndex < phaseTasks.length; taskIndex += 1) {
        taskDependencyInserts.push({
          taskId: phaseTasks[taskIndex].id,
          dependsOnTaskId: phaseTasks[taskIndex - 1].id,
          type: "after",
          createdAt: addDays(now, -(4 + trial.index)),
        });
      }
      if (phaseIndex > 0) {
        phaseTransitionInserts.push({
          fromPhaseId: scaffoldPhases[phaseIndex - 1].id,
          toPhaseId: phaseRow.id,
          condition: null,
          createdAt: addDays(now, -(3 + phaseIndex + trial.index)),
        });
      }
    }
  }
  if (taskDependencyInserts.length > 0) {
    await db.insert(taskDependencies).values(taskDependencyInserts);
  }
  if (phaseTransitionInserts.length > 0) {
    await db.insert(phaseTransitions).values(phaseTransitionInserts);
  }

  const mapInserts: Array<typeof executionMaps.$inferInsert> = [];
  for (const trial of seededTrials) {
    const primaryProtocol = primaryProtocolByTrialId.get(trial.trialId);
    if (!primaryProtocol) continue;
    const mapId = `${mode}-map-${String(trial.index + 1).padStart(3, "0")}`;
    const mapStatus = resolveMapStatus(trial.seed.status);
    mapInserts.push({
      id: mapId,
      trialId: trial.trialId,
      protocolId: String(primaryProtocol.id),
      status: mapStatus,
      version: 1,
      metadata: {
        seeded: true,
        mode,
        trialStatus: trial.seed.status,
        trialTitle: trial.seed.title,
      },
      createdBy,
      createdAt: addDays(now, -(21 + trial.index)),
      launchedAt: mapStatus === "active" || mapStatus === "revised" ? addDays(now, -(11 + trial.index)) : null,
      updatedAt: addDays(now, -(1 + (trial.index % 6))),
    });
  }
  if (mapInserts.length > 0) {
    await db.insert(executionMaps).values(mapInserts);
  }

  const mapPhaseInserts: Array<typeof mapPhases.$inferInsert> = [];
  const mapPhasesByMapId = new Map<string, string[]>();
  for (const trial of seededTrials) {
    const map = mapInserts[trial.index];
    if (!map) continue;
    const phaseIds: string[] = [];
    MAP_PHASE_BLUEPRINT.forEach((phaseBlueprint, phaseIndex) => {
      const phaseId = `${map.id}-ph${phaseIndex + 1}`;
      phaseIds.push(phaseId);
      mapPhaseInserts.push({
        id: phaseId,
        mapId: map.id,
        name: phaseBlueprint.label,
        phaseType: phaseBlueprint.phaseType,
        displayOrder: phaseIndex,
        color: phaseBlueprint.color,
        estimatedDate: addDays(trial.startDate, phaseIndex * 14 + 2),
        windowStart: addDays(trial.startDate, phaseIndex * 14),
        windowEnd: addDays(trial.startDate, phaseIndex * 14 + 5),
        protocolRef: {
          section: phaseBlueprint.label,
          page: 12 + phaseIndex * 4,
          seeded: true,
        },
        canvasX: 110 + phaseIndex * 340,
        canvasY: 120,
        createdAt: addDays(now, -(16 + phaseIndex + trial.index)),
        updatedAt: addDays(now, -(2 + phaseIndex + (trial.index % 4))),
      });
    });
    mapPhasesByMapId.set(map.id, phaseIds);
  }
  if (mapPhaseInserts.length > 0) {
    await db.insert(mapPhases).values(mapPhaseInserts);
  }

  const mapTaskInserts: Array<typeof mapTasks.$inferInsert> = [];
  const mapTaskIdsByMapId = new Map<string, string[]>();
  const mapTaskStatsByTrialId = new Map<
    string,
    { total: number; pending: number; blocked: number; completed: number }
  >();

  for (const trial of seededTrials) {
    const map = mapInserts[trial.index];
    if (!map) continue;
    const phaseIds = mapPhasesByMapId.get(map.id) ?? [];
    const taskIds: string[] = [];
    let runningIndex = 0;
    const trialTaskStats = { total: 0, pending: 0, blocked: 0, completed: 0 };

    for (let phaseIndex = 0; phaseIndex < phaseIds.length; phaseIndex += 1) {
      const phaseId = phaseIds[phaseIndex];
      for (let taskIndex = 0; taskIndex < MAP_TASK_BLUEPRINT.length; taskIndex += 1) {
        const taskBlueprint = MAP_TASK_BLUEPRINT[taskIndex];
        const status = resolveMapTaskStatus(trial.seed.status, phaseIndex, taskIndex);
        const taskId = `${map.id}-t${String(runningIndex + 1).padStart(2, "0")}`;
        runningIndex += 1;
        taskIds.push(taskId);

        const isCompleted = status === "done" || status === "skipped" || status === "cancelled";
        const isBlocked = status === "blocked" || status === "waiting";
        if (isCompleted) trialTaskStats.completed += 1;
        else if (isBlocked) trialTaskStats.blocked += 1;
        else trialTaskStats.pending += 1;
        trialTaskStats.total += 1;

        const dueDate = addDays(trial.startDate, phaseIndex * 14 + taskIndex * 4 + 5);
        const suggestedDate = addDays(trial.startDate, phaseIndex * 14 + taskIndex * 4);
        const assigneeId =
          (runningIndex + trial.index) % 6 === 0
            ? null
            : SEED_ASSIGNEE_IDS[(trial.index + runningIndex) % SEED_ASSIGNEE_IDS.length];
        const assignedRole = MAP_ROLE_ROTATION[(trial.index + runningIndex) % MAP_ROLE_ROTATION.length];
        const createdByMode = (runningIndex + trial.index) % 5 === 0 ? "user" : "ai";
        const timeline =
          mode === "sample" || mode === "full"
            ? computeSeedTaskTimelineDateSet({
                mode,
                seedKey: taskId,
                status,
                now,
              })
            : {
                createdAt: addDays(now, -(11 + trial.index + phaseIndex)),
                updatedAt: addDays(now, -(1 + (trial.index % 3))),
                completedDate: isCompleted ? addDays(suggestedDate, 2) : null,
              };

        mapTaskInserts.push({
          id: taskId,
          phaseId,
          mapId: map.id,
          name: taskBlueprint.name,
          description: taskBlueprint.description,
          category: taskBlueprint.category,
          priority: MAP_PRIORITY_ROTATION[(trial.index + runningIndex) % MAP_PRIORITY_ROTATION.length],
          status,
          blockedReason: status === "blocked" ? "Waiting on sponsor approval package." : null,
          blockedSince: status === "blocked" ? addDays(now, -(2 + (trial.index % 3))) : null,
          assignedRole,
          assignedUserId: assigneeId,
          suggestedAssignee: assigneeId ? SEED_ASSIGNEE_NAMES[assigneeId] : null,
          suggestedDate,
          dueDate,
          estimatedDuration: 1 + ((phaseIndex + taskIndex) % 3),
          startDate: status === "in_progress" || isCompleted ? suggestedDate : null,
          completedDate: timeline.completedDate,
          orderInPhase: taskIndex,
          canvasX: 130 + phaseIndex * 340,
          canvasY: 130 + taskIndex * 130,
          createdBy: createdByMode,
          aiConfidence: createdByMode === "ai" ? 0.72 + ((stableHash(taskId) % 20) / 100) : null,
          conditionalNote: status === "waiting" ? "Pending final site confirmation." : null,
          isCustom: createdByMode === "user",
          tags: ["seed", mode, taskBlueprint.category],
          protocolRefs: [
            {
              protocolId: map.protocolId,
              section: taskBlueprint.section,
              page: 12 + phaseIndex * 4 + taskIndex,
              confidence: 0.84,
            },
          ],
          createdAt: timeline.createdAt,
          updatedAt: timeline.updatedAt,
        });
      }
    }

    mapTaskIdsByMapId.set(map.id, taskIds);
    mapTaskStatsByTrialId.set(trial.trialId, trialTaskStats);
  }
  if (mapTaskInserts.length > 0) {
    await db.insert(mapTasks).values(mapTaskInserts);
  }

  const trialIdByMapId = new Map(mapInserts.map((map) => [map.id, map.trialId]));
  const mapTaskStatusHistoryInserts: Array<typeof mapTaskStatusHistory.$inferInsert> = mapTaskInserts.map((task) => {
    const trialId = trialIdByMapId.get(task.mapId) ?? task.mapId;
    const toStatus = (task.status ?? "suggested") as NonNullable<typeof task.status>;
    const enteredAt =
      toStatus === "blocked" && task.blockedSince
        ? task.blockedSince
        : toStatus === "done" && task.completedDate
        ? task.completedDate
        : task.updatedAt ?? task.createdAt ?? now;
    return {
      id: `${task.id}-h1`,
      mapId: task.mapId,
      trialId,
      taskId: task.id,
      fromStatus: null,
      toStatus,
      reason: task.blockedReason ?? null,
      source: "seed",
      changedBy: createdBy,
      enteredAt,
      exitedAt: null,
      durationSeconds: null,
      createdAt: enteredAt,
    };
  });
  if (mapTaskStatusHistoryInserts.length > 0) {
    await db.insert(mapTaskStatusHistory).values(mapTaskStatusHistoryInserts);
  }

  const mapDependencyInserts: Array<typeof mapTaskDependencies.$inferInsert> = [];
  for (const trial of seededTrials) {
    const map = mapInserts[trial.index];
    if (!map) continue;
    const taskIds = mapTaskIdsByMapId.get(map.id) ?? [];
    for (let index = 1; index < taskIds.length; index += 1) {
      mapDependencyInserts.push({
        id: `${map.id}-dep${String(index).padStart(2, "0")}`,
        sourceTaskId: taskIds[index - 1],
        targetTaskId: taskIds[index],
        dependencyType: "finish_to_start",
        conditionLabel: null,
        isCrossPhase: index % MAP_TASK_BLUEPRINT.length === 0,
        createdAt: addDays(now, -(5 + (index % 3))),
      });
    }
  }
  if (mapDependencyInserts.length > 0) {
    await db.insert(mapTaskDependencies).values(mapDependencyInserts);
  }

  const mapTransitionInserts: Array<typeof mapPhaseTransitions.$inferInsert> = [];
  for (const trial of seededTrials) {
    const map = mapInserts[trial.index];
    if (!map) continue;
    const phaseIds = mapPhasesByMapId.get(map.id) ?? [];
    for (let phaseIndex = 1; phaseIndex < phaseIds.length; phaseIndex += 1) {
      mapTransitionInserts.push({
        id: `${map.id}-tr${phaseIndex}`,
        fromPhaseId: phaseIds[phaseIndex - 1],
        toPhaseId: phaseIds[phaseIndex],
        conditionLabel: null,
        isDefault: true,
        createdAt: addDays(now, -(7 + phaseIndex + trial.index)),
      });
    }
  }
  if (mapTransitionInserts.length > 0) {
    await db.insert(mapPhaseTransitions).values(mapTransitionInserts);
  }

  const protocolMapSectionInserts: Array<typeof protocolMapSections.$inferInsert> = [];
  for (const trial of seededTrials) {
    const map = mapInserts[trial.index];
    if (!map) continue;
    const phaseIds = mapPhasesByMapId.get(map.id) ?? [];
    const taskIds = mapTaskIdsByMapId.get(map.id) ?? [];
    const sectionSeed = [
      { idSuffix: "soa", name: "Schedule of Activities", type: "schedule" as const, page: 14 },
      { idSuffix: "elig", name: "Eligibility", type: "eligibility" as const, page: 8 },
      { idSuffix: "safety", name: "Safety Reporting", type: "safety" as const, page: 36 },
      { idSuffix: "proc", name: "Procedure Workflow", type: "procedure" as const, page: 22 },
    ];
    sectionSeed.forEach((section, sectionIndex) => {
      protocolMapSectionInserts.push({
        id: `${map.id}-sec-${section.idSuffix}`,
        protocolId: map.protocolId,
        mapId: map.id,
        name: section.name,
        sectionType: section.type,
        pageStart: section.page,
        pageEnd: section.page + 2,
        dateReference: addDays(trial.startDate, sectionIndex * 6),
        parentSectionId: null,
        linkedPhaseIds: phaseIds.slice(Math.max(0, sectionIndex - 1), Math.min(phaseIds.length, sectionIndex + 1)),
        linkedTaskIds: taskIds.slice(sectionIndex * 2, sectionIndex * 2 + 3),
        displayOrder: sectionIndex,
        isChecked: sectionIndex !== 2 || trial.seed.status !== "not-started",
        createdAt: addDays(now, -(8 + sectionIndex + trial.index)),
      });
    });
  }
  if (protocolMapSectionInserts.length > 0) {
    await db.insert(protocolMapSections).values(protocolMapSectionInserts);
  }

  const mapTelemetryInserts: Array<typeof mapTelemetryEvents.$inferInsert> = [];
  for (const trial of seededTrials) {
    const map = mapInserts[trial.index];
    if (!map) continue;
    const taskIds = mapTaskIdsByMapId.get(map.id) ?? [];
    const telemetrySeed = [
      "map.generated",
      "task.accepted",
      "task.modified",
      "task.modified",
      "map.launched",
    ];
    telemetrySeed.forEach((eventType, eventIndex) => {
      mapTelemetryInserts.push({
        id: `${map.id}-ev${eventIndex + 1}`,
        mapId: map.id,
        trialId: trial.trialId,
        eventType,
        userId: createdBy,
        targetId: taskIds[eventIndex] ?? null,
        targetType: taskIds[eventIndex] ? "task" : "map",
        payload: {
          seeded: true,
          mode,
          trialId: trial.seed.id,
          eventIndex,
        },
        createdAt: addDays(now, -(13 - eventIndex + trial.index)),
      });
    });
  }
  if (mapTelemetryInserts.length > 0) {
    await db.insert(mapTelemetryEvents).values(mapTelemetryInserts);
  }

  const featureSnapshotInserts: Array<typeof aiFeatureSnapshots.$inferInsert> = [];
  const rollupInserts: Array<typeof aiAnalyticsRollups.$inferInsert> = [];
  for (const trial of seededTrials) {
    const taskStats = mapTaskStatsByTrialId.get(trial.trialId) ?? {
      total: 0,
      pending: 0,
      blocked: 0,
      completed: 0,
    };
    const documentTotal = documentTotalsByTrialId.get(trial.trialId) ?? 0;
    const documentIndexed = indexedDocumentTotalsByTrialId.get(trial.trialId) ?? 0;
    const docCoverage = documentTotal > 0 ? Math.round((documentIndexed / documentTotal) * 100) : 0;
    const statusBoost =
      trial.seed.status === "active" || trial.seed.status === "recruiting"
        ? 16
        : trial.seed.status === "completed"
        ? 24
        : trial.seed.status === "on-hold"
        ? -10
        : trial.seed.status === "terminated"
        ? -18
        : -6;
    const readinessScore = Math.max(
      8,
      Math.min(98, 46 + statusBoost + Math.round(docCoverage * 0.35) + taskStats.completed * 2 - taskStats.blocked * 3)
    );
    const riskScore = Math.max(
      5,
      Math.min(99, 18 + taskStats.blocked * 14 + (trial.seed.status === "terminated" ? 18 : 0) + (100 - docCoverage) / 3)
    );
    const aiCoverageScore = Math.max(0, Math.min(100, Math.round(docCoverage * 0.8 + readinessScore * 0.2)));

    featureSnapshotInserts.push({
      trialId: trial.trialId,
      snapshotDate: toYyyyMmDd(addDays(now, -1)),
      snapshotVersion: "v1",
      featureVector: {
        seeded: true,
        mode,
        documentTotal,
        documentIndexed,
        taskStats,
        trialStatus: trial.seed.status,
      },
      readinessScore,
      riskScore,
      aiCoverageScore,
      createdAt: addDays(now, -1),
    });

    const trialHash = stableHash(trial.seed.id);
    for (let dayOffset = 13; dayOffset >= 0; dayOffset -= 1) {
      const dayDate = addDays(now, -dayOffset);
      const wave = ((trialHash + dayOffset * 13) % 7) - 3;
      const telemetryEvents7d = Math.max(4, 14 + (trialHash % 17) + wave);
      const aiInvolvedEvents7d = Math.max(1, Math.round(telemetryEvents7d * (0.42 + ((trialHash % 11) / 100))));
      const aiUsageRateBps =
        telemetryEvents7d > 0 ? Math.max(0, Math.min(10000, Math.round((aiInvolvedEvents7d / telemetryEvents7d) * 10000))) : 0;
      const taskPending = Math.max(0, taskStats.pending + ((trialHash + dayOffset) % 3) - 1);
      const taskBlocked = Math.max(0, taskStats.blocked + ((trialHash + dayOffset * 2) % 2));
      const taskCompleted = Math.max(0, Math.min(taskStats.total, taskStats.completed + (13 - dayOffset)));
      const rollingRisk = Math.max(0, Math.min(100, riskScore + taskBlocked * 3 - Math.floor(taskCompleted / 2)));

      rollupInserts.push({
        trialId: trial.trialId,
        rollupDate: toYyyyMmDd(dayDate),
        documentTotal,
        documentIndexed,
        taskTotal: taskStats.total,
        taskPending,
        taskBlocked,
        taskCompleted,
        telemetryEvents7d,
        aiInvolvedEvents7d,
        aiUsageRateBps,
        riskScore: rollingRisk,
        createdAt: dayDate,
        updatedAt: dayDate,
      });
    }
  }

  if (featureSnapshotInserts.length > 0) {
    await db.insert(aiFeatureSnapshots).values(featureSnapshotInserts);
  }
  if (rollupInserts.length > 0) {
    await db.insert(aiAnalyticsRollups).values(rollupInserts);
  }
}

async function seedBaseModeData(
  mode: DemoMode,
  createdBy: number,
  dbClient?: DbClient
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  // documentCategories is a global (non-trial-scoped) lookup table the
  // Documents UI dropdown reads from. Seed it for every mode — the
  // building-mode UI still needs categories to render category picks
  // even though the rest of building-mode is intentionally empty.
  // seedCategories uses ON DUPLICATE KEY UPDATE so it's idempotent.
  await seedCategories(db);

  if (mode === "sample") {
    await seedTrials(SAMPLE_TRIALS, createdBy, "sample", db);
    try {
      await seedModeOperationalData(SAMPLE_TRIALS, createdBy, "sample", db);
    } catch (error) {
      console.warn("[demo] Sample mode operational seed skipped due to schema compatibility issue.", error);
    }
    // Create BE-owned trials and re-key the just-seeded child data by the BE
    // UUID so the BE-sourced trial list + child lookups resolve. Best-effort:
    // failures leave child data keyed by the prefixed id (logged inside).
    try {
      const beUuids = await ensureBeTrialsForSeed(db, SAMPLE_TRIALS, "sample");
      await rekeySeededChildData(db, beUuids);
    } catch (error) {
      console.warn("[demo] Sample mode BE trial sync / re-key skipped.", error);
    }
    return;
  }
  if (mode === "full") {
    await seedTrials(FULL_TRIALS, createdBy, "full", db);
    try {
      await seedModeOperationalData(FULL_TRIALS, createdBy, "full", db);
    } catch (error) {
      console.warn("[demo] Full mode operational seed skipped due to schema compatibility issue.", error);
    }
    try {
      const beUuids = await ensureBeTrialsForSeed(db, FULL_TRIALS, "full");
      await rekeySeededChildData(db, beUuids);
    } catch (error) {
      console.warn("[demo] Full mode BE trial sync / re-key skipped.", error);
    }
    return;
  }
  // Building mode baseline is otherwise intentionally empty (no trials,
  // no operational data) — categories were seeded above.
}

async function ensureModeOperationalSeed(
  mode: "sample" | "full",
  data: typeof SAMPLE_TRIALS,
  createdBy: number,
  dbClient?: DbClient
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  // Trials are BE-owned. If the BE has no demo trials for this mode there is
  // nothing to backfill operational data against.
  const beTrials = await listBeTrials(mode);
  if (beTrials.length === 0) return false;

  // Child data is keyed by the BE trial UUID; check for an existing map by it.
  const trialIds = beTrials.map((row) => String(row.id));
  const existingMap = await db
    .select({ id: executionMaps.id })
    .from(executionMaps)
    .where(inArray(executionMaps.trialId, trialIds))
    .limit(1);

  if (existingMap.length > 0) return false;

  try {
    await seedModeOperationalData(data, createdBy, mode, db);
    return true;
  } catch (error) {
    console.warn(`[demo] ${mode} mode operational backfill skipped due to schema compatibility issue.`, error);
    return false;
  }
}

async function resetModeToDefault(
  mode: DemoMode,
  createdBy: number,
  dbClient?: DbClient,
  options?: { modeAlreadyWiped?: boolean }
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  if (!options?.modeAlreadyWiped) {
    await wipeModeData(mode, db);
  }

  const savedSnapshot = await readSavedModeSnapshot(db, mode);
  if (savedSnapshot) {
    try {
      await restoreModeSnapshot(savedSnapshot, db);
      // Seed categories for every mode — they're a global lookup table
      // the Documents UI needs. Idempotent via ON DUPLICATE KEY UPDATE.
      await seedCategories(db);
      return { restoredFromSavedDefault: true };
    } catch (error) {
      console.error(`[demo] Failed restoring saved default for mode '${mode}', falling back to base seed.`, error);
      await wipeModeData(mode, db);
    }
  }

  await seedBaseModeData(mode, createdBy, db);
  return { restoredFromSavedDefault: false };
}

function remapLinkedIds(value: unknown, idMap: Map<string, string>) {
  if (!Array.isArray(value)) return value;
  return value.map((entry) => {
    if (typeof entry !== "string") return entry;
    return idMap.get(entry) ?? entry;
  });
}

function remapKnownEntityId(
  value: string | null | undefined,
  idMaps: Array<Map<string, string>>
) {
  if (!value) return value ?? null;
  for (const idMap of idMaps) {
    const next = idMap.get(value);
    if (next) return next;
  }
  return value;
}

async function cloneModeIntoBuilding(
  sourceMode: DemoMode,
  createdBy: number,
  dbClient?: DbClient
) {
  if (sourceMode === "building") {
    throw new Error("Building mode cannot be copied into itself.");
  }

  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  await ensureMapTaskStatusHistoryTable(db);
  await seedCategories(db);

  const sourceSnapshot = await captureModeSnapshot(sourceMode, db);
  const rows = normalizeSnapshotRows(sourceSnapshot.rows);

  await db.transaction(async (tx) => {
    await wipeModeData("building", tx as unknown as DbClient);

    const trialIdMap = new Map<string, string>();
    const protocolIdMap = new Map<number, number>();
    const protocolSectionIdMap = new Map<number, number>();
    const scaffoldIdMap = new Map<number, number>();
    const phaseIdMap = new Map<number, number>();
    const taskIdMap = new Map<number, number>();
    const mapIdMap = new Map<string, string>();
    const mapPhaseIdMap = new Map<string, string>();
    const mapTaskIdMap = new Map<string, string>();
    const protocolMapSectionIdMap = new Map<string, string>();

    // Trials are BE-owned. `rows.trials` now holds the SOURCE BE trial objects
    // (from collectModeRows -> listBeTrials). Source child rows are keyed by the
    // SOURCE BE UUID (`row.id`). For each source trial we create a fresh BE trial
    // under demo_mode "building" and re-key child trialId from the source BE UUID
    // -> the new building BE UUID. No FE `trials` row is written.
    const trialRows = asTypedRows<Record<string, any>>(rows.trials);
    for (const sourceRow of trialRows) {
      const sourceBeId = String(sourceRow.id);
      // Reuse the source BE trial's fields, retagged for the building copy.
      const {
        id: _id,
        slug: _slug,
        demo_mode: _demoMode,
        organization_id: _org,
        created_by: _createdBy,
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...rest
      } = sourceRow;
      const body = { ...rest, demo_mode: "building", name: sourceRow.name ?? "Untitled Trial" };
      try {
        // "building" was wiped above, so always create a fresh BE trial (UUID
        // assigned by the BE) and map source UUID -> building UUID.
        const beTrial: any = await callBackend(`/api/trials/with-assignments`, {
          method: "POST",
          body: { ...body, members: [], pending_members: [] },
        });
        const beId: string | null = beTrial?.id ?? null;
        if (beId) {
          // Child data is keyed by the SOURCE BE UUID -> building BE UUID.
          trialIdMap.set(sourceBeId, beId);
        }
      } catch (error) {
        console.warn(
          `[demo] Failed to create BE trial for building copy of ${sourceBeId}; child data keeps its source key.`,
          error
        );
      }
    }

    const protocolRows = asTypedRows<typeof protocols.$inferSelect>(rows.protocols);
    for (const row of protocolRows) {
      const { id: _protocolId, ...protocolInsert } = row;
      const [inserted] = await tx
        .insert(protocols).values({...protocolInsert, trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId)}).returning({ id: protocols.id });
      if (typeof inserted?.id === "number") {
        protocolIdMap.set(Number(row.id), inserted.id);
      }
    }

    const protocolSectionRows = asTypedRows<typeof protocolSections.$inferSelect>(rows.protocolSections);
    for (const row of protocolSectionRows) {
      const { id: _protocolSectionId, ...protocolSectionInsert } = row;
      const [inserted] = await tx
        .insert(protocolSections).values({...protocolSectionInsert, protocolId: String(protocolIdMap.get(Number(row.protocolId)) ?? Number(row.protocolId)), parentSectionId: null}).returning({ id: protocolSections.id });
      if (typeof inserted?.id === "number") {
        protocolSectionIdMap.set(Number(row.id), inserted.id);
      }
    }
    for (const row of protocolSectionRows) {
      if (!row.parentSectionId) continue;
      const nextId = protocolSectionIdMap.get(Number(row.id));
      const nextParentId = protocolSectionIdMap.get(Number(row.parentSectionId));
      if (!nextId || !nextParentId) continue;
      await tx
        .update(protocolSections)
        .set({ parentSectionId: nextParentId })
        .where(eq(protocolSections.id, nextId));
    }

    const protocolChunkRows = asTypedRows<typeof protocolChunks.$inferSelect>(rows.protocolChunks);
    for (const row of protocolChunkRows) {
      const { id: _protocolChunkId, ...protocolChunkInsert } = row;
      await tx.insert(protocolChunks).values({
        ...protocolChunkInsert,
        protocolId: String(protocolIdMap.get(Number(row.protocolId)) ?? Number(row.protocolId)),
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
      });
    }

    const scaffoldRows = asTypedRows<typeof taskScaffolds.$inferSelect>(rows.taskScaffolds);
    for (const row of scaffoldRows) {
      const { id: _scaffoldId, ...scaffoldInsert } = row;
      const [inserted] = await tx
        .insert(taskScaffolds).values({...scaffoldInsert, protocolId: String(protocolIdMap.get(Number(row.protocolId)) ?? Number(row.protocolId)), trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId)}).returning({ id: taskScaffolds.id });
      if (typeof inserted?.id === "number") {
        scaffoldIdMap.set(Number(row.id), inserted.id);
      }
    }

    const phaseRows = asTypedRows<typeof phases.$inferSelect>(rows.phases);
    for (const row of phaseRows) {
      const { id: _phaseId, ...phaseInsert } = row;
      const [inserted] = await tx
        .insert(phases).values({...phaseInsert, scaffoldId: scaffoldIdMap.get(Number(row.scaffoldId)) ?? Number(row.scaffoldId)}).returning({ id: phases.id });
      if (typeof inserted?.id === "number") {
        phaseIdMap.set(Number(row.id), inserted.id);
      }
    }

    const taskRows = asTypedRows<typeof tasks.$inferSelect>(rows.tasks);
    for (const row of taskRows) {
      const { id: _taskId, ...taskInsert } = row;
      const [inserted] = await tx
        .insert(tasks).values({...taskInsert, phaseId: phaseIdMap.get(Number(row.phaseId)) ?? Number(row.phaseId)}).returning({ id: tasks.id });
      if (typeof inserted?.id === "number") {
        taskIdMap.set(Number(row.id), inserted.id);
      }
    }

    const taskDependencyRows = asTypedRows<typeof taskDependencies.$inferSelect>(rows.taskDependencies);
    for (const row of taskDependencyRows) {
      const { id: _taskDependencyId, ...taskDependencyInsert } = row;
      await tx.insert(taskDependencies).values({
        ...taskDependencyInsert,
        taskId: taskIdMap.get(Number(row.taskId)) ?? Number(row.taskId),
        dependsOnTaskId: taskIdMap.get(Number(row.dependsOnTaskId)) ?? Number(row.dependsOnTaskId),
      });
    }

    const phaseTransitionRows = asTypedRows<typeof phaseTransitions.$inferSelect>(rows.phaseTransitions);
    for (const row of phaseTransitionRows) {
      const { id: _phaseTransitionId, ...phaseTransitionInsert } = row;
      await tx.insert(phaseTransitions).values({
        ...phaseTransitionInsert,
        fromPhaseId: phaseIdMap.get(Number(row.fromPhaseId)) ?? Number(row.fromPhaseId),
        toPhaseId: phaseIdMap.get(Number(row.toPhaseId)) ?? Number(row.toPhaseId),
      });
    }

    const mapRows = asTypedRows<typeof executionMaps.$inferSelect>(rows.executionMaps);
    for (const row of mapRows) {
      const nextMapId = randomUUID();
      mapIdMap.set(String(row.id), nextMapId);
      await tx.insert(executionMaps).values({
        ...row,
        id: nextMapId,
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
        protocolId: String(protocolIdMap.get(Number(row.protocolId)) ?? Number(row.protocolId)),
      });
    }

    const mapPhaseRows = asTypedRows<typeof mapPhases.$inferSelect>(rows.mapPhases);
    for (const row of mapPhaseRows) {
      const nextMapPhaseId = randomUUID();
      mapPhaseIdMap.set(String(row.id), nextMapPhaseId);
      await tx.insert(mapPhases).values({
        ...row,
        id: nextMapPhaseId,
        mapId: mapIdMap.get(String(row.mapId)) ?? String(row.mapId),
      });
    }

    const mapTaskRows = asTypedRows<typeof mapTasks.$inferSelect>(rows.mapTasks);
    for (const row of mapTaskRows) {
      const nextMapTaskId = randomUUID();
      mapTaskIdMap.set(String(row.id), nextMapTaskId);
      await tx.insert(mapTasks).values({
        ...row,
        id: nextMapTaskId,
        phaseId: mapPhaseIdMap.get(String(row.phaseId)) ?? String(row.phaseId),
        mapId: mapIdMap.get(String(row.mapId)) ?? String(row.mapId),
      });
    }

    const mapTaskDependencyRows = asTypedRows<typeof mapTaskDependencies.$inferSelect>(rows.mapTaskDependencies);
    for (const row of mapTaskDependencyRows) {
      await tx.insert(mapTaskDependencies).values({
        ...row,
        id: randomUUID(),
        sourceTaskId: mapTaskIdMap.get(String(row.sourceTaskId)) ?? String(row.sourceTaskId),
        targetTaskId: mapTaskIdMap.get(String(row.targetTaskId)) ?? String(row.targetTaskId),
      });
    }

    const mapPhaseTransitionRows = asTypedRows<typeof mapPhaseTransitions.$inferSelect>(rows.mapPhaseTransitions);
    for (const row of mapPhaseTransitionRows) {
      await tx.insert(mapPhaseTransitions).values({
        ...row,
        id: randomUUID(),
        fromPhaseId: mapPhaseIdMap.get(String(row.fromPhaseId)) ?? String(row.fromPhaseId),
        toPhaseId: mapPhaseIdMap.get(String(row.toPhaseId)) ?? String(row.toPhaseId),
      });
    }

    const protocolMapSectionRows = asTypedRows<typeof protocolMapSections.$inferSelect>(rows.protocolMapSections);
    for (const row of protocolMapSectionRows) {
      const nextSectionId = randomUUID();
      protocolMapSectionIdMap.set(String(row.id), nextSectionId);
      await tx.insert(protocolMapSections).values({
        ...row,
        id: nextSectionId,
        protocolId: String(protocolIdMap.get(Number(row.protocolId)) ?? Number(row.protocolId)),
        mapId: mapIdMap.get(String(row.mapId)) ?? String(row.mapId),
        parentSectionId: null,
        linkedPhaseIds: remapLinkedIds(row.linkedPhaseIds, mapPhaseIdMap),
        linkedTaskIds: remapLinkedIds(row.linkedTaskIds, mapTaskIdMap),
      });
    }
    for (const row of protocolMapSectionRows) {
      if (!row.parentSectionId) continue;
      const nextId = protocolMapSectionIdMap.get(String(row.id));
      const nextParentId = protocolMapSectionIdMap.get(String(row.parentSectionId));
      if (!nextId || !nextParentId) continue;
      await tx
        .update(protocolMapSections)
        .set({ parentSectionId: nextParentId })
        .where(eq(protocolMapSections.id, nextId));
    }

    const mapTelemetryRows = asTypedRows<typeof mapTelemetryEvents.$inferSelect>(rows.mapTelemetryEvents);
    for (const row of mapTelemetryRows) {
      await tx.insert(mapTelemetryEvents).values({
        ...row,
        id: randomUUID(),
        mapId: mapIdMap.get(String(row.mapId)) ?? String(row.mapId),
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
        targetId: remapKnownEntityId(row.targetId, [mapTaskIdMap, mapPhaseIdMap, mapIdMap]),
      });
    }

    const mapTaskStatusHistoryRows = asTypedRows<typeof mapTaskStatusHistory.$inferSelect>(rows.mapTaskStatusHistory);
    for (const row of mapTaskStatusHistoryRows) {
      await tx.insert(mapTaskStatusHistory).values({
        ...row,
        id: randomUUID(),
        mapId: mapIdMap.get(String(row.mapId)) ?? String(row.mapId),
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
        taskId: mapTaskIdMap.get(String(row.taskId)) ?? String(row.taskId),
      });
    }

    const aiFeatureSnapshotRows = asTypedRows<typeof aiFeatureSnapshots.$inferSelect>(rows.aiFeatureSnapshots);
    for (const row of aiFeatureSnapshotRows) {
      const { id: _aiFeatureSnapshotId, ...aiFeatureSnapshotInsert } = row;
      await tx.insert(aiFeatureSnapshots).values({
        ...aiFeatureSnapshotInsert,
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
      });
    }

    const aiAnalyticsRollupRows = asTypedRows<typeof aiAnalyticsRollups.$inferSelect>(rows.aiAnalyticsRollups);
    for (const row of aiAnalyticsRollupRows) {
      const { id: _aiAnalyticsRollupId, ...aiAnalyticsRollupInsert } = row;
      await tx.insert(aiAnalyticsRollups).values({
        ...aiAnalyticsRollupInsert,
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
      });
    }

    const aiTrainingExampleRows = asTypedRows<typeof aiTrainingExamples.$inferSelect>(rows.aiTrainingExamples);
    for (const row of aiTrainingExampleRows) {
      const { id: _aiTrainingExampleId, ...aiTrainingExampleInsert } = row;
      await tx.insert(aiTrainingExamples).values({
        ...aiTrainingExampleInsert,
        trialId: row.trialId ? trialIdMap.get(String(row.trialId)) ?? String(row.trialId) : null,
      });
    }

    const knowledgeGraphNodeRows = asTypedRows<typeof knowledgeGraphNodes.$inferSelect>(rows.knowledgeGraphNodes);
    for (const row of knowledgeGraphNodeRows) {
      const { id: _knowledgeGraphNodeId, ...knowledgeGraphNodeInsert } = row;
      await tx.insert(knowledgeGraphNodes).values({
        ...knowledgeGraphNodeInsert,
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
      });
    }

    const knowledgeGraphEdgeRows = asTypedRows<typeof knowledgeGraphEdges.$inferSelect>(rows.knowledgeGraphEdges);
    for (const row of knowledgeGraphEdgeRows) {
      const { id: _knowledgeGraphEdgeId, ...knowledgeGraphEdgeInsert } = row;
      await tx.insert(knowledgeGraphEdges).values({
        ...knowledgeGraphEdgeInsert,
        trialId: trialIdMap.get(String(row.trialId)) ?? String(row.trialId),
      });
    }
  });

  const buildingSnapshot = await captureModeSnapshot("building", db);
  await writeSavedModeSnapshot(db, "building", buildingSnapshot, createdBy);

  return {
    ok: true,
    sourceMode,
    copiedTrials: asTypedRows<Record<string, unknown>>(rows.trials).length,
    copiedProtocols: asTypedRows<typeof protocols.$inferSelect>(rows.protocols).length,
    copiedMaps: asTypedRows<typeof executionMaps.$inferSelect>(rows.executionMaps).length,
    skippedFileSearchStores: asTypedRows<typeof fileSearchStores.$inferSelect>(rows.fileSearchStores).length,
    skippedCollaborationRecords:
      asTypedRows<typeof conversations.$inferSelect>(rows.conversations).length +
      asTypedRows<typeof threads.$inferSelect>(rows.threads).length +
      asTypedRows<typeof trialInboxes.$inferSelect>(rows.trialInboxes).length,
  };
}

export const demoRouter = router({
  resetToEmpty: protectedProcedure.mutation(async () => {
    await wipeModeData("building");
    return { ok: true };
  }),

  saveModeDefault: protectedProcedure
    .input(z.object({ mode: demoModeSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const snapshot = await captureModeSnapshot(input.mode, db);
      await writeSavedModeSnapshot(db, input.mode, snapshot, ctx.user.id);
      return {
        ok: true,
        mode: input.mode,
        restoredTrialCount: snapshot.rows.trials.length,
      };
    }),

  loadSampleData: protectedProcedure
    .input(modeLoadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const shouldResetToDefault = input?.resetToDefault === true;
      if (shouldResetToDefault) {
        const result = await resetModeToDefault("sample", ctx.user.id, db);
        const backfilledOperationalData = await ensureModeOperationalSeed(
          "sample",
          SAMPLE_TRIALS,
          ctx.user.id,
          db
        );
        const rebalancedTaskTimelines = await rebalanceSeedTaskTimelines("sample", db);
        return {
          ok: true,
          mode: "sample" as const,
          ...result,
          backfilledOperationalData,
          rebalancedTaskTimelines,
        };
      }

      // Trials are BE-owned: check the BE for any seeded demo trial in this mode.
      const existing = await listBeTrials("sample");

      if (existing.length === 0) {
        const result = await resetModeToDefault("sample", ctx.user.id, db);
        const backfilledOperationalData = await ensureModeOperationalSeed(
          "sample",
          SAMPLE_TRIALS,
          ctx.user.id,
          db
        );
        const rebalancedTaskTimelines = await rebalanceSeedTaskTimelines("sample", db);
        return {
          ok: true,
          mode: "sample" as const,
          ...result,
          backfilledOperationalData,
          rebalancedTaskTimelines,
        };
      }

      const backfilledOperationalData = await ensureModeOperationalSeed(
        "sample",
        SAMPLE_TRIALS,
        ctx.user.id,
        db
      );
      const rebalancedTaskTimelines = await rebalanceSeedTaskTimelines("sample", db);
      return {
        ok: true,
        mode: "sample" as const,
        restoredFromSavedDefault: false,
        backfilledOperationalData,
        rebalancedTaskTimelines,
      };
    }),

  loadFullDataset: protectedProcedure
    .input(modeLoadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const shouldResetToDefault = input?.resetToDefault === true;
      if (shouldResetToDefault) {
        const result = await resetModeToDefault("full", ctx.user.id, db);
        const backfilledOperationalData = await ensureModeOperationalSeed(
          "full",
          FULL_TRIALS,
          ctx.user.id,
          db
        );
        const rebalancedTaskTimelines = await rebalanceSeedTaskTimelines("full", db);
        return {
          ok: true,
          mode: "full" as const,
          ...result,
          backfilledOperationalData,
          rebalancedTaskTimelines,
        };
      }

      // Trials are BE-owned: check the BE for any seeded demo trial in this mode.
      const existing = await listBeTrials("full");

      if (existing.length === 0) {
        const result = await resetModeToDefault("full", ctx.user.id, db);
        const backfilledOperationalData = await ensureModeOperationalSeed(
          "full",
          FULL_TRIALS,
          ctx.user.id,
          db
        );
        const rebalancedTaskTimelines = await rebalanceSeedTaskTimelines("full", db);
        return {
          ok: true,
          mode: "full" as const,
          ...result,
          backfilledOperationalData,
          rebalancedTaskTimelines,
        };
      }

      const backfilledOperationalData = await ensureModeOperationalSeed(
        "full",
        FULL_TRIALS,
        ctx.user.id,
        db
      );
      const rebalancedTaskTimelines = await rebalanceSeedTaskTimelines("full", db);
      return {
        ok: true,
        mode: "full" as const,
        restoredFromSavedDefault: false,
        backfilledOperationalData,
        rebalancedTaskTimelines,
      };
    }),

  loadBuildingMode: protectedProcedure
    .input(modeLoadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const shouldResetToDefault = input?.resetToDefault === true;
      if (!shouldResetToDefault) {
        return { ok: true, mode: "building" as const, restoredFromSavedDefault: false };
      }
      const result = await resetModeToDefault("building", ctx.user.id, db);
      return { ok: true, mode: "building" as const, ...result };
    }),

  cloneCurrentModeToBuilding: protectedProcedure
    .input(z.object({ sourceMode: z.enum(["sample", "full"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      return cloneModeIntoBuilding(input.sourceMode, ctx.user.id, db);
    }),

  fullReset: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    await wipeModeData("all", db);
    const sampleResult = await resetModeToDefault("sample", ctx.user.id, db, { modeAlreadyWiped: true });
    const fullResult = await resetModeToDefault("full", ctx.user.id, db, { modeAlreadyWiped: true });
    const buildingResult = await resetModeToDefault("building", ctx.user.id, db, {
      modeAlreadyWiped: true,
    });

    return {
      ok: true,
      restoredFromSavedDefault: {
        sample: sampleResult.restoredFromSavedDefault,
        full: fullResult.restoredFromSavedDefault,
        building: buildingResult.restoredFromSavedDefault,
      },
    };
  }),
});
