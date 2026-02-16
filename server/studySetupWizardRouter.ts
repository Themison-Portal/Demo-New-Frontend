import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import * as db from "./studySetupWizard";
import { extractPdfText } from "./pdfExtractor";
import { type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { storagePut } from "./storage";
import { randomUUID } from "crypto";
import {
  getProtocolContextChunks,
  getStructuredScheduleOfActivities,
  ingestProtocolContextChunks,
  type StructuredSchedule,
} from "./_core/protocolContext";

const FALLBACK_SECTION_NAMES = [
  "Schedule of Events",
  "Inclusion / Exclusion",
  "Dosing & Administration",
  "Procedures & Assessments",
  "Lab & Samples",
  "Adverse Events & Safety",
  "Concomitant Medications",
];

const FALLBACK_PHASE_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#06B6D4", "#EF4444", "#6366F1"];

function normalizeToken(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferFallbackCategory(name: string) {
  const text = normalizeToken(name);
  if (/(consent)/.test(text)) return "consent";
  if (/(inclusion|exclusion|eligib)/.test(text)) return "eligibility";
  if (/(blood|sample|lab|cbc|chemistry|pk|biomarker|urine)/.test(text)) return "lab_sample";
  if (/(vital|blood pressure|heart rate|temperature|weight|pulse)/.test(text)) return "vital_signs";
  if (/(ct|mri|x ray|scan|imaging|recist)/.test(text)) return "imaging";
  if (/(dose|dosing|drug|infusion|injection|administer|dispense)/.test(text)) return "drug_administration";
  if (/(physical|ecg|assessment|exam|ecog)/.test(text)) return "assessment";
  if (/(questionnaire|qol|pro)/.test(text)) return "questionnaire";
  if (/(edc|crf|data entry|source data)/.test(text)) return "data_entry";
  if (/(ae|sae|adverse|safety|observation)/.test(text)) return "safety_reporting";
  if (/(irb|ethics|regulatory)/.test(text)) return "regulatory";
  if (/(follow up|followup|termination)/.test(text)) return "follow_up";
  if (/(schedule|coordination|randomization|irt)/.test(text)) return "coordination";
  return "custom";
}

function inferFallbackRole(category: string, name: string) {
  const text = normalizeToken(name);
  if (category === "consent") return "pi";
  if (category === "eligibility") return "crc";
  if (category === "lab_sample") return "nurse";
  if (category === "vital_signs") return "nurse";
  if (category === "drug_administration") return /(prepare|dispense|accountability)/.test(text) ? "pharmacist" : "nurse";
  if (category === "assessment") return /(medical|physical|ae|sae|exam)/.test(text) ? "pi" : "sub_i";
  if (category === "data_entry") return "crc";
  if (category === "coordination") return "crc";
  if (category === "safety_reporting") return "pi";
  if (category === "regulatory") return "regulatory_coordinator";
  return "crc";
}

function inferFallbackDuration(category: string, name: string) {
  const text = normalizeToken(name);
  if (text.includes("informed consent")) return 45;
  if (/(post dose observation|post-dose observation|observation)/.test(text)) return 60;
  if (/(infusion)/.test(text)) return 120;
  if (/(ecg)/.test(text)) return 12;
  if (/(blood|sample|lab)/.test(text)) return 12;
  if (/(data entry|edc|crf)/.test(text)) return 20;
  const defaults: Record<string, number> = {
    consent: 45,
    eligibility: 20,
    lab_sample: 12,
    vital_signs: 8,
    imaging: 45,
    drug_administration: 30,
    assessment: 20,
    questionnaire: 12,
    data_entry: 20,
    coordination: 15,
    documentation: 15,
    follow_up: 20,
    safety_reporting: 15,
    regulatory: 30,
    custom: 20,
  };
  return defaults[category] ?? 20;
}

function inferFallbackPriority(category: string, name: string) {
  const text = normalizeToken(name);
  if (/(informed consent|sae|serious adverse|drug administration|randomization)/.test(text)) return "critical";
  if (["consent", "eligibility", "drug_administration", "lab_sample", "safety_reporting"].includes(category)) {
    return "high";
  }
  return "medium";
}

function withActionVerb(name: string, category: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Complete task";
  if (/^(obtain|verify|review|draw|collect|record|perform|administer|assess|complete|submit|schedule|notify|document|enter|monitor|prepare)\b/i.test(trimmed)) {
    return trimmed;
  }
  const verbs: Record<string, string> = {
    consent: "Obtain",
    eligibility: "Verify",
    lab_sample: "Collect",
    vital_signs: "Record",
    imaging: "Perform",
    drug_administration: "Administer",
    assessment: "Assess",
    questionnaire: "Complete",
    data_entry: "Enter",
    coordination: "Schedule",
    documentation: "Document",
    follow_up: "Perform",
    safety_reporting: "Assess",
    regulatory: "Submit",
    custom: "Complete",
  };
  const verb = verbs[category] ?? "Complete";
  return `${verb} ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

type FallbackTask = {
  name: string;
  suggestedDate: string | null;
  estimatedDuration: number;
  category: string;
  assignedRole: string;
  priority: "critical" | "high" | "medium" | "low";
  protocolReference: {
    section: string;
    page: number | null;
    extractedText: string | null;
  };
  aiConfidence: number;
  conditionalNote: string | null;
  dependencies: string[];
};

type FallbackPhase = {
  name: string;
  color: string;
  tasks: FallbackTask[];
  transitions: Array<{ toPhase: string; condition: string | null }>;
};

function buildFallbackScaffold(protocolFilename: string, schedule: StructuredSchedule | null) {
  const pageRef = schedule?.sourcePages?.[0] ? `P.${schedule.sourcePages[0]}` : null;
  const protocolSections = FALLBACK_SECTION_NAMES.map((name) => ({
    name,
    dateReference: null,
    pageReference: pageRef,
    children: [],
  }));

  const phaseNamesFromSchedule =
    schedule?.visits
      ?.map((visit) => String(visit.name || "").trim())
      .filter((name) => name.length > 0) ?? [];
  const uniqueSchedulePhases = Array.from(new Set(phaseNamesFromSchedule));
  const visitPhases =
    uniqueSchedulePhases.length > 0
      ? uniqueSchedulePhases
      : ["Screening", "Visit 1 - Baseline", "Visit 2 - Week 4", "End of Study"];

  const footnoteMap = new Map((schedule?.footnotes ?? []).map((footnote) => [footnote.number, footnote.text]));

  const phases: FallbackPhase[] = visitPhases.map((phaseName, index) => {
    const normalizedPhase = normalizeToken(phaseName);
    const visitEntries = (schedule?.entries ?? []).filter(
      (entry) => entry.required && normalizeToken(entry.visit) === normalizedPhase
    );
    const tasks: FallbackTask[] = visitEntries.map((entry) => {
      const baseName = withActionVerb(entry.procedure, inferFallbackCategory(entry.procedure));
      const category = inferFallbackCategory(baseName);
      const footnoteText = entry.footnoteRef ? footnoteMap.get(entry.footnoteRef) ?? null : null;
      return {
        name: baseName,
        suggestedDate: null,
        estimatedDuration: inferFallbackDuration(category, baseName),
        category,
        assignedRole: inferFallbackRole(category, baseName),
        priority: inferFallbackPriority(category, baseName),
        protocolReference: {
          section: "Schedule of Activities",
          page: schedule?.sourcePages?.[0] ?? null,
          extractedText: `${entry.procedure} required at ${phaseName}`,
        },
        aiConfidence: entry.footnoteRef ? 0.88 : 0.95,
        conditionalNote: footnoteText,
        dependencies: [],
      };
    });

    const addTaskIfMissing = (name: string, category?: string, priority?: "critical" | "high" | "medium" | "low") => {
      const normalized = normalizeToken(name);
      if (tasks.some((task) => normalizeToken(task.name) === normalized)) return;
      const resolvedCategory = category || inferFallbackCategory(name);
      tasks.push({
        name: withActionVerb(name, resolvedCategory),
        suggestedDate: null,
        estimatedDuration: inferFallbackDuration(resolvedCategory, name),
        category: resolvedCategory,
        assignedRole: inferFallbackRole(resolvedCategory, name),
        priority: priority || inferFallbackPriority(resolvedCategory, name),
        protocolReference: {
          section: "Protocol requirements",
          page: schedule?.sourcePages?.[0] ?? null,
          extractedText: null,
        },
        aiConfidence: 0.82,
        conditionalNote: null,
        dependencies: [],
      });
    };

    if (normalizedPhase.includes("screen")) {
      addTaskIfMissing("Obtain written informed consent", "consent", "critical");
      addTaskIfMissing("Verify inclusion criteria", "eligibility", "critical");
      addTaskIfMissing("Verify exclusion criteria", "eligibility", "critical");
    }
    if (normalizedPhase.includes("visit") || normalizedPhase.includes("cycle") || normalizedPhase.includes("baseline")) {
      addTaskIfMissing("Assess adverse events since last visit", "safety_reporting", "critical");
      addTaskIfMissing("Review concomitant medications", "assessment", "medium");
      const hasDrugAdmin = tasks.some((task) => task.category === "drug_administration");
      if (hasDrugAdmin) {
        addTaskIfMissing("Record pre-dose vital signs", "vital_signs", "high");
        addTaskIfMissing("Monitor post-dose observation", "safety_reporting", "high");
      }
    }
    addTaskIfMissing(`Enter ${phaseName} data in EDC`, "data_entry", "medium");

    return {
      name: phaseName,
      color: FALLBACK_PHASE_COLORS[index % FALLBACK_PHASE_COLORS.length],
      tasks,
      transitions: [],
    };
  });

  phases.push({
    name: "Screen Fail",
    color: "#EF4444",
    tasks: [
      {
        name: "Document screen failure reason",
        suggestedDate: null,
        estimatedDuration: 15,
        category: "documentation",
        assignedRole: "crc",
        priority: "high",
        protocolReference: { section: "Eligibility", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.86,
        conditionalNote: null,
        dependencies: [],
      },
      {
        name: "Notify sponsor of screen failure",
        suggestedDate: null,
        estimatedDuration: 10,
        category: "coordination",
        assignedRole: "crc",
        priority: "high",
        protocolReference: { section: "Protocol administration", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.84,
        conditionalNote: null,
        dependencies: [],
      },
      {
        name: "Close participant screening record",
        suggestedDate: null,
        estimatedDuration: 10,
        category: "data_entry",
        assignedRole: "crc",
        priority: "medium",
        protocolReference: { section: "Data management", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.84,
        conditionalNote: null,
        dependencies: [],
      },
    ],
    transitions: [],
  });

  phases.push({
    name: "Early Termination",
    color: "#6366F1",
    tasks: [
      {
        name: "Document reason for early termination",
        suggestedDate: null,
        estimatedDuration: 20,
        category: "documentation",
        assignedRole: "pi",
        priority: "high",
        protocolReference: { section: "Early termination", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.84,
        conditionalNote: null,
        dependencies: [],
      },
      {
        name: "Perform end-of-study assessments",
        suggestedDate: null,
        estimatedDuration: 30,
        category: "assessment",
        assignedRole: "pi",
        priority: "high",
        protocolReference: { section: "End-of-study", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.83,
        conditionalNote: null,
        dependencies: [],
      },
      {
        name: "Collect final blood samples",
        suggestedDate: null,
        estimatedDuration: 15,
        category: "lab_sample",
        assignedRole: "nurse",
        priority: "high",
        protocolReference: { section: "Laboratory", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.83,
        conditionalNote: null,
        dependencies: [],
      },
      {
        name: "Complete termination CRF in EDC",
        suggestedDate: null,
        estimatedDuration: 20,
        category: "data_entry",
        assignedRole: "crc",
        priority: "medium",
        protocolReference: { section: "Data management", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.83,
        conditionalNote: null,
        dependencies: [],
      },
      {
        name: "Notify IRB and sponsor of termination",
        suggestedDate: null,
        estimatedDuration: 30,
        category: "regulatory",
        assignedRole: "regulatory_coordinator",
        priority: "critical",
        protocolReference: { section: "Regulatory reporting", page: schedule?.sourcePages?.[0] ?? null, extractedText: null },
        aiConfidence: 0.82,
        conditionalNote: null,
        dependencies: [],
      },
    ],
    transitions: [],
  });

  for (let i = 0; i < phases.length - 1; i += 1) {
    const current = phases[i];
    const next = phases[i + 1];
    if (current.name === "Screen Fail" || current.name === "Early Termination") continue;
    if (next.name === "Screen Fail" || next.name === "Early Termination") continue;
    current.transitions = [{ toPhase: next.name, condition: null }];
    if (normalizeToken(current.name).includes("screen")) {
      current.transitions.push({ toPhase: "Screen Fail", condition: "Failed" });
    }
  }

  return {
    protocolSections,
    phases,
    source: "deterministic_fallback",
    protocolFilename,
  };
}

function canonicalSectionName(name: string) {
  const normalized = normalizeToken(name);
  if (!normalized) return null;
  if (/(schedule|study days|visit window|visit schedule|soa|soe)/.test(normalized)) return "Schedule of Events";
  if (/(inclusion|exclusion|eligib)/.test(normalized)) return "Inclusion / Exclusion";
  if (/(dosing|dose|drug administration|administration)/.test(normalized)) return "Dosing & Administration";
  if (/(procedure|assessment|exam|ecg|vital)/.test(normalized)) return "Procedures & Assessments";
  if (/(lab|sample|hematology|chemistry|pk|biomarker|urinalysis)/.test(normalized)) return "Lab & Samples";
  if (/(adverse event|safety|sae|ae)/.test(normalized)) return "Adverse Events & Safety";
  if (/(concomitant|medication)/.test(normalized)) return "Concomitant Medications";
  return null;
}

function normalizeProtocolSections(rawSections: any[]) {
  const source = Array.isArray(rawSections) ? rawSections : [];
  const normalizedSections = source
    .map((section: any) => {
      const originalName = String(section?.name || "").trim();
      if (!originalName) return null;
      const canonical = canonicalSectionName(originalName) || originalName;
      return {
        name: canonical,
        dateReference: section?.dateReference || null,
        pageReference: section?.pageReference || null,
        children: Array.isArray(section?.children)
          ? section.children
              .map((child: any) => {
                const childName = String(child?.name || "").trim();
                if (!childName) return null;
                return {
                  name: childName,
                  dateReference: child?.dateReference || null,
                  pageReference: child?.pageReference || null,
                };
              })
              .filter(Boolean)
          : [],
      };
    })
    .filter(Boolean) as Array<{
      name: string;
      dateReference: string | null;
      pageReference: string | null;
      children: Array<{ name: string; dateReference: string | null; pageReference: string | null }>;
    }>;

  const deduped: typeof normalizedSections = [];
  const seen = new Set<string>();
  for (const section of normalizedSections) {
    const key = canonicalSectionName(section.name) || normalizeToken(section.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(section);
  }

  for (const defaultName of FALLBACK_SECTION_NAMES) {
    const key = canonicalSectionName(defaultName) || normalizeToken(defaultName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      name: defaultName,
      dateReference: null,
      pageReference: null,
      children: [],
    });
  }

  return deduped;
}

function scheduleVisitLabel(visit: { name: string; day?: string | null }) {
  const name = String(visit?.name || "").trim();
  const day = String(visit?.day || "").trim();
  if (!name) return "";
  return day ? `${name} (${day})` : name;
}

function normalizeScheduleTask(task: any, fallbackPage: number | null) {
  const rawName = String(task?.name || "").trim();
  if (!rawName) return null;
  const category = String(task?.category || inferFallbackCategory(rawName));
  return {
    name: withActionVerb(rawName, category),
    suggestedDate: task?.suggestedDate ?? null,
    estimatedDuration:
      typeof task?.estimatedDuration === "number" && Number.isFinite(task.estimatedDuration)
        ? Math.max(1, Math.round(task.estimatedDuration))
        : inferFallbackDuration(category, rawName),
    category,
    assignedRole: task?.assignedRole || inferFallbackRole(category, rawName),
    priority: task?.priority || inferFallbackPriority(category, rawName),
    protocolReference: {
      section: String(task?.protocolReference?.section || "Schedule of Activities"),
      page:
        typeof task?.protocolReference?.page === "number" && Number.isFinite(task.protocolReference.page)
          ? task.protocolReference.page
          : fallbackPage,
      extractedText:
        typeof task?.protocolReference?.extractedText === "string" ? task.protocolReference.extractedText : null,
    },
    aiConfidence:
      typeof task?.aiConfidence === "number" && Number.isFinite(task.aiConfidence)
        ? task.aiConfidence
        : 0.86,
    conditionalNote: typeof task?.conditionalNote === "string" ? task.conditionalNote : null,
    dependencies: Array.isArray(task?.dependencies)
      ? task.dependencies.map((dep: any) => String(dep || "").trim()).filter(Boolean)
      : [],
  };
}

function visitMatchesEntry(
  entryVisit: string,
  visit: { name: string; day?: string | null },
  dayTokenCounts: Map<string, number>
) {
  const normalizedEntry = normalizeToken(entryVisit);
  const normalizedName = normalizeToken(visit.name);
  const normalizedDay = normalizeToken(String(visit.day || ""));
  const normalizedLabel = normalizeToken(scheduleVisitLabel(visit));

  if (!normalizedEntry) return false;
  if (normalizedEntry === normalizedLabel || normalizedEntry === normalizedName) return true;
  if (normalizedEntry.includes(normalizedLabel) || normalizedLabel.includes(normalizedEntry)) return true;
  if (normalizedEntry.includes(normalizedName) || normalizedName.includes(normalizedEntry)) return true;

  const dayToken = normalizedEntry.match(/(?:^| )day\s*(-?\d{1,3})(?: |$)/)?.[1] || normalizedEntry.match(/^(-?\d{1,3})$/)?.[1];
  if (!dayToken || !normalizedDay) return false;
  if (!new RegExp(`(^| )${dayToken}( |$)`).test(normalizedDay)) return false;
  return (dayTokenCounts.get(dayToken) || 0) === 1;
}

function normalizeScaffoldWithSchedule(
  scaffoldData: any,
  schedule: StructuredSchedule | null,
  protocolFilename: string
) {
  const fallbackPage = schedule?.sourcePages?.[0] ?? null;
  const base =
    scaffoldData && typeof scaffoldData === "object"
      ? scaffoldData
      : buildFallbackScaffold(protocolFilename, schedule);

  const protocolSections = normalizeProtocolSections(base.protocolSections);
  const rawPhases = Array.isArray(base.phases) ? base.phases : [];
  const dedupedPhases: any[] = [];
  const phaseByKey = new Map<string, any>();

  for (const phase of rawPhases) {
    const phaseName = String(phase?.name || "").trim();
    if (!phaseName) continue;
    const key = normalizeToken(phaseName);
    const normalizedTasks = (Array.isArray(phase?.tasks) ? phase.tasks : [])
      .map((task: any) => normalizeScheduleTask(task, fallbackPage))
      .filter(Boolean);

    if (!phaseByKey.has(key)) {
      const next = {
        name: phaseName,
        color: typeof phase?.color === "string" ? phase.color : FALLBACK_PHASE_COLORS[dedupedPhases.length % FALLBACK_PHASE_COLORS.length],
        tasks: normalizedTasks,
        transitions: Array.isArray(phase?.transitions) ? phase.transitions : [],
      };
      phaseByKey.set(key, next);
      dedupedPhases.push(next);
      continue;
    }

    const existing = phaseByKey.get(key);
    const existingTaskNames = new Set(existing.tasks.map((task: any) => normalizeToken(task.name)));
    for (const task of normalizedTasks) {
      const taskKey = normalizeToken(task.name);
      if (!taskKey || existingTaskNames.has(taskKey)) continue;
      existingTaskNames.add(taskKey);
      existing.tasks.push(task);
    }
    if (Array.isArray(phase?.transitions)) {
      for (const transition of phase.transitions) {
        if (!transition?.toPhase) continue;
        const exists = existing.transitions.some((row: any) => normalizeToken(row?.toPhase) === normalizeToken(transition.toPhase));
        if (!exists) existing.transitions.push(transition);
      }
    }
  }

  if (schedule?.visits?.length) {
    const footnoteMap = new Map((schedule.footnotes || []).map((note) => [String(note.number || "").trim(), String(note.text || "").trim()]));
    const dayTokenCounts = new Map<string, number>();
    for (const visit of schedule.visits) {
      const dayToken = String(visit?.day || "").match(/-?\d{1,3}/)?.[0];
      if (!dayToken) continue;
      dayTokenCounts.set(dayToken, (dayTokenCounts.get(dayToken) || 0) + 1);
    }

    for (let visitIndex = 0; visitIndex < schedule.visits.length; visitIndex += 1) {
      const visit = schedule.visits[visitIndex];
      const visitLabel = scheduleVisitLabel(visit);
      if (!visitLabel) continue;
      const visitKey = normalizeToken(visitLabel);

      let phase = phaseByKey.get(visitKey);
      if (!phase) {
        phase = {
          name: visitLabel,
          color: FALLBACK_PHASE_COLORS[visitIndex % FALLBACK_PHASE_COLORS.length],
          tasks: [],
          transitions: [],
        };
        phaseByKey.set(visitKey, phase);
        dedupedPhases.push(phase);
      }

      const existingTaskNames = new Set((phase.tasks || []).map((task: any) => normalizeToken(task.name)));
      const visitEntries = (schedule.entries || []).filter(
        (entry) => entry.required && visitMatchesEntry(String(entry.visit || ""), visit, dayTokenCounts)
      );

      for (const entry of visitEntries) {
        const category = inferFallbackCategory(entry.procedure);
        const baseName = withActionVerb(entry.procedure, category);
        const taskKey = normalizeToken(baseName);
        if (!taskKey || existingTaskNames.has(taskKey)) continue;
        existingTaskNames.add(taskKey);

        const note = entry.footnoteRef ? footnoteMap.get(String(entry.footnoteRef).trim()) || null : null;
        phase.tasks.push({
          name: baseName,
          suggestedDate: null,
          estimatedDuration: inferFallbackDuration(category, baseName),
          category,
          assignedRole: inferFallbackRole(category, baseName),
          priority: inferFallbackPriority(category, baseName),
          protocolReference: {
            section: "Schedule of Activities",
            page: fallbackPage,
            extractedText: `${entry.procedure} required at ${visitLabel}`,
          },
          aiConfidence: note ? 0.88 : 0.95,
          conditionalNote: note,
          dependencies: [],
        });
      }

      const edcTaskName = `Enter ${visitLabel} data in EDC`;
      const edcKey = normalizeToken(edcTaskName);
      if (!existingTaskNames.has(edcKey)) {
        phase.tasks.push({
          name: edcTaskName,
          suggestedDate: null,
          estimatedDuration: 20,
          category: "data_entry",
          assignedRole: "crc",
          priority: "medium",
          protocolReference: {
            section: "Schedule of Activities",
            page: fallbackPage,
            extractedText: null,
          },
          aiConfidence: 0.86,
          conditionalNote: null,
          dependencies: [],
        });
      }
    }
  }

  return {
    ...base,
    protocolSections,
    phases: dedupedPhases.length > 0 ? dedupedPhases : buildFallbackScaffold(protocolFilename, schedule).phases,
  };
}

/**
 * Study Setup Agent Router
 * Handles protocol analysis and task scaffold generation
 */
export const studySetupWizardRouter = router({
  analyzeProtocol: protectedProcedure
    .input(
      z.object({
        fileName: z.string(),
        fileBase64: z.string(),
        contentType: z.string().optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fileName, fileBase64, contentType, demoMode } = input;
      const mode = (demoMode ?? "sample") as DemoMode;
      const fileBuffer = Buffer.from(fileBase64, "base64");
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `protocols/temp/${randomUUID()}-${safeName}`;

      await logTelemetryEvent({
        eventType: "protocol_uploaded",
        action: "created",
        userId: String(ctx.user.id),
        entityType: "protocol",
        payload: { fileName, demoMode: mode },
        aiInvolved: true,
      });

      const uploaded = await storagePut(key, fileBuffer, contentType ?? "application/pdf");

      if (!contentType || !contentType.includes("pdf")) {
        throw new Error("Only PDF protocols are supported for extraction.");
      }

      let protocolContent = "";
      try {
        protocolContent = await extractPdfText(uploaded.url);
      } catch (error) {
        throw new Error("Failed to read protocol document. Please ensure it is a valid PDF.");
      }

      const maxLength = 50000;
      if (protocolContent.length > maxLength) {
        protocolContent = protocolContent.substring(0, maxLength) + "\n\n[Content truncated due to length...]";
      }

      const systemPrompt = `You are an expert clinical trial coordinator. Extract core trial details from the protocol.
Preserve the protocol's exact wording for Phase (e.g., "Phase I/II").

Return only JSON matching this schema:
{
  "protocolTitle": string | null,
  "protocolNumber": string | null,
  "sponsor": string | null,
  "phase": string | null,
  "investigationalProduct": string | null,
  "indication": string | null,
  "nctNumber": string | null,
  "currentVersion": string | null,
  "amendmentVersion": string | null,
  "releaseDate": string | null,
  "location": string | null,
  "sampleSize": string | null,
  "numberOfSites": string | null,
  "studyDuration": string | null,
  "studyDesignType": string | null,
  "primaryObjective": string | null,
  "primaryEndpoint": string | null
}`;

      const userPrompt = `Protocol filename: ${fileName}

Protocol content:
${protocolContent}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "protocol_details",
            strict: true,
            schema: {
              type: "object",
              properties: {
                protocolTitle: { type: ["string", "null"] },
                protocolNumber: { type: ["string", "null"] },
                sponsor: { type: ["string", "null"] },
                phase: { type: ["string", "null"] },
                investigationalProduct: { type: ["string", "null"] },
                indication: { type: ["string", "null"] },
                nctNumber: { type: ["string", "null"] },
                currentVersion: { type: ["string", "null"] },
                amendmentVersion: { type: ["string", "null"] },
                releaseDate: { type: ["string", "null"] },
                location: { type: ["string", "null"] },
                sampleSize: { type: ["string", "null"] },
                numberOfSites: { type: ["string", "null"] },
                studyDuration: { type: ["string", "null"] },
                studyDesignType: { type: ["string", "null"] },
                primaryObjective: { type: ["string", "null"] },
                primaryEndpoint: { type: ["string", "null"] },
              },
              required: [
                "protocolTitle",
                "protocolNumber",
                "sponsor",
                "phase",
                "investigationalProduct",
                "indication",
                "nctNumber",
                "currentVersion",
                "amendmentVersion",
                "releaseDate",
                "location",
                "sampleSize",
                "numberOfSites",
                "studyDuration",
                "studyDesignType",
                "primaryObjective",
                "primaryEndpoint",
              ],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error("Failed to extract protocol details.");
      }

      await logTelemetryEvent({
        eventType: "ai_response_generated",
        action: "generated",
        userId: String(ctx.user.id),
        entityType: "protocol",
        payload: { demoMode: mode },
        aiInvolved: true,
      });

      return {
        extracted: JSON.parse(content),
        tempFile: uploaded,
      };
    }),

  /**
   * Retrieve section-aware context chunks for protocol-grounded setup generation.
   */
  getProtocolContext: protectedProcedure
    .input(
      z.object({
        protocolId: z.number(),
        query: z.string().optional(),
        sectionTypes: z.array(z.string()).optional(),
        limit: z.number().min(1).max(20).optional(),
        forceRefresh: z.boolean().optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const protocol = await db.getProtocolById(input.protocolId);
      if (!protocol) {
        throw new Error("Protocol not found");
      }
      const protocolTrialId = protocol.trialId;
      const hasPrefix = protocolTrialId.includes(":");
      const matchesMode = protocolTrialId.startsWith(`${mode}:`);
      const legacyAllowed = mode !== "building";
      if ((hasPrefix && !matchesMode) || (!hasPrefix && !legacyAllowed)) {
        throw new Error("Protocol does not belong to this demo mode");
      }

      const ingest = await ingestProtocolContextChunks({
        protocolId: input.protocolId,
        forceRefresh: input.forceRefresh ?? false,
      });
      const chunks = await getProtocolContextChunks({
        protocolId: input.protocolId,
        query: input.query,
        sectionTypes: input.sectionTypes,
        limit: input.limit ?? 6,
      });

      await logTelemetryEvent({
        eventType: "protocol_context_retrieved",
        action: "retrieved",
        userId: String(ctx.user.id),
        entityType: "protocol",
        entityId: String(input.protocolId),
        payload: {
          trialId: protocol.trialId,
          query: input.query ?? null,
          sectionTypes: input.sectionTypes ?? [],
          returnedChunks: chunks.length,
          createdChunks: ingest.created,
          reused: ingest.reused,
          pageCount: ingest.pageCount,
          wordCount: ingest.wordCount,
          hasStructuredSchedule: ingest.hasStructuredSchedule,
          embeddingCount: ingest.embeddingCount,
          demoMode: mode,
        },
        aiInvolved: true,
      });

      return {
        protocol: {
          id: protocol.id,
          filename: protocol.filename,
          trialId: protocol.trialId,
        },
        chunks,
        stats: {
          returned: chunks.length,
        createdOnIngest: ingest.created,
        reusedExisting: ingest.reused,
        pageCount: ingest.pageCount,
        wordCount: ingest.wordCount,
        hasStructuredSchedule: ingest.hasStructuredSchedule,
        embeddingCount: ingest.embeddingCount,
      },
    };
    }),
  /**
   * Generate task scaffold from protocol
   * This is the AI-powered "Generate Execution Plan" button
   */
  generateScaffold: protectedProcedure
    .input(z.object({
      protocolId: z.number(),
      trialId: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { protocolId, trialId, demoMode } = input;
      const mode = (demoMode ?? "sample") as DemoMode;

      await logTelemetryEvent({
        eventType: "trial_setup_started",
        action: "started",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: trialId,
        payload: { protocolId, demoMode: mode },
        aiInvolved: true,
      });
      
      // Get protocol details
      const protocol = await db.getProtocolById(protocolId);
      if (!protocol) {
        throw new Error("Protocol not found");
      }
      const protocolTrialId = protocol.trialId;
      const hasPrefix = protocolTrialId.includes(":");
      const matchesMode = protocolTrialId.startsWith(`${mode}:`);
      const legacyAllowed = mode !== "building";
      if ((hasPrefix && !matchesMode) || (!hasPrefix && !legacyAllowed)) {
        throw new Error("Protocol does not belong to this demo mode");
      }

      // Check if scaffold already exists - if so, delete it and regenerate
      const existingScaffold = await db.getTaskScaffoldByProtocolId(protocolId);
      if (existingScaffold) {
        console.log(`Deleting existing scaffold ${existingScaffold.id} for protocol ${protocolId}`);
        await db.deleteTaskScaffold(existingScaffold.id);
      }

      let scaffoldData: any = null;
      const shouldUseDeterministicDemoScaffold = mode === "sample" || mode === "full";

      if (shouldUseDeterministicDemoScaffold) {
        scaffoldData = normalizeScaffoldWithSchedule(
          buildFallbackScaffold(protocol.filename, null),
          null,
          protocol.filename
        );

        await logTelemetryEvent({
          eventType: "execution_plan_generation_retried",
          action: "fallback_used",
          userId: String(ctx.user.id),
          entityType: "protocol",
          entityId: String(protocolId),
          payload: {
            trialId: protocolTrialId,
            mode: "deterministic_demo",
            hasStructuredSchedule: false,
            demoMode: mode,
          },
          aiInvolved: true,
        });
      } else {
        // Use AI to analyze protocol and generate task scaffold
        const systemPrompt = `You are an expert clinical trial operations planner.
Analyze the protocol and generate a complete study setup scaffold with actionable tasks.

Each task must be operationally specific and include:
- name (must start with an action verb)
- category
- assignedRole
- estimatedDuration (minutes)
- priority
- protocolReference.section + protocolReference.page
- aiConfidence (0-1)
- conditionalNote (if applicable)

Return ONLY valid JSON in this shape:
{
  "protocolSections": [
    {
      "name": "Schedule of Events",
      "dateReference": null,
      "pageReference": "P.22",
      "children": []
    }
  ],
  "phases": [
    {
      "name": "Screening",
      "color": "#3B82F6",
      "tasks": [
        {
          "name": "Obtain written informed consent",
          "suggestedDate": "2026-03-05",
          "estimatedDuration": 45,
          "category": "consent",
          "assignedRole": "pi",
          "priority": "critical",
          "protocolReference": {
            "section": "Schedule of Activities",
            "page": 22,
            "extractedText": "Informed Consent must be completed before screening procedures."
          },
          "aiConfidence": 0.95,
          "conditionalNote": null,
          "dependencies": []
        }
      ],
      "transitions": [
        { "toPhase": "Visit 1 - Baseline", "condition": "Passed" },
        { "toPhase": "Screen Fail", "condition": "Failed" }
      ]
    }
  ]
}

Rules:
- Use realistic phase names from protocol schedule.
- Use protocol sections for left-map navigation: Schedule of Events, Inclusion / Exclusion, Dosing & Administration, Procedures & Assessments, Lab & Samples, Adverse Events & Safety, Concomitant Medications.
- Tasks must be precise (no vague labels like "Lab work").
- Every visit phase must include a data-entry task.
- Screening must include consent + inclusion/exclusion checks.
- Include Screen Fail and Early Termination phases with key closeout tasks.
- If drug administration exists in a phase, include pre-dose checks and post-dose observation.
- Keep dependencies as task names referencing prior tasks in same phase or previous phases.`;

      // Extract text from the PDF
      let protocolContent = '';
      try {
        protocolContent = await extractPdfText(protocol.fileUrl);
        console.log(`Extracted ${protocolContent.length} characters from PDF`);
      } catch (error) {
        console.error('Failed to extract PDF text:', error);
        throw new Error('Failed to read protocol document. Please ensure the file is a valid PDF.');
      }

      // Prepare section-aware context chunks first; this improves grounding for setup generation.
      let contextChunks: Array<{
        sectionType: string;
        sectionTitle: string | null;
        chunkText: string;
        citation: { filename: string; sectionTitle: string | null; page: string };
      }> = [];
      try {
        await ingestProtocolContextChunks({
          protocolId,
          forceRefresh: false,
        });
        contextChunks = await getProtocolContextChunks({
          protocolId,
          query:
            "study design objectives endpoints visits schedule assessments procedures inclusion exclusion criteria dosing safety",
          limit: 6,
        });
      } catch (error) {
        console.warn("[studySetup] Failed to load protocol context chunks", error);
      }

      await logTelemetryEvent({
        eventType: "execution_plan_context_prepared",
        action: "prepared",
        userId: String(ctx.user.id),
        entityType: "protocol",
        entityId: String(protocolId),
        payload: {
          trialId: protocolTrialId,
          contextChunkCount: contextChunks.length,
          usedSectionAwareContext: contextChunks.length > 0,
          demoMode: mode,
        },
        aiInvolved: true,
      });

      // Truncate if too long to stay within token limits.
      // If we have context chunks, we can keep the raw protocol payload smaller.
      const maxLength = contextChunks.length > 0 ? 16000 : 22000;
      if (protocolContent.length > maxLength) {
        protocolContent = protocolContent.substring(0, maxLength) + '\n\n[Content truncated due to length...]';
      }

      const contextBlock = contextChunks
        .map((chunk, index) => {
          const title = chunk.sectionTitle || "Untitled section";
          return `[Context Chunk ${index + 1}] ${title} (${chunk.sectionType}, ${chunk.citation.page})
${chunk.chunkText.slice(0, 1400)}`;
        })
        .join("\n\n");

      const userPrompt = `Protocol Document: ${protocol.filename}

Priority Context Chunks:
${contextBlock || "[No pre-processed context chunks available]"}

Protocol Content:
${protocolContent}

Based on the protocol content above, generate a complete task scaffold for this clinical trial. Include all necessary phases, tasks, and dependencies.`;

        const invokeScaffoldLLM = async (prompt: string) =>
          invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt },
            ],
            response_format: {
            type: "json_schema",
            json_schema: {
              name: "task_scaffold",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  protocolSections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        dateReference: { type: ["string", "null"] },
                        pageReference: { type: ["string", "null"] },
                        children: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              dateReference: { type: ["string", "null"] },
                              pageReference: { type: ["string", "null"] },
                            },
                            required: ["name"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["name"],
                      additionalProperties: false,
                    },
                  },
                  phases: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        color: { type: "string" },
                        tasks: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                              suggestedDate: { type: ["string", "null"] },
                              estimatedDuration: { type: ["number", "null"] },
                              category: {
                                type: "string",
                                enum: [
                                  "consent",
                                  "eligibility",
                                  "lab_sample",
                                  "vital_signs",
                                  "imaging",
                                  "drug_administration",
                                  "assessment",
                                  "questionnaire",
                                  "data_entry",
                                  "coordination",
                                  "documentation",
                                  "follow_up",
                                  "safety_reporting",
                                  "regulatory",
                                  "custom",
                                ],
                              },
                              assignedRole: {
                                type: ["string", "null"],
                                enum: [
                                  "pi",
                                  "sub_i",
                                  "crc",
                                  "nurse",
                                  "pharmacist",
                                  "lab_tech",
                                  "data_manager",
                                  "regulatory_coordinator",
                                  "custom",
                                  null,
                                ],
                              },
                              priority: {
                                type: "string",
                                enum: ["critical", "high", "medium", "low"],
                              },
                              protocolReference: {
                                type: "object",
                                properties: {
                                  section: { type: "string" },
                                  page: { type: ["number", "null"] },
                                  extractedText: { type: ["string", "null"] },
                                },
                                required: ["section", "page", "extractedText"],
                                additionalProperties: false,
                              },
                              aiConfidence: { type: ["number", "null"] },
                              conditionalNote: { type: ["string", "null"] },
                              dependencies: {
                                type: "array",
                                items: { type: "string" },
                              },
                            },
                            required: [
                              "name",
                              "suggestedDate",
                              "estimatedDuration",
                              "category",
                              "assignedRole",
                              "priority",
                              "protocolReference",
                              "aiConfidence",
                              "conditionalNote",
                              "dependencies",
                            ],
                            additionalProperties: false,
                          },
                        },
                        transitions: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              toPhase: { type: "string" },
                              condition: { type: ["string", "null"] },
                            },
                            required: ["toPhase"],
                            additionalProperties: false,
                          },
                        },
                      },
                      required: ["name", "color", "tasks"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["protocolSections", "phases"],
                additionalProperties: false,
              },
            },
          },
        });

        const structuredSchedule = await getStructuredScheduleOfActivities(protocolId).catch(() => null);
        let response;
        try {
          response = await invokeScaffoldLLM(userPrompt);
        } catch (error) {
          const compactContextBlock = contextChunks
            .slice(0, 3)
            .map((chunk, index) => {
              const title = chunk.sectionTitle || "Untitled section";
              return `[Compact Context ${index + 1}] ${title} (${chunk.sectionType}, ${chunk.citation.page})
${chunk.chunkText.slice(0, 700)}`;
            })
            .join("\n\n");

          const compactPrompt = `Protocol Document: ${protocol.filename}

Priority Context Chunks:
${compactContextBlock || "[No pre-processed context chunks available]"}

Protocol Content (compact fallback):
${protocolContent.slice(0, 9000)}

Generate the same JSON scaffold format, but prioritize correctness over completeness if content is limited.`;

          await logTelemetryEvent({
            eventType: "execution_plan_generation_retried",
            action: "retry",
            userId: String(ctx.user.id),
            entityType: "protocol",
            entityId: String(protocolId),
            payload: {
              trialId: protocolTrialId,
              reason: error instanceof Error ? error.message : String(error),
              mode: "compact_fallback",
              demoMode: mode,
            },
            aiInvolved: true,
          });

          try {
            response = await invokeScaffoldLLM(compactPrompt);
          } catch (compactError) {
            await logTelemetryEvent({
              eventType: "execution_plan_generation_retried",
              action: "fallback_used",
              userId: String(ctx.user.id),
              entityType: "protocol",
              entityId: String(protocolId),
              payload: {
                trialId: protocolTrialId,
                reason: compactError instanceof Error ? compactError.message : String(compactError),
                mode: "deterministic_fallback",
                hasStructuredSchedule: Boolean(structuredSchedule),
                demoMode: mode,
              },
              aiInvolved: true,
            });
            scaffoldData = buildFallbackScaffold(protocol.filename, structuredSchedule);
          }
        }

        if (!scaffoldData) {
          const content = response?.choices?.[0]?.message?.content;
          if (!content || typeof content !== "string") {
            scaffoldData = buildFallbackScaffold(protocol.filename, structuredSchedule);
          } else {
            try {
              scaffoldData = JSON.parse(content);
            } catch {
              scaffoldData = buildFallbackScaffold(protocol.filename, structuredSchedule);
            }
          }
        }
        scaffoldData = normalizeScaffoldWithSchedule(scaffoldData, structuredSchedule, protocol.filename);
      }

      // Create task scaffold
      await db.createTaskScaffold({
        protocolId,
        trialId: protocolTrialId,
        status: "draft",
      });

      const scaffold = await db.getTaskScaffoldByProtocolId(protocolId);
      if (!scaffold) {
        throw new Error("Failed to create task scaffold");
      }

      // Create protocol sections
      for (let i = 0; i < scaffoldData.protocolSections.length; i++) {
        const section = scaffoldData.protocolSections[i];
        await db.createProtocolSection({
          protocolId,
          name: section.name,
          dateReference: section.dateReference || null,
          pageReference: section.pageReference || null,
          orderIndex: i,
          parentSectionId: null,
        });

        // Create child sections if any
        if (section.children) {
          for (let j = 0; j < section.children.length; j++) {
            const child = section.children[j];
            await db.createProtocolSection({
              protocolId,
              name: child.name,
              dateReference: child.dateReference || null,
              pageReference: child.pageReference || null,
              orderIndex: j,
              parentSectionId: null, // We'll need to get the parent ID properly
            });
          }
        }
      }

      // Create phases and tasks
      const phaseMap = new Map<string, number>();
      let createdTasks = 0;
      
      for (let i = 0; i < scaffoldData.phases.length; i++) {
        const phase = scaffoldData.phases[i];
        
        await db.createPhase({
          scaffoldId: scaffold.id,
          name: phase.name,
          color: phase.color,
          orderIndex: i,
        });

        const phases = await db.getPhasesByScaffoldId(scaffold.id);
        const createdPhase = phases.find(p => p.name === phase.name);
        if (createdPhase) {
          phaseMap.set(phase.name, createdPhase.id);
        }

        // Create tasks for this phase
        if (createdPhase) {
          for (let j = 0; j < phase.tasks.length; j++) {
            const task = phase.tasks[j];
            await db.createTask({
              phaseId: createdPhase.id,
              name: task.name,
              suggestedDate: task.suggestedDate ? new Date(task.suggestedDate) : null,
              duration:
                (typeof task.estimatedDuration === "number" && Number.isFinite(task.estimatedDuration)
                  ? Math.max(1, Math.round(task.estimatedDuration))
                  : null) || null,
              protocolSection: task.protocolReference?.section || null,
              protocolPage:
                typeof task.protocolReference?.page === "number" ? task.protocolReference.page : null,
              status: "pending",
              orderIndex: j,
            });
            createdTasks += 1;
          }
        }
      }

      // Create phase transitions
      for (const phase of scaffoldData.phases) {
        const fromPhaseId = phaseMap.get(phase.name);
        if (fromPhaseId && phase.transitions) {
          for (const transition of phase.transitions) {
            const toPhaseId = phaseMap.get(transition.toPhase);
            if (toPhaseId) {
              await db.createPhaseTransition({
                fromPhaseId,
                toPhaseId,
                condition: transition.condition || null,
              });
            }
          }
        }
      }

      await logTelemetryEvent({
        eventType: "trial_setup_step_completed",
        action: "completed",
        entityType: "trial",
        entityId: trialId,
        payload: { step: "generate_scaffold", createdTasks },
        aiInvolved: true,
      });

      if (createdTasks > 0) {
        await logTelemetryEvent({
          eventType: "task_created",
          action: "created",
          entityType: "task",
          entityId: trialId,
          payload: { count: createdTasks },
          aiInvolved: true,
        });
      }

      return {
        success: true,
        scaffoldId: scaffold.id,
      };
    }),

  /**
   * Get task scaffold with all related data
   */
  getScaffold: protectedProcedure
    .input(z.object({
      protocolId: z.number(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .query(async ({ input }) => {
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const protocol = await db.getProtocolById(input.protocolId);
      if (!protocol) return null;
      const protocolTrialId = protocol.trialId;
      const hasPrefix = protocolTrialId.includes(":");
      const matchesMode = protocolTrialId.startsWith(`${mode}:`);
      const legacyAllowed = mode !== "building";
      if ((hasPrefix && !matchesMode) || (!hasPrefix && !legacyAllowed)) {
        return null;
      }

      const scaffold = await db.getTaskScaffoldByProtocolId(input.protocolId);
      if (!scaffold) {
        return null;
      }

      const phases = await db.getPhasesByScaffoldId(scaffold.id);
      const phasesWithTasks = await Promise.all(
        phases.map(async (phase) => {
          const tasks = await db.getTasksByPhaseId(phase.id);
          const tasksWithDeps = await Promise.all(
            tasks.map(async (task) => {
              const dependencies = await db.getTaskDependencies(task.id);
              return { ...task, dependencies };
            })
          );
          const transitions = await db.getPhaseTransitions(phase.id);
          return { ...phase, tasks: tasksWithDeps, transitions };
        })
      );

      const sections = await db.getProtocolSections(input.protocolId);

      return {
        scaffold,
        phases: phasesWithTasks,
        protocol,
        sections,
      };
    }),

  /**
   * Confirm and launch scaffold
   */
  confirmScaffold: protectedProcedure
    .input(z.object({
      scaffoldId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateTaskScaffoldStatus(input.scaffoldId, "confirmed", ctx.user.id);
      await logTelemetryEvent({
        eventType: "trial_setup_completed",
        action: "completed",
        userId: String(ctx.user.id),
        entityType: "task_scaffold",
        entityId: String(input.scaffoldId),
      });
      return { success: true };
    }),

  /**
   * Update task
   */
  updateTask: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      name: z.string().optional(),
      suggestedDate: z.string().optional(),
      duration: z.number().optional(),
      status: z.enum(["pending", "completed", "blocked"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { taskId, ...updates } = input;
      const existingTask = await db.getTaskById(taskId);
      await db.updateTask(taskId, {
        ...updates,
        suggestedDate: updates.suggestedDate ? new Date(updates.suggestedDate) : undefined,
      });

      const afterTask = existingTask
        ? {
            ...existingTask,
            ...updates,
            suggestedDate: updates.suggestedDate ? new Date(updates.suggestedDate) : existingTask.suggestedDate,
          }
        : undefined;

      if (existingTask) {
        await logTelemetryEvent({
          eventType: "task_edited",
          action: "edited",
          entityType: "task",
          entityId: String(taskId),
          payload: {
            before: existingTask,
            after: afterTask,
          },
        });

        if (updates.status === "completed" && existingTask.status !== "completed") {
          await logTelemetryEvent({
            eventType: "task_completed",
            action: "completed",
            entityType: "task",
            entityId: String(taskId),
          });
        }
      }

      return { success: true };
    }),

  /**
   * Delete task
   */
  deleteTask: protectedProcedure
    .input(z.object({
      taskId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const existingTask = await db.getTaskById(input.taskId);
      await db.deleteTask(input.taskId);

      if (existingTask) {
        await logTelemetryEvent({
          eventType: "task_deleted",
          action: "deleted",
          entityType: "task",
          entityId: String(input.taskId),
          payload: existingTask,
        });
      }

      return { success: true };
    }),
});
