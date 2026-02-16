import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
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
  trials,
} from "../drizzle/schema";
import { toDemoId, type DemoMode } from "./_core/demoMode";
import { inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";

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
    startDate: new Date("2025-05-01"),
    endDate: new Date("2030-05-01"),
  },
  "jkl-012": {
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
    startDate: new Date("2025-04-01"),
    endDate: new Date("2028-04-01"),
  },
  "stu-901": {
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
    startDate: new Date("2025-10-10"),
    endDate: new Date("2027-10-10"),
  },
  "rst-012": {
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
  await db.execute(sql.raw(DEMO_MODE_DEFAULTS_TABLE_SQL));
  demoModeDefaultsTableReady = true;
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
  const trialRows = mode === "all"
    ? await tx.select().from(trials)
    : await tx
        .select()
        .from(trials)
        .where(like(trials.id, `${mode}:%`));
  const trialIds = trialRows.map((row) => row.id);

  if (trialIds.length === 0) {
    return {
      rows: emptySnapshotRows(),
      trialIds: [],
      protocolIds: [],
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

  const protocolSectionRows = protocolIds.length > 0
    ? await tx
        .select()
        .from(protocolSections)
        .where(inArray(protocolSections.protocolId, protocolIds))
    : [];

  const protocolChunkRows = protocolIds.length > 0
    ? await tx
        .select()
        .from(protocolChunks)
        .where(inArray(protocolChunks.protocolId, protocolIds))
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
              inArray(fileSearchDocuments.protocolId, protocolIds),
              inArray(fileSearchDocuments.storeId, storeIds)
            )
          )
      : protocolIds.length > 0
      ? await tx
          .select()
          .from(fileSearchDocuments)
          .where(inArray(fileSearchDocuments.protocolId, protocolIds))
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
  const rows = normalizeSnapshotRows(snapshot.rows);
  await db.transaction(async (tx) => {
    await insertSnapshotRows(tx, trials, rows.trials, {
      dateFields: ["startDate", "endDate", "createdAt", "updatedAt"],
    });
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

  await db.transaction(async (tx) => {
    const collected = await collectModeRows(tx, mode);
    const {
      trialIds,
      protocolIds,
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
        .where(inArray(protocolSections.protocolId, protocolIds));
      await tx
        .delete(protocolChunks)
        .where(inArray(protocolChunks.protocolId, protocolIds));
      await tx
        .delete(fileSearchDocuments)
        .where(inArray(fileSearchDocuments.protocolId, protocolIds));
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

    await tx.delete(trials).where(inArray(trials.id, trialIds));
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
    .onDuplicateKeyUpdate({
      set: {
        isDefault: true,
      },
    });
}

async function seedTrials(
  data: typeof SAMPLE_TRIALS,
  createdBy: number,
  mode: DemoMode,
  dbClient?: DbClient
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(trials).values(
    data.map((trial) => ({
      ...trial,
      id: toDemoId(mode, trial.id),
      createdBy,
    }))
  );
}

async function seedBaseModeData(
  mode: DemoMode,
  createdBy: number,
  dbClient?: DbClient
) {
  const db = dbClient ?? await getDb();
  if (!db) throw new Error("Database not available");

  if (mode === "sample") {
    await seedCategories(db);
    await seedTrials(SAMPLE_TRIALS, createdBy, "sample", db);
    return;
  }
  if (mode === "full") {
    await seedCategories(db);
    await seedTrials(FULL_TRIALS, createdBy, "full", db);
    return;
  }
  // Building mode baseline is intentionally empty.
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
      if (mode !== "building") {
        await seedCategories(db);
      }
      return { restoredFromSavedDefault: true };
    } catch (error) {
      console.error(`[demo] Failed restoring saved default for mode '${mode}', falling back to base seed.`, error);
      await wipeModeData(mode, db);
    }
  }

  await seedBaseModeData(mode, createdBy, db);
  return { restoredFromSavedDefault: false };
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
        return { ok: true, mode: "sample" as const, ...result };
      }

      const existing = await db
        .select({ id: trials.id })
        .from(trials)
        .where(like(trials.id, "sample:%"))
        .limit(1);

      if (existing.length === 0) {
        const result = await resetModeToDefault("sample", ctx.user.id, db);
        return { ok: true, mode: "sample" as const, ...result };
      }

      return { ok: true, mode: "sample" as const, restoredFromSavedDefault: false };
    }),

  loadFullDataset: protectedProcedure
    .input(modeLoadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const shouldResetToDefault = input?.resetToDefault === true;
      if (shouldResetToDefault) {
        const result = await resetModeToDefault("full", ctx.user.id, db);
        return { ok: true, mode: "full" as const, ...result };
      }

      const existing = await db
        .select({ id: trials.id })
        .from(trials)
        .where(like(trials.id, "full:%"))
        .limit(1);

      if (existing.length === 0) {
        const result = await resetModeToDefault("full", ctx.user.id, db);
        return { ok: true, mode: "full" as const, ...result };
      }

      return { ok: true, mode: "full" as const, restoredFromSavedDefault: false };
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
