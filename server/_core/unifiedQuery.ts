import { and, desc, eq, inArray, isNull, like, notLike } from "drizzle-orm";
import {
  executionMaps,
  fileSearchDocuments,
  mapPhases,
  mapTasks,
  mapTelemetryEvents,
  protocolChunks,
  protocols,
  users,
  type ExecutionMap,
  type MapPhase,
  type MapTask,
  type MapTelemetryEvent,
  type Protocol,
} from "../../drizzle/schema";
import { invokeLLM } from "./llm";
import { ENV } from "./env";
import { stripDemoId, toDemoId } from "./demoMode";
import { callBackend } from "./backendClient";

// Trials are BE-owned (the FE MySQL `trials` table is retired). This file
// sources trial metadata from the BE (`/api/trials*`) and shapes it like the
// rows it used to read from the FE table. BE list rows carry both the FE key
// (`slug`) and the BE UUID (`id`); operational/`executionMaps` joins stay keyed
// by the BE UUID.
const UQ_BE_TO_FE_STATUS: Record<string, string> = {
  planning: "not-started",
  paused: "on-hold",
  cancelled: "terminated",
};
function uqBeStatusToFe(status: string | undefined | null): string {
  if (!status) return "not-started";
  return UQ_BE_TO_FE_STATUS[status] ?? status;
}
import {
  getProtocolContextChunks,
  getStructuredEligibilityCriteria,
  getStructuredScheduleOfActivities,
  type ProtocolContextChunk,
} from "./protocolContext";
import { extractPdfPages, extractPdfPagesFromBuffer } from "../pdfExtractor";
import { storageReadBytes } from "../storage";

const USES_EXTERNAL_RAG = ENV.ragProvider === "external";

export type UnifiedRoute = "document" | "operational" | "hybrid" | "telemetry";

export type UnifiedTool = "document_retrieval" | "operational_state" | "telemetry_patterns";

export type UnifiedQueryPlan = {
  route: UnifiedRoute;
  tools: UnifiedTool[];
  requiredTools: UnifiedTool[];
  focus:
    | "inclusion"
    | "exclusion"
    | "eligibility"
    | "schedule"
    | "endpoints"
    | "procedures"
    | "operational"
    | "telemetry"
    | "general";
  amendmentIntent: boolean;
  comprehensive: boolean;
  rationale: string[];
};

export type DocumentEvidence = {
  protocolId: string;
  filename: string;
  fileUrl: string | null;
  section: string;
  pageLabel: string;
  page: number | null;
  excerpt: string;
  score: number;
};

export type OperationalEvidence = {
  label: string;
  value: string;
  asOf: string;
  taskItems?: OperationalTaskItem[];
};

export type OperationalTaskItem = {
  taskId: string;
  mapId: string;
  trialId: string;
  trialLabel?: string | null;
  taskName: string;
  dueDate: string | null;
  status: string | null;
  assignedRole: string | null;
  assigneeName: string | null;
  phaseId: string | null;
  phaseName: string | null;
};

export type TelemetryEvidence = {
  label: string;
  value: string;
  asOf: string;
};

export type UnifiedEvidenceBundle = {
  route: UnifiedRoute;
  document: DocumentEvidence[];
  operational: OperationalEvidence[];
  telemetry: TelemetryEvidence[];
  gaps: string[];
};

export type UnifiedQueryResult = {
  plan: UnifiedQueryPlan;
  route: UnifiedRoute;
  message: string;
  thinking: string;
  sources: Array<{
    filename: string;
    fileUrl?: string | null;
    protocolId?: string;
    section?: string;
    page?: number | null;
    excerpt?: string;
    category?: string | null;
    sourceType: "document" | "operational" | "telemetry";
    taskId?: string;
    trialId?: string;
    mapId?: string;
    dueDate?: string | null;
    taskStatus?: string | null;
    assignedRole?: string | null;
    assigneeName?: string | null;
    phaseName?: string | null;
  }>;
  evidence: UnifiedEvidenceBundle;
  confidence: number;
  abstained: boolean;
  abstainReason?: string | null;
};

export type RetrievalQualityReport = {
  route: UnifiedRoute;
  query: string;
  protocols: Array<{
    protocolId: string;
    filename: string;
    retrievedCount: number;
    uniqueSections: number;
    uniquePages: number;
    eligibilityHits: number;
    scheduleHits: number;
    amendmentLikeHits: number;
    qualityFlags: string[];
    topPages: Array<number | null>;
    topSections: string[];
  }>;
  qualityScore: number;
  notes: string[];
};

export type RetrievalCandidateDiagnostic = {
  rank: number;
  selected: boolean;
  chunkId: number;
  protocolId: string;
  sectionType: string;
  sectionTitle: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  pageLabel: string;
  chunkType: string | null;
  score: number;
  lexical: number;
  semantic: number;
  direct: number;
  scheduleLike: boolean;
  amendmentLike: boolean;
  excerpt: string;
};

export type DocumentRetrievalDebug = {
  hints: string[];
  expandedQuery: string;
  queryExpansionMatches: string[];
  routing: RetrievalRoutingConfig;
  comprehensive: boolean;
  candidateCount: number;
  selectedCount: number;
  candidates: RetrievalCandidateDiagnostic[];
};

export type UnifiedQueryDiagnostics = {
  query: string;
  plan: UnifiedQueryPlan;
  route: UnifiedRoute;
  protocols: Array<{
    protocolId: string;
    filename: string;
    category: string | null;
    isCurrent: boolean;
    createdAt: string | null;
    fileUrl: string | null;
  }>;
  retrieval: DocumentRetrievalDebug;
  parserPages: Array<{
    pageNumber: number;
    textSnippet: string;
  }>;
  chunkCoverage: Array<{
    chunkId: number;
    protocolId: string;
    sectionType: string;
    sectionTitle: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    pageLabel: string;
    excerpt: string;
  }>;
  context: {
    systemPrompt: string;
    userPrompt: string;
    docContextCount: number;
    quoteCandidateCount: number;
    operationalEvidenceCount: number;
    telemetryEvidenceCount: number;
  };
  deterministicPreview: {
    criteria: string | null;
    schedule: string | null;
  };
  answer: UnifiedQueryResult;
};

type QuoteCandidate = {
  quote: string;
  filename: string;
  pageLabel: string;
  page: number | null;
  section: string;
  score: number;
};

function normalizeLite(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeLite(value: string) {
  return Array.from(new Set(normalizeLite(value).split(" ").filter((term) => term.length > 2)));
}

const CLINICAL_SYNONYMS: Record<string, string[]> = {
  "blood test": ["cbc", "complete blood count", "hematology", "blood draw", "laboratory assessments"],
  cbc: ["complete blood count", "hematology panel", "blood count", "full blood count"],
  cmp: ["comprehensive metabolic panel", "chemistry panel", "metabolic panel", "blood chemistry"],
  lft: ["liver function test", "hepatic panel", "liver panel", "ast", "alt", "bilirubin"],
  ecg: ["electrocardiogram", "ekg", "12 lead ecg", "cardiac rhythm"],
  vitals: ["vital signs", "blood pressure", "heart rate", "temperature", "respiration rate", "spo2"],
  screening: ["screening visit", "pre study", "enrollment visit", "visit 0"],
  baseline: ["visit 1", "day 1", "randomization"],
  "end of study": ["end of treatment", "eot", "eos", "termination visit", "final visit"],
  "follow-up": ["follow up", "post treatment", "safety follow up"],
  "physical exam": ["physical examination", "pe", "complete physical"],
  "informed consent": ["icf", "consent form", "consent process"],
  "adverse event": ["ae", "side effect", "adverse reaction", "safety event"],
  "serious adverse event": ["sae", "serious ae", "hospitalization event"],
  coordinator: ["crc", "clinical research coordinator", "study coordinator"],
  investigator: ["pi", "principal investigator", "sub investigator", "sub i"],
  protocol: ["study protocol", "clinical study protocol", "csp"],
  amendment: ["protocol amendment", "protocol modification"],
  "consent form": ["icf", "informed consent form", "consent document"],
  fasting: ["fasting required", "npo", "nothing by mouth", "empty stomach", "fasting requirement"],
  window: ["visit window", "visit interval", "allowable range", "plus minus days", "permissible range"],
  eligibility: ["inclusion criteria", "exclusion criteria", "eligible", "qualify", "enrollment criteria"],
  dose: ["dosing", "dose level", "drug administration", "ip administration", "study drug"],
};

type QueryExpansion = {
  expandedQuery: string;
  matchedTerms: string[];
};

type RetrievalRoutingConfig = {
  preferredChunkTypes: string[];
  boostSections: string[];
  minChunks: number;
  maxChunks: number;
  requireCompletenessCheck: boolean;
};

function expandClinicalQuery(query: string): QueryExpansion {
  const normalized = normalizeLite(query);
  if (!normalized) return { expandedQuery: query, matchedTerms: [] };

  const additions: string[] = [];
  const matchedTerms: string[] = [];
  for (const [term, synonyms] of Object.entries(CLINICAL_SYNONYMS)) {
    const termNeedle = normalizeLite(term);
    if (!termNeedle) continue;
    if (!normalized.includes(termNeedle)) continue;
    matchedTerms.push(term);
    additions.push(...synonyms.slice(0, 3));
  }

  if (additions.length === 0) {
    return {
      expandedQuery: query,
      matchedTerms: [],
    };
  }

  const dedupedAdditions = Array.from(
    new Set(
      additions
        .map((item) => String(item || "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  );
  if (dedupedAdditions.length === 0) {
    return {
      expandedQuery: query,
      matchedTerms,
    };
  }

  return {
    expandedQuery: `${query} ${dedupedAdditions.join(" ")}`.trim(),
    matchedTerms: Array.from(new Set(matchedTerms)),
  };
}

function classifyRetrievalRouting(query: string): RetrievalRoutingConfig {
  const mentionsVisit = /visit\s*\d+|day\s*-?\d+|screening|baseline|follow.?up|end of (?:treatment|study)|eot|eos/i;
  const mentionsProcedure =
    /cbc|cmp|ecg|ekg|vital|blood|urine|lab|laboratory|physical exam|consent|adverse/i;
  const mentionsEligibility =
    /eligib|inclus|exclus|criteria|can.*(?:patient|subject).*(?:enroll|participate)|qualify/i;
  const mentionsDosing = /dos(?:e|ing)|drug|medication|administer|ip|study drug/i;
  const mentionsSafety = /sae|adverse|safety|report|serious|susar/i;
  const asksList = /what.*(?:all|procedures|tests|assessments)|list|how many|complete/i;

  const preferredChunkTypes: string[] = [];
  const boostSections: string[] = [];
  let minChunks = 3;
  let maxChunks = 8;
  let requireCompletenessCheck = false;

  if (mentionsVisit.test(query)) {
    preferredChunkTypes.push("soa_visit", "table", "visit_description");
    boostSections.push("schedule of assessments", "schedule of activities", "study procedures");
  }
  if (mentionsProcedure.test(query)) {
    preferredChunkTypes.push("soa_procedure", "table", "procedure_description");
    boostSections.push("schedule of assessments", "laboratory", "procedures");
  }
  if (mentionsEligibility.test(query)) {
    preferredChunkTypes.push("criteria_structured", "eligibility_criterion");
    boostSections.push("eligibility", "inclusion", "exclusion", "study population");
  }
  if (mentionsDosing.test(query)) {
    boostSections.push("drug administration", "dosing", "investigational product", "treatment");
  }
  if (mentionsSafety.test(query)) {
    boostSections.push("adverse events", "safety", "reporting");
  }
  if (asksList.test(query)) {
    requireCompletenessCheck = true;
    minChunks = 5;
    maxChunks = 12;
  }

  return {
    preferredChunkTypes: Array.from(new Set(preferredChunkTypes)),
    boostSections: Array.from(new Set(boostSections)),
    minChunks,
    maxChunks,
    requireCompletenessCheck,
  };
}

function scoreChunkLite(query: string, chunk: ProtocolContextChunk) {
  const terms = tokenizeLite(query);
  if (terms.length === 0) return 0;
  const hay = normalizeLite(`${chunk.sectionTitle || ""} ${chunk.sectionType} ${chunk.chunkText.slice(0, 2600)}`);
  let score = 0;
  for (const term of terms) {
    const occurrences = hay.split(term).length - 1;
    score += Math.min(occurrences, 8);
  }
  return score;
}

function chunkRelevanceScore(query: string, chunk: ProtocolContextChunk) {
  const lexical = chunk.retrievalScores?.lexical ?? scoreChunkLite(query, chunk);
  const semantic = chunk.retrievalScores?.semantic ?? 0;
  const direct = chunk.score ?? 0;
  return Math.max(direct, lexical + semantic * 12);
}

function isAmendmentLikeChunk(chunk: ProtocolContextChunk) {
  const hay = normalizeLite(
    `${chunk.sectionTitle || ""} ${chunk.sectionType} ${chunk.chunkText.slice(0, 2200)} ${
      String(chunk.metadata?.chunkType || "")
    }`
  );
  return (
    /\bamendment\b|\brevision history\b|\bversion history\b|\bsummary of changes\b|\bchange log\b|\bchanges from\b|\bchanges to\b/.test(
      hay
    ) ||
    /\badded\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\bremoved\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\bmodified\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\bupdated\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay)
  );
}

function isScheduleLikeChunk(chunk: ProtocolContextChunk) {
  const chunkType = String(chunk.metadata?.chunkType || "").toLowerCase();
  const hay = normalizeLite(`${chunk.sectionTitle || ""} ${chunk.sectionType} ${chunk.chunkText.slice(0, 1800)}`);
  const hasScheduleHeading =
    hay.includes("schedule of events") ||
    hay.includes("schedule of activities") ||
    hay.includes("schedule of assessments") ||
    /\bsoa\b/.test(hay) ||
    /\bsoe\b/.test(hay);
  const hasScheduleSignals =
    hay.includes("visit window") || hay.includes("study days") || hay.includes("study procedure");
  return (
    chunk.sectionType === "schedule" ||
    chunk.sectionType === "visits" ||
    chunkType.includes("table") ||
    hasScheduleHeading ||
    hasScheduleSignals
  );
}

function chunkMatchesPreferredType(chunk: ProtocolContextChunk, preferredChunkTypes: string[]) {
  if (!preferredChunkTypes || preferredChunkTypes.length === 0) return false;
  const chunkType = normalizeLite(String(chunk.metadata?.chunkType || ""));
  if (!chunkType) return false;
  for (const preferred of preferredChunkTypes) {
    const needle = normalizeLite(preferred);
    if (!needle) continue;
    if (chunkType.includes(needle)) return true;
  }
  return false;
}

function chunkTouchesAnyPage(chunk: ProtocolContextChunk, pages: Set<number>) {
  if (!pages || pages.size === 0) return false;
  const start = chunk.pageStart ?? chunk.pageEnd ?? null;
  const end = chunk.pageEnd ?? chunk.pageStart ?? null;
  if (start === null && end === null) return false;
  if (start !== null && end !== null) {
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (const page of Array.from(pages)) {
      if (page >= low && page <= high) return true;
    }
    return false;
  }
  const single = start ?? end;
  return single !== null ? pages.has(single) : false;
}

function isComprehensiveQuestion(query: string) {
  return /(all|list|criteria|criterion|requirements?|which|what are|table|schedule|assessments?|endpoints?|procedures?|eligibility|inclusion|exclusion|footnote|visit window|dosing|cohort|arm\b)/i.test(
    query
  );
}

function getSectionTypeHints(query: string): string[] | undefined {
  const normalized = query.toLowerCase();
  if (/(inclusion|exclusion|eligibility|criteria)/i.test(normalized)) return ["eligibility"];
  if (/\bcycle\s*\d+\b|\bday\s*-?\d+\b|\bc\d+\s*d\d+\b|\bc\d+d\d+\b/.test(normalized))
    return ["schedule", "visits"];
  if (/(schedule|scheduled|table|matrix|visit window|assessments?|events?|soa|soe)/i.test(normalized))
    return ["schedule", "visits"];
  if (
    /(when\s+.*\brequired|required\s+.*\bwhen|pregnancy test|12-?lead ecg|ecg|cbc|urinalysis|thyroid function|vital signs|concomitant medications?|adverse events?)/i.test(
      normalized
    )
  ) {
    return ["schedule", "visits", "laboratory"];
  }
  if (/(endpoint|endpoints|objective|objectives)/i.test(normalized)) return ["endpoints", "objectives"];
  if (/(procedure|procedures|dosing|drug administration|laboratory|lab sample|samples)/i.test(normalized)) {
    return ["dosing", "laboratory", "visits", "schedule"];
  }
  return undefined;
}

function hasOperationalIntent(query: string) {
  const normalized = normalizeLite(query);
  return (
    /\b(task|tasks|todo|to do|overdue|assigned|assignee|owner|deadline|deadlines|due|blocked|pending|workload|backlog|map|launch|enrollment|enrolled|patient|patients|site status|study status)\b/.test(
      normalized
    ) ||
    /\b(this week|next week|this month|next 7 days)\b/.test(normalized) ||
    (/\b(today|tomorrow|yesterday|next business day)\b/.test(normalized) &&
      /\b(my|i|mine|due|task|tasks|work|todo|to do|schedule)\b/.test(normalized)) ||
    (/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/.test(normalized) &&
      /\b(due|task|tasks|work|todo|to do|schedule)\b/.test(normalized)) ||
    (/\bwhat(?:s| is)? my\b/.test(normalized) && /\b(task|tasks|work|todo|to do|week)\b/.test(normalized))
  );
}

function hasOperationalDocumentIntent(query: string) {
  const normalized = normalizeLite(query);
  const docTerms = /\b(document|documents|file|files|upload|uploaded|index|indexed|archive|archived|category|categories|hub)\b/.test(
    normalized
  );
  const managementTerms =
    /\b(status|count|counts|how many|list|latest|current|missing|ready|health|readiness|coverage|inventory|uploaded|indexed)\b/.test(
      normalized
    );
  return docTerms && managementTerms;
}

function detectQueryFocus(query: string): UnifiedQueryPlan["focus"] {
  const normalized = query.toLowerCase();
  if (/\binclusion\b/.test(normalized) && /\bcriteria?\b/.test(normalized)) return "inclusion";
  if (/\bexclusion\b/.test(normalized) && /\bcriteria?\b/.test(normalized)) return "exclusion";
  if (/\beligibility\b/.test(normalized) || /\bcriteria?\b/.test(normalized)) return "eligibility";
  if (/\bcycle\s*\d+\b|\bday\s*-?\d+\b|\bc\d+\s*d\d+\b|\bc\d+d\d+\b/.test(normalized)) {
    return "schedule";
  }
  if (
    /\b(when\s+.*\brequired|required\s+.*\bwhen|pregnancy test|12-?lead ecg|ecg|cbc|urinalysis|thyroid function|vital signs|concomitant medications?|adverse events?)\b/.test(
      normalized
    )
  ) {
    return "schedule";
  }
  if (/\bschedule(d)?\b|\btable\b|\bmatrix\b|\bvisit window\b|\bassessments?\b|\bevents?\b|\bsoa\b|\bsoe\b/.test(normalized)) {
    return "schedule";
  }
  if (/\bendpoint\b|\bobjective\b/.test(normalized)) return "endpoints";
  if (/\bprocedure\b|\bdosing\b|\bdrug administration\b|\blab\b|\bsample\b/.test(normalized)) {
    return "procedures";
  }
  if (hasOperationalIntent(query)) return "operational";
  if (/\busually\b|\btrend\b|\bpattern\b|\bhistoric/.test(normalized)) return "telemetry";
  return "general";
}

function hasAmendmentIntent(query: string) {
  return /\bamendment\b|\brevision\b|\bchange(s)?\b|\bdiff(erence)?\b|\bversion\b/i.test(query);
}

function inferRoute(query: string, hasDocs: boolean, hasTrial: boolean): UnifiedRoute {
  const normalized = normalizeLite(query);
  const docSignals =
    /\b(protocol|manual|icf|sop|amendment|criteria|inclusion|exclusion|section|page|visit window|schedule|scheduled|table|events?|endpoint|dose|dosing|procedure|pregnancy test|ecg|cbc|urinalysis|vital signs|lab|sample|required|cycle|day)\b/.test(
      normalized
    );
  const opSignals =
    hasOperationalIntent(query) ||
    hasOperationalDocumentIntent(query) ||
    /\b(team|status|progress|on track)\b/.test(normalized);
  const telemetrySignals =
    /\b(usually|historically|trend|pattern|average|common|across sites|most often|frequently)\b/.test(normalized);

  if (telemetrySignals && !docSignals && !opSignals) return "telemetry";
  if (docSignals && opSignals) return "hybrid";
  if (docSignals) return "document";
  if (opSignals) return "operational";
  if (telemetrySignals) return "telemetry";
  // Ambiguous question inside a trial with documents should default to docs.
  if (hasDocs) return "document";
  if (hasTrial) return "operational";
  return "operational";
}

export function buildUnifiedQueryPlan(query: string, hasDocs: boolean, hasTrial: boolean): UnifiedQueryPlan {
  const route = inferRoute(query, hasDocs, hasTrial);
  const focus = detectQueryFocus(query);
  const amendmentIntent = hasAmendmentIntent(query);
  const comprehensive = isComprehensiveQuestion(query);

  const tools: UnifiedTool[] = [];
  const requiredTools: UnifiedTool[] = [];
  const rationale: string[] = [];

  if (route === "document" || route === "hybrid") {
    tools.push("document_retrieval");
    requiredTools.push("document_retrieval");
    rationale.push("Document evidence required for protocol-grounded answer.");
  }
  if (route === "operational" || route === "hybrid") {
    tools.push("operational_state");
    requiredTools.push(route === "operational" ? "operational_state" : "document_retrieval");
    rationale.push("Operational state requested from live trial/task data.");
  }
  if (route === "telemetry" || route === "hybrid") {
    tools.push("telemetry_patterns");
    if (route === "telemetry") requiredTools.push("telemetry_patterns");
    rationale.push("Telemetry patterns requested for trend/pattern insight.");
  }
  if (amendmentIntent) {
    rationale.push("Amendment/version intent detected; amendment evidence is prioritized.");
  }
  if (comprehensive) {
    rationale.push("Comprehensive question detected; retrieval coverage expansion enabled.");
  }

  return {
    route,
    tools: Array.from(new Set(tools)),
    requiredTools: Array.from(new Set(requiredTools)),
    focus,
    amendmentIntent,
    comprehensive,
    rationale,
  };
}

function protocolRelevanceBoost(
  protocol: Protocol,
  queryPlan: UnifiedQueryPlan,
  sortRank: number
) {
  const category = normalizeLite(String(protocol.category || ""));
  let score = 0;

  if (protocol.isCurrent) score += 28;
  if (!protocol.archivedAt) score += 8;

  if (category.includes("protocol")) score += 20;
  if (category.includes("lab")) score += queryPlan.focus === "procedures" ? 12 : 6;
  if (category.includes("sop")) score += queryPlan.route === "hybrid" ? 8 : 4;
  if (category.includes("pharmacy")) score += queryPlan.focus === "procedures" ? 10 : 3;
  if (category.includes("icf")) score += queryPlan.focus === "eligibility" ? 8 : 2;

  const isAmendment = category.includes("amendment");
  if (isAmendment) {
    score += queryPlan.amendmentIntent ? 24 : -18;
  }

  // Keep stable deterministic order with a small tie-breaker signal.
  score += Math.max(0, 6 - sortRank);
  return score;
}

function extractTextContent(rawContent: unknown): string {
  if (typeof rawContent === "string") return rawContent;
  if (!Array.isArray(rawContent)) return "";
  return rawContent
    .filter((item) => item && typeof item === "object" && (item as any).type === "text")
    .map((item) => String((item as any).text ?? ""))
    .join("\n")
    .trim();
}

function hasDocCitation(text: string) {
  return /\[Source:\s*[^,\]]+,\s*(p|pp)\./i.test(text);
}

function hasQuotedDocumentEvidence(text: string) {
  return /["“][^"”]{15,}["”]\s*\[Source:\s*[^,\]]+,\s*(p|pp)\./i.test(text);
}

function hasOperationalCitation(text: string) {
  return /\[Operational:\s*[^\]]+\]/i.test(text);
}

function hasTelemetryCitation(text: string) {
  return /\[Telemetry:\s*[^\]]+\]/i.test(text);
}

function formatIsoNow() {
  return new Date().toISOString();
}

function parseDateLike(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }
  if (typeof value === "string") {
    const dateOnly = parseIsoDateOnlyLocal(value);
    if (dateOnly) return dateOnly;
  }
  const parsed = new Date(value as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toLocalDayTimestamp(value: unknown) {
  const parsed = parseDateLike(value);
  if (!parsed) return null;
  return startOfLocalDay(parsed).getTime();
}

function compareTasksByDueDate(a: MapTask, b: MapTask) {
  const aTs = toLocalDayTimestamp(a.dueDate) ?? Number.MAX_SAFE_INTEGER;
  const bTs = toLocalDayTimestamp(b.dueDate) ?? Number.MAX_SAFE_INTEGER;
  if (aTs !== bTs) return aTs - bTs;
  const aMap = String(a.mapId || "");
  const bMap = String(b.mapId || "");
  if (aMap !== bMap) return aMap.localeCompare(bMap);
  const aPhase = String(a.phaseId || "");
  const bPhase = String(b.phaseId || "");
  if (aPhase !== bPhase) return aPhase.localeCompare(bPhase);
  const aOrder = Number.isFinite(Number(a.orderInPhase)) ? Number(a.orderInPhase) : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(Number(b.orderInPhase)) ? Number(b.orderInPhase) : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

type QueuedTaskProjectionPoint = {
  dateKey: string;
  tasks: MapTask[];
};

function buildQueuedTaskProjection(tasks: MapTask[], windowDays = 7, reference = new Date()) {
  const now = startOfLocalDay(reference);
  const businessDates: Date[] = [];
  const cursor = new Date(now);

  while (businessDates.length < windowDays) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      businessDates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const points: QueuedTaskProjectionPoint[] = businessDates.map((date) => ({
    dateKey: formatLocalDate(date) || "",
    tasks: [],
  }));
  const indexByDate = new Map(points.map((point, index) => [point.dateKey, index]));
  const backlogPattern = [1, 2, 3, 4, 5, 6, 2, 3, 4, 5, 6, 1] as const;
  let backlogCursor = 0;

  const assignBacklogTask = (task: MapTask) => {
    if (points.length === 0) return;
    const slot = backlogPattern[backlogCursor % backlogPattern.length] ?? 1;
    backlogCursor += 1;
    const safeSlot = Math.max(1, Math.min(points.length - 1, slot));
    points[safeSlot].tasks.push(task);
  };

  const openTasks = tasks.filter((task) => isOpenTask(task)).sort(compareTasksByDueDate);
  for (const task of openTasks) {
    const dueDate = parseDateLike(task.dueDate);
    const statusToken = normalizeLite(String(task.status || ""));
    const isBlocked = statusToken === "blocked" || statusToken === "waiting";

    if (dueDate) {
      const dueKey = formatLocalDate(dueDate);
      const idx = dueKey ? indexByDate.get(dueKey) : undefined;
      if (idx != null) {
        points[idx].tasks.push(task);
        continue;
      }
      if (startOfLocalDay(dueDate).getTime() < now.getTime()) {
        points[0].tasks.push(task);
        continue;
      }
    }

    if (isBlocked) {
      points[0].tasks.push(task);
      continue;
    }

    assignBacklogTask(task);
  }

  return points;
}

function formatShortDate(value: unknown) {
  const localDate = formatLocalDate(value);
  return localDate || "unscheduled";
}

function formatLocalDate(value: unknown) {
  const parsed = parseDateLike(value);
  if (!parsed) return null;
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function parseIsoDateOnlyLocal(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function parseOperationalTargetDate(query: string): Date | null {
  const raw = String(query || "").toLowerCase();
  const now = startOfLocalDay(new Date());

  if (/\bday after tomorrow\b/.test(raw)) return addLocalDays(now, 2);
  if (/\btomorrow\b/.test(raw)) return addLocalDays(now, 1);
  if (/\btoday\b/.test(raw)) return now;
  if (/\byesterday\b/.test(raw)) return addLocalDays(now, -1);

  const isoMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    const parsed = parseIsoDateOnlyLocal(isoMatch[1]);
    if (parsed) return startOfLocalDay(parsed);
  }

  const usDateMatch = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (usDateMatch) {
    const month = Number(usDateMatch[1]);
    const day = Number(usDateMatch[2]);
    const yearToken = usDateMatch[3];
    const currentYear = now.getFullYear();
    const year = yearToken
      ? Number(yearToken.length === 2 ? `20${yearToken}` : yearToken)
      : currentYear;
    if (Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(year)) {
      const parsed = new Date(year, month - 1, day);
      if (
        parsed.getFullYear() === year &&
        parsed.getMonth() === month - 1 &&
        parsed.getDate() === day
      ) {
        return startOfLocalDay(parsed);
      }
    }
  }

  const monthNameMatch = raw.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b/i
  );
  if (monthNameMatch) {
    const parsed = new Date(monthNameMatch[0]);
    if (!Number.isNaN(parsed.getTime())) return startOfLocalDay(parsed);
  }

  return null;
}

function isOpenTask(task: MapTask) {
  return task.status !== "done" && task.status !== "cancelled" && task.status !== "skipped";
}

function buildOperationalTaskItem(
  task: MapTask,
  options: {
    mapTrialById: Map<string, string>;
    trialLabelById?: Map<string, string>;
    phaseById?: Map<string, MapPhase>;
  }
): OperationalTaskItem | null {
  const mapId = String(task.mapId || "");
  if (!mapId) return null;
  const trialIdRaw = String(options.mapTrialById.get(mapId) || "");
  const trialId = trialIdRaw ? stripDemoId(trialIdRaw) : "";
  if (!trialId) return null;
  const phaseId = String(task.phaseId || "") || null;
  const phase = phaseId ? options.phaseById?.get(phaseId) : undefined;
  return {
    taskId: String(task.id || ""),
    mapId,
    trialId,
    trialLabel: trialIdRaw ? options.trialLabelById?.get(trialIdRaw) || null : null,
    taskName: String(task.name || "").trim() || "Untitled task",
    dueDate: formatLocalDate(task.dueDate),
    status: task.status || null,
    assignedRole: task.assignedRole || null,
    assigneeName: task.suggestedAssignee || null,
    phaseId,
    phaseName: phase?.name || null,
  };
}

function pickPreferredExecutionMap(rows: ExecutionMap[], includeArchived = false) {
  const filtered = includeArchived ? rows : rows.filter((row) => row.status !== "archived");
  if (!filtered.length) return null;
  const rank: Record<ExecutionMap["status"], number> = {
    active: 0,
    revised: 1,
    draft: 2,
    archived: 3,
  };
  const sorted = [...filtered].sort((a, b) => {
    const statusRank = rank[a.status] - rank[b.status];
    if (statusRank !== 0) return statusRank;
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return sorted[0] || null;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isAbstainLanguage(answer: string) {
  const normalized = answer.toLowerCase();
  return (
    normalized.includes("i don't have enough evidence") ||
    normalized.includes("insufficient evidence") ||
    normalized.includes("not available in the provided evidence") ||
    normalized.includes("cannot determine from the provided sources")
  );
}

async function resolveProtocolsForScope(
  db: any,
  explicitProtocolIds: string[] | undefined,
  trialId: string | undefined,
  queryPlan: UnifiedQueryPlan,
  demoMode?: "sample" | "full" | "building"
): Promise<Protocol[]> {
  const sortByPrecedence = (rows: Protocol[]) => {
    const scored = rows.map((protocol, index) => ({
      protocol,
      score: protocolRelevanceBoost(protocol, queryPlan, index),
      ts: protocol.createdAt ? new Date(protocol.createdAt).getTime() : 0,
    }));
    scored.sort((a, b) => b.score - a.score || b.ts - a.ts);
    return scored.map((row) => row.protocol);
  };

  if (explicitProtocolIds && explicitProtocolIds.length > 0) {
    const rows = (await db.select().from(protocols).where(inArray(protocols.coreBackendDocumentId, explicitProtocolIds))) as Protocol[];
    return sortByPrecedence(rows);
  }
  if (!trialId) {
    if (demoMode) {
      const modePrefix = `${demoMode}:%`;
      const activeScoped = (await db
        .select()
        .from(protocols)
        .where(and(isNull(protocols.archivedAt), like(protocols.trialId, modePrefix)))
        .orderBy(desc(protocols.createdAt))) as Protocol[];
      if (activeScoped.length > 0) return sortByPrecedence(activeScoped);

      if (demoMode !== "building") {
        const activeLegacy = (await db
          .select()
          .from(protocols)
          .where(and(isNull(protocols.archivedAt), notLike(protocols.trialId, "%:%")))
          .orderBy(desc(protocols.createdAt))) as Protocol[];
        if (activeLegacy.length > 0) return sortByPrecedence(activeLegacy);
      }

      const scopedAll = (await db
        .select()
        .from(protocols)
        .where(like(protocols.trialId, modePrefix))
        .orderBy(desc(protocols.createdAt))) as Protocol[];
      if (scopedAll.length > 0) return sortByPrecedence(scopedAll);

      if (demoMode !== "building") {
        const legacyAll = (await db
          .select()
          .from(protocols)
          .where(notLike(protocols.trialId, "%:%"))
          .orderBy(desc(protocols.createdAt))) as Protocol[];
        if (legacyAll.length > 0) return sortByPrecedence(legacyAll);
      }

      return [];
    }

    const activeAll = (await db
      .select()
      .from(protocols)
      .where(isNull(protocols.archivedAt))
      .orderBy(desc(protocols.createdAt))) as Protocol[];
    if (activeAll.length > 0) return sortByPrecedence(activeAll);
    const all = (await db.select().from(protocols).orderBy(desc(protocols.createdAt))) as Protocol[];
    return sortByPrecedence(all);
  }

  const active = (await db
    .select()
    .from(protocols)
    .where(and(eq(protocols.trialId, trialId), isNull(protocols.archivedAt)))
    .orderBy(desc(protocols.createdAt))) as Protocol[];

  if (active.length > 0) return sortByPrecedence(active);
  const all = (await db.select().from(protocols).where(eq(protocols.trialId, trialId)).orderBy(desc(protocols.createdAt))) as Protocol[];
  return sortByPrecedence(all);
}

async function collectDocumentEvidence(
  db: any,
  query: string,
  protocolRows: Protocol[],
  queryPlan: UnifiedQueryPlan
) {
  if (protocolRows.length === 0) {
    return {
      evidence: [] as DocumentEvidence[],
      chunks: [] as ProtocolContextChunk[],
      debug: {
        hints: [],
        expandedQuery: query,
        queryExpansionMatches: [],
        routing: {
          preferredChunkTypes: [],
          boostSections: [],
          minChunks: 3,
          maxChunks: 8,
          requireCompletenessCheck: false,
        },
        comprehensive: false,
        candidateCount: 0,
        selectedCount: 0,
        candidates: [],
      } satisfies DocumentRetrievalDebug,
    };
  }

  const hints = getSectionTypeHints(query);
  const queryExpansion = expandClinicalQuery(query);
  const routing = classifyRetrievalRouting(query);
  const relevanceQuery = queryExpansion.expandedQuery || query;
  const comprehensive = isComprehensiveQuestion(query) || routing.requireCompletenessCheck;

  const grouped = await Promise.all(
    protocolRows.map(async (protocol) => {
      const requestBase = {
        protocolId: protocol.coreBackendDocumentId ?? String(protocol.id),
        query,
        expandedQuery: queryExpansion.expandedQuery,
        preferredChunkTypes: routing.preferredChunkTypes,
        boostSections: routing.boostSections,
        comprehensive: true as const,
        limit: comprehensive ? Math.max(10, routing.minChunks) : Math.max(6, routing.minChunks),
      };

      const broad = await getProtocolContextChunks(requestBase);
      if (!hints || hints.length === 0) return broad;

      const focused = await getProtocolContextChunks({
        ...requestBase,
        sectionTypes: hints,
      });
      if (focused.length === 0) return broad;

      const merged = [...focused];
      const seen = new Set(merged.map((chunk) => chunk.id));
      for (const chunk of broad) {
        if (seen.has(chunk.id)) continue;
        merged.push(chunk);
        seen.add(chunk.id);
      }
      return merged;
    })
  );

  const allChunks = grouped.flat();
  const dedup = new Map<number, ProtocolContextChunk>();
  for (const chunk of allChunks) dedup.set(chunk.id, chunk);
  const uniqueChunks = Array.from(dedup.values());
  const structuredSchedulePreferred =
    queryPlan.focus === "schedule" ? collectStructuredScheduleEvidence(uniqueChunks) : null;

  const candidateDiagnosticsBase = uniqueChunks
    .map((chunk) => {
      const lexical = chunk.retrievalScores?.lexical ?? scoreChunkLite(relevanceQuery, chunk);
      const semantic = chunk.retrievalScores?.semantic ?? 0;
      const direct = chunk.score ?? 0;
      const preferredTypeBoost = chunkMatchesPreferredType(chunk, routing.preferredChunkTypes) ? 12 : 0;
      return {
        chunk,
        score: chunkRelevanceScore(relevanceQuery, chunk) + preferredTypeBoost,
        lexical,
        semantic,
        direct,
        scheduleLike: isScheduleLikeChunk(chunk),
        amendmentLike: isAmendmentLikeChunk(chunk),
        chunkType: String(chunk.metadata?.chunkType || "").trim() || null,
      };
    })
    .sort((a, b) => b.score - a.score);

  const baseLimit = comprehensive
    ? Math.max(72, routing.maxChunks * 4)
    : Math.max(queryPlan.focus === "schedule" ? 14 : 24, routing.maxChunks);
  const ranked = uniqueChunks
    .map((chunk) => ({
      chunk,
      score:
        chunkRelevanceScore(relevanceQuery, chunk) +
        (chunkMatchesPreferredType(chunk, routing.preferredChunkTypes) ? 12 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, baseLimit);

  const suppressAmendments =
    !queryPlan.amendmentIntent &&
    (queryPlan.focus === "inclusion" ||
      queryPlan.focus === "exclusion" ||
      queryPlan.focus === "eligibility" ||
      queryPlan.focus === "schedule");

  let selectedRanked = ranked;
  if (suppressAmendments) {
    const canonical = ranked.filter((item) => !isAmendmentLikeChunk(item.chunk));
    if (canonical.length > 0) selectedRanked = canonical;
  }

  if (queryPlan.focus === "schedule") {
    const scheduleBoosted = uniqueChunks
      .filter(
        (chunk) => isScheduleLikeChunk(chunk) || chunkMatchesPreferredType(chunk, routing.preferredChunkTypes)
      )
      .filter((chunk) => !suppressAmendments || !isAmendmentLikeChunk(chunk))
      .map((chunk) => ({
        chunk,
        score: Math.max(chunkRelevanceScore(query, chunk), 22),
      }));
    if (scheduleBoosted.length > 0) {
      const merged = new Map<number, { chunk: ProtocolContextChunk; score: number }>();
      for (const item of selectedRanked) merged.set(item.chunk.id, item);
      for (const item of scheduleBoosted) {
        const existing = merged.get(item.chunk.id);
        if (!existing || item.score > existing.score) merged.set(item.chunk.id, item);
      }
      selectedRanked = Array.from(merged.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, comprehensive ? 72 : baseLimit + 2);
    }

    const sourcePages = structuredSchedulePreferred?.structured?.sourcePages || [];
    if (!comprehensive && sourcePages.length > 0) {
      const pageSet = new Set(sourcePages.filter((page) => Number.isFinite(page)));
      const scoped = selectedRanked.filter((item) => {
        if (structuredSchedulePreferred && item.chunk.id === structuredSchedulePreferred.chunk.id) return true;
        return chunkTouchesAnyPage(item.chunk, pageSet);
      });
      if (scoped.length > 0) {
        selectedRanked = scoped
          .sort((a, b) => b.score - a.score)
          .slice(0, baseLimit);
      }
    }
  }
  const selectedChunks = selectedRanked.map((item) => item.chunk);
  const selectedIds = new Set(selectedChunks.map((chunk) => chunk.id));

  const protocolById = new Map(
    protocolRows.map((protocol) => [protocol.coreBackendDocumentId ?? String(protocol.id), protocol])
  );
  const evidence = selectedRanked.map(({ chunk, score }): DocumentEvidence => {
    const protocol = protocolById.get(chunk.protocolId);
    return {
      protocolId: chunk.protocolId,
      filename: protocol?.filename || chunk.citation.filename,
      fileUrl: protocol?.fileUrl ?? null,
      section: chunk.sectionTitle || chunk.sectionType,
      pageLabel: chunk.citation.page,
      page: chunk.pageStart ?? chunk.pageEnd ?? null,
      excerpt: chunk.chunkText.slice(0, 320),
      score,
    };
  });

  const debug: DocumentRetrievalDebug = {
    hints: hints ?? [],
    expandedQuery: queryExpansion.expandedQuery,
    queryExpansionMatches: queryExpansion.matchedTerms,
    routing,
    comprehensive,
    candidateCount: candidateDiagnosticsBase.length,
    selectedCount: selectedChunks.length,
    candidates: candidateDiagnosticsBase.slice(0, comprehensive ? 120 : 80).map((item, index) => ({
      rank: index + 1,
      selected: selectedIds.has(item.chunk.id),
      chunkId: item.chunk.id,
      protocolId: item.chunk.protocolId,
      sectionType: item.chunk.sectionType,
      sectionTitle: item.chunk.sectionTitle,
      pageStart: item.chunk.pageStart,
      pageEnd: item.chunk.pageEnd,
      pageLabel: item.chunk.citation.page,
      chunkType: item.chunkType,
      score: Number(item.score.toFixed(4)),
      lexical: Number(item.lexical.toFixed(4)),
      semantic: Number(item.semantic.toFixed(4)),
      direct: Number(item.direct.toFixed(4)),
      scheduleLike: item.scheduleLike,
      amendmentLike: item.amendmentLike,
      excerpt: item.chunk.chunkText.slice(0, 260),
    })),
  };

  return { evidence, chunks: selectedChunks, debug };
}

type CriteriaEntry = {
  index: string;
  text: string;
};

type StructuredCriteriaLike = {
  inclusion?: CriteriaEntry[];
  exclusion?: CriteriaEntry[];
  sourcePages?: number[];
  inclusionSourcePages?: number[];
  exclusionSourcePages?: number[];
  inclusionVerbatim?: string;
  exclusionVerbatim?: string;
};

type StructuredScheduleLike = {
  visits?: Array<{ name: string; day?: string | null }>;
  procedures?: Array<{ name: string; category?: string | null }>;
  entries?: Array<{ procedure: string; visit: string; required: boolean; footnoteRef?: string | null }>;
  footnotes?: Array<{ number: string; text: string }>;
  table?: {
    table_title?: string;
    section?: string;
    column_headers?: string[][];
    rows?: Array<{
      category?: string | null;
      procedure: string;
      cells: string[];
    }>;
    footnotes?: Array<{ marker: string; text: string }>;
    page_numbers?: number[];
  } | null;
  sourcePages?: number[];
};

function parseTopIndex(index: string) {
  const match = String(index || "").match(/^(\d{1,2})\./);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxTopIndex(entries: CriteriaEntry[]) {
  return entries.reduce((max, entry) => {
    const parsed = parseTopIndex(entry.index);
    if (!parsed) return max;
    return Math.max(max, parsed);
  }, 0);
}

function trimCriteriaVerbatim(
  text: string,
  focus: "inclusion" | "exclusion",
  expectedEntries: CriteriaEntry[]
) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  const focusNeedle = focus === "inclusion" ? /\binclusion criteria\b/i : /\bexclusion criteria\b/i;
  const oppositeNeedle = focus === "inclusion" ? /\bexclusion criteria\b/i : /\binclusion criteria\b/i;
  const isOppositeCriteriaHeading = (line: string) => {
    if (!oppositeNeedle.test(line)) return false;
    const normalized = line.trim();
    const strictHeading =
      /^(?:\d+(?:\.\d+){0,2}\s+)?(?:study population\s+)?(?:inclusion|exclusion)\s+criteria\s*(?:\([^)]+\))?\s*:?\s*$/i;
    return strictHeading.test(normalized);
  };
  const startIndex = lines.findIndex((line) => focusNeedle.test(line));
  const body = startIndex >= 0 ? lines.slice(startIndex) : lines;
  const expectedMax = maxTopIndex(expectedEntries);
  const enforceNumericCap = expectedEntries.length >= 8 && expectedMax >= 8;

  const out: string[] = [];
  let reachedExpectedMax = false;
  for (const line of body) {
    if (out.length > 0 && isOppositeCriteriaHeading(line)) break;
    if (
      out.length > 0 &&
      /^(study objectives?|secondary objectives?|primary endpoints?|secondary endpoints?|statistical|study design)\b/i.test(
        line
      )
    ) {
      break;
    }

    const topMatch = line.match(/^(\d{1,2})[\).\s-]+/);
    if (topMatch) {
      const n = Number.parseInt(topMatch[1], 10);
      if (enforceNumericCap && n > expectedMax + 1) break;
      if (enforceNumericCap && n >= expectedMax) reachedExpectedMax = true;
      if (reachedExpectedMax && out.length > 0 && /^(appendix|section)\b/i.test(line)) break;
    }

    out.push(line);
    if (out.length >= 240) break;
  }

  const clipped = out.join("\n").trim();
  if (!clipped) return raw;
  return clipped;
}

function formatPageLabelFromPages(pages: number[] | undefined, fallback: string) {
  if (!pages || pages.length === 0) return fallback;
  const sorted = [...pages].filter((page) => Number.isFinite(page)).sort((a, b) => a - b);
  if (sorted.length === 0) return fallback;
  if (sorted.length === 1) return `p. ${sorted[0]}`;
  return `pp. ${sorted[0]}-${sorted[sorted.length - 1]}`;
}

function collectStructuredCriteriaEvidence(chunks: ProtocolContextChunk[]) {
  const candidates = chunks
    .map((chunk) => {
      const structured = chunk.metadata?.structuredCriteria as StructuredCriteriaLike | undefined;
      if (!structured) return null;
      const inclusion = Array.isArray(structured.inclusion) ? structured.inclusion : [];
      const exclusion = Array.isArray(structured.exclusion) ? structured.exclusion : [];
      const total = inclusion.length + exclusion.length;
      if (total === 0) return null;
      const pageLabel = formatPageLabelFromPages(structured.sourcePages, chunk.citation.page);
      return {
        chunk,
        structured,
        total,
        pageLabel,
        amendmentLike: isAmendmentLikeChunk(chunk),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      const aScore = (a.amendmentLike ? -100 : 100) + a.total;
      const bScore = (b.amendmentLike ? -100 : 100) + b.total;
      return bScore - aScore;
    });

  return candidates[0] ?? null;
}

function collectStructuredScheduleEvidence(chunks: ProtocolContextChunk[]) {
  const candidates = chunks
    .map((chunk) => {
      const structured = chunk.metadata?.structuredSchedule as StructuredScheduleLike | undefined;
      if (!structured) return null;
      const entries = Array.isArray(structured.entries) ? structured.entries : [];
      const visits = Array.isArray(structured.visits) ? structured.visits : [];
      const total = entries.length + visits.length;
      if (total === 0) return null;
      return {
        chunk,
        structured,
        total,
        pageLabel: formatPageLabelFromPages(structured.sourcePages, chunk.citation.page),
        amendmentLike: isAmendmentLikeChunk(chunk),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      const aScore = (a.amendmentLike ? -100 : 100) + a.total;
      const bScore = (b.amendmentLike ? -100 : 100) + b.total;
      return bScore - aScore;
    });
  return candidates[0] ?? null;
}

function unwrapChunkTextForTable(value: string) {
  const text = String(value || "");
  if (!text.startsWith("Section:")) return text;
  const parts = text.split(/\n\s*\n/);
  if (parts.length <= 1) return text;
  return parts.slice(1).join("\n\n").trim();
}

function buildScheduleSourceText(chunks: ProtocolContextChunk[], sourcePages?: number[]) {
  const preferredPages = new Set((sourcePages || []).filter((n) => Number.isFinite(n)));
  const candidates = chunks
    .filter((chunk) => isScheduleLikeChunk(chunk))
    .sort((a, b) => {
      const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.id - b.id;
    });

  const preferred = preferredPages.size
    ? candidates.filter((chunk) => {
        const p = chunk.pageStart ?? chunk.pageEnd;
        return p !== null && preferredPages.has(p);
      })
    : [];
  const source = preferred.length > 0 ? preferred : candidates;
  return source
    .map((chunk) => {
      const p = chunk.pageStart ?? chunk.pageEnd;
      const pageLabel = p ? `p. ${p}` : chunk.citation.page;
      return `Section: ${chunk.sectionTitle || chunk.sectionType} (${pageLabel})\n${unwrapChunkTextForTable(chunk.chunkText)}`;
    })
    .join("\n\n")
    .slice(0, 42000);
}

async function buildScheduleSourceTextFromPdf(fileUrl: string, sourcePages?: number[]) {
  try {
    const pages = await extractPdfPages(fileUrl);
    if (!pages.length) return "";
    const preferred = new Set((sourcePages || []).filter((page) => Number.isFinite(page)));
    const selectedPages =
      preferred.size > 0
        ? pages.filter((page) => preferred.has(page.pageNumber))
        : pages.slice(0, Math.min(8, pages.length));
    if (!selectedPages.length) return "";
    return selectedPages
      .map((page) => `Page ${page.pageNumber}\n${page.text}`)
      .join("\n\n")
      .slice(0, 46000);
  } catch {
    return "";
  }
}

async function invokeScheduleAssistFromPdf(options: {
  query: string;
  fileUrl: string;
  sourcePages?: number[];
}): Promise<{
  requiredProcedures: string[];
  requiredVisits: string[];
} | null> {
  const fileUrl = String(options.fileUrl || "").trim();
  if (!fileUrl) return null;
  const pageHints = Array.from(new Set((options.sourcePages || []).filter((page) => Number.isFinite(page)))).sort(
    (a, b) => a - b
  );
  const pageHintText =
    pageHints.length > 0
      ? `Prioritize Schedule table pages: ${pageHints.join(", ")}.`
      : "Find the Schedule of Events / Schedule of Assessments table in this protocol.";
  const intent = extractVisitIntent(options.query);
  const intentHint = intent
    ? `Target intent:
- cycle: ${intent.cycle ?? "n/a"}
- day: ${intent.day ?? "n/a"}
- screening: ${intent.screening ? "yes" : "no"}
- follow_up: ${intent.followUp ? "yes" : "no"}
- end_of_treatment: ${intent.endOfTreatment ? "yes" : "no"}`
    : "Target intent: procedure lookup or schedule lookup (no explicit cycle/day parsed).";

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You extract exact required visit/procedure facts from clinical trial schedule tables. Return only JSON. Do not paraphrase or invent.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Question: ${options.query}

${pageHintText}
${intentHint}

Rules:
- Parse the schedule table across ALL continuation pages before answering.
- A row is required for a visit/day if the cell contains X/check/required marker (including X with footnote marker).
- For visit/day questions, return every required procedure in requiredProcedures.
- For procedure questions (e.g., "when is Pregnancy Test required?"), return every required visit/day in requiredVisits.
- Ignore section headers and legend rows.
- Return concrete labels exactly as written in the table.

Return JSON:
{
  "requiredProcedures": ["..."],
  "requiredVisits": ["..."]
}`,
            },
            {
              type: "file_url",
              file_url: {
                url: fileUrl,
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "schedule_query_assist_from_pdf",
          strict: true,
          schema: {
            type: "object",
            properties: {
              requiredProcedures: {
                type: "array",
                items: { type: "string" },
              },
              requiredVisits: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["requiredProcedures", "requiredVisits"],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 1400,
    });
    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    const parsed = JSON.parse(content) as { requiredProcedures?: string[]; requiredVisits?: string[] };
    return {
      requiredProcedures: Array.isArray(parsed.requiredProcedures)
        ? Array.from(new Set(parsed.requiredProcedures.map((v) => String(v || "").trim()).filter(Boolean)))
        : [],
      requiredVisits: Array.isArray(parsed.requiredVisits)
        ? Array.from(new Set(parsed.requiredVisits.map((v) => String(v || "").trim()).filter(Boolean)))
        : [],
    };
  } catch {
    return null;
  }
}

async function invokeExactVisitAssistFromPdf(options: {
  query: string;
  fileUrl: string;
  sourcePages?: number[];
  intent: NonNullable<ReturnType<typeof extractVisitIntent>>;
}): Promise<string[] | null> {
  const fileUrl = String(options.fileUrl || "").trim();
  if (!fileUrl) return null;
  const pageHints = Array.from(new Set((options.sourcePages || []).filter((page) => Number.isFinite(page)))).sort(
    (a, b) => a - b
  );
  const pageHintText =
    pageHints.length > 0
      ? `Prioritize Schedule table pages: ${pageHints.join(", ")}.`
      : "Find the Schedule of Events / Schedule of Assessments table in this protocol.";

  const selector = `cycle=${options.intent.cycle ?? "n/a"}, day=${options.intent.day ?? "n/a"}, screening=${
    options.intent.screening ? "yes" : "no"
  }, follow_up=${options.intent.followUp ? "yes" : "no"}, end_of_treatment=${
    options.intent.endOfTreatment ? "yes" : "no"
  }`;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You extract exact required procedures from a single Schedule table column in a clinical protocol. Missing a required row is a critical error. Return only JSON. Never include adjacent columns.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Question: ${options.query}

${pageHintText}
Target visit selector: ${selector}

Rules:
- The schedule may be split across multiple pages/segments with repeated headers; include rows from all segments.
- Identify the exact schedule column matching the target selector.
- Return ONLY procedures with X/check/required marker in that exact column.
- Do NOT include procedures from adjacent columns (e.g., same cycle day 8/day 15, windows, or other cycles).
- If cycle and day are both provided, both must match.
- Ignore section headers/legend rows.
- Perform a two-pass check before returning:
  1) collect all marked rows in the exact column
  2) rescan all table segments/pages and add any missed marked rows
- Include each distinct procedure once.

Return JSON:
{
  "requiredProcedures": ["..."]
}`,
            },
            {
              type: "file_url",
              file_url: {
                url: fileUrl,
                mime_type: "application/pdf",
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "schedule_exact_visit_assist_from_pdf",
          strict: true,
          schema: {
            type: "object",
            properties: {
              requiredProcedures: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["requiredProcedures"],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 1800,
    });
    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    const parsed = JSON.parse(content) as { requiredProcedures?: string[] };
    const list = Array.isArray(parsed.requiredProcedures)
      ? Array.from(new Set(parsed.requiredProcedures.map((v) => String(v || "").trim()).filter(Boolean)))
      : [];
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

async function extractScheduleAnswerAssist(
  query: string,
  chunks: ProtocolContextChunk[],
  sourcePages?: number[],
  protocolFileUrl?: string | null
): Promise<{
  requiredProcedures: string[];
  requiredVisits: string[];
} | null> {
  const intent = extractVisitIntent(query);
  const intentHint = intent
    ? `Target visit intent: cycle=${intent.cycle ?? "n/a"}, day=${intent.day ?? "n/a"}, screening=${intent.screening ? "yes" : "no"}, follow_up=${intent.followUp ? "yes" : "no"}, end_of_treatment=${intent.endOfTreatment ? "yes" : "no"}`
    : "Target visit intent: none";
  const mergedProcedures: string[] = [];
  const mergedVisits: string[] = [];
  const sourceKinds: string[] = [];

  const mergeValues = (values: string[], target: string[]) => {
    for (const value of values) {
      const cleaned = String(value || "").replace(/\s+/g, " ").trim();
      if (!cleaned) continue;
      if (!target.includes(cleaned)) target.push(cleaned);
    }
  };

  if (protocolFileUrl) {
    const pdfAssist = await invokeScheduleAssistFromPdf({
      query,
      fileUrl: protocolFileUrl,
      sourcePages,
    });
    if (pdfAssist) {
      mergeValues(pdfAssist.requiredProcedures, mergedProcedures);
      mergeValues(pdfAssist.requiredVisits, mergedVisits);
      sourceKinds.push("file");
    }
  }

  let sourceText = buildScheduleSourceText(chunks, sourcePages);
  if (!sourceText.trim() && protocolFileUrl) {
    sourceText = await buildScheduleSourceTextFromPdf(protocolFileUrl, sourcePages);
  }
  if (sourceText.trim()) {
    try {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "You extract exact required procedures/visits from Schedule of Events text. Return only JSON. Be exhaustive across page breaks. Never invent.",
          },
          {
            role: "user",
            content: `Question: ${query}
${intentHint}

Schedule table text:
${sourceText}

Return JSON:
{
  "requiredProcedures": ["..."],
  "requiredVisits": ["..."]
}

Rules:
- requiredProcedures: use when question is about a specific visit/day/cycle.
- requiredVisits: use when question is about when a procedure is required.
- Include only items explicitly marked required in the schedule text.
- The schedule table may continue across page breaks; merge all continuation pages before deciding.
- If cycle/day is specified above, include ALL rows with required markers in that exact cycle/day column.
- Return only concrete procedure names (no section headers, no explanatory prose).`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "schedule_query_assist",
            strict: true,
            schema: {
              type: "object",
              properties: {
                requiredProcedures: {
                  type: "array",
                  items: { type: "string" },
                },
                requiredVisits: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["requiredProcedures", "requiredVisits"],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response.choices[0]?.message?.content;
      if (content && typeof content === "string") {
        const parsed = JSON.parse(content) as { requiredProcedures?: string[]; requiredVisits?: string[] };
        mergeValues(Array.isArray(parsed.requiredProcedures) ? parsed.requiredProcedures : [], mergedProcedures);
        mergeValues(Array.isArray(parsed.requiredVisits) ? parsed.requiredVisits : [], mergedVisits);
        sourceKinds.push("text");
      }
    } catch {
      // Keep best-effort assist behavior.
    }
  }

  if (mergedProcedures.length === 0 && mergedVisits.length === 0) return null;
  console.log(
    `[unifiedQuery] scheduleAssist source=${sourceKinds.join("+") || "none"} pages=${
      sourcePages?.length ? sourcePages.join(",") : "n/a"
    } procedures=${mergedProcedures.length} visits=${mergedVisits.length}`
  );
  return {
    requiredProcedures: mergedProcedures,
    requiredVisits: mergedVisits,
  };
}

function extractVisitIntent(query: string) {
  const normalized = normalizeLite(query);
  const cycleMatch = normalized.match(/\bcycle\s*(\d{1,2})\b/);
  const dayMatch = normalized.match(/\bday\s*(-?\d{1,3})\b/);
  const compactMatch = normalized.match(/\bc(\d{1,2})\s*d(\d{1,3})\b/);
  const cycle = compactMatch?.[1] || cycleMatch?.[1] || null;
  const day = compactMatch?.[2] || dayMatch?.[1] || null;
  const screening = /\bscreening\b/.test(normalized);
  const followUp = /\bfollow[\s-]?up\b|\bsafety f\/?u\b/.test(normalized);
  const endOfTreatment = /\bend of treatment\b|\beot\b|\bend of study\b/.test(normalized);

  if (!cycle && !day && !screening && !followUp && !endOfTreatment) return null;
  return { cycle, day, screening, followUp, endOfTreatment };
}

function hasAnaphoricVisitReference(query: string) {
  const normalized = normalizeLite(query);
  return /\bthat day\b|\bthat visit\b|\bthat cycle\b|\bon that day\b|\bat that visit\b|\bfor that day\b|\bfor that visit\b/.test(
    normalized
  );
}

function buildVisitIntentSuffix(intent: NonNullable<ReturnType<typeof extractVisitIntent>>) {
  const parts: string[] = [];
  if (intent.screening) parts.push("screening");
  if (intent.cycle) parts.push(`cycle ${intent.cycle}`);
  if (intent.day) parts.push(`day ${intent.day}`);
  if (intent.followUp) parts.push("follow-up");
  if (intent.endOfTreatment) parts.push("end of treatment");
  return parts.join(" ").trim();
}

function applyHistoryVisitContext(query: string, messages?: Array<{ role: "user" | "assistant"; content: string }>) {
  const baseQuery = String(query || "").trim();
  if (!baseQuery) return baseQuery;
  if (extractVisitIntent(baseQuery)) return baseQuery;
  if (!hasAnaphoricVisitReference(baseQuery)) return baseQuery;

  const history = Array.isArray(messages) ? messages : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (!message || message.role !== "user") continue;
    const content = String(message.content || "").trim();
    if (!content) continue;
    if (normalizeLite(content) === normalizeLite(baseQuery)) continue;
    const intent = extractVisitIntent(content);
    if (!intent) continue;
    const suffix = buildVisitIntentSuffix(intent);
    if (!suffix) continue;
    return `${baseQuery} ${suffix}`.trim();
  }
  return baseQuery;
}

function buildVisitLabel(visit: { name: string; day?: string | null }) {
  return `${visit.name}${visit.day ? ` ${visit.day}` : ""}`.trim();
}

function tableCellMarkedRequired(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /(^|[^a-z0-9])(x|✓|✔|☑)([^a-z0-9]|$)/i.test(raw);
}

function resolveVisitColumnsFromStructuredTable(
  table: NonNullable<StructuredScheduleLike["table"]>,
  intent: NonNullable<ReturnType<typeof extractVisitIntent>>
) {
  const headers = Array.isArray(table.column_headers) ? table.column_headers : [];
  if (headers.length === 0) return [];
  const columnCount = headers.reduce((max, row) => Math.max(max, row.length), 0);
  const targetCycle = intent.cycle ? Number.parseInt(intent.cycle, 10) : null;
  const targetDay = intent.day ? Number.parseInt(intent.day, 10) : null;

  const columns = Array.from({ length: columnCount }, (_, index) => {
    const fragments = headers
      .map((row) => String(row[index] || "").trim())
      .filter(Boolean);
    const compactFragments = fragments.filter((value, position) => position === 0 || value !== fragments[position - 1]);
    const label = compactFragments.join(" ").replace(/\s+/g, " ").trim();
    const normalizedLabel = normalizeLite(label);

    let cycle: number | null = null;
    let day: number | null = null;
    for (const fragment of compactFragments) {
      const cycleMatch = normalizeLite(fragment).match(/\bcycle\s*(\d{1,2})\b|\bc(\d{1,2})\b/);
      if (cycleMatch) {
        cycle = Number.parseInt(cycleMatch[1] || cycleMatch[2], 10);
      }
      const dayMatch = normalizeLite(fragment).match(/\bday\s*(-?\d{1,3})\b|\bd(-?\d{1,3})\b/);
      if (dayMatch) {
        day = Number.parseInt(dayMatch[1] || dayMatch[2], 10);
      } else if (/^-?\d{1,3}$/.test(fragment.trim())) {
        const asNumber = Number.parseInt(fragment.trim(), 10);
        if (Number.isFinite(asNumber)) day = asNumber;
      }
    }

    const matchesSpecial =
      (intent.screening && /\bscreening\b/.test(normalizedLabel)) ||
      (intent.followUp && /\bfollow[\s-]?up\b|\bf\/?u\b/.test(normalizedLabel)) ||
      (intent.endOfTreatment && /\bend of treatment\b|\beot\b|\bend of study\b/.test(normalizedLabel));
    const matchesCycle =
      targetCycle == null
        ? true
        : cycle === targetCycle || new RegExp(`\\bcycle\\s*${targetCycle}\\b|\\bc${targetCycle}\\b`).test(normalizedLabel);
    const matchesDay =
      targetDay == null
        ? true
        : day != null
        ? day === targetDay
        : new RegExp(`\\bday\\s*${targetDay}\\b|\\bd${targetDay}\\b`).test(normalizedLabel);

    return {
      index,
      label,
      cycle,
      day,
      normalizedLabel,
      match:
        matchesSpecial ||
        ((!intent.screening && !intent.followUp && !intent.endOfTreatment) && matchesCycle && matchesDay),
    };
  });

  return columns.filter((column) => column.match);
}

function getRequiredProceduresForVisitColumns(
  schedule: StructuredScheduleLike,
  columns: Array<{ index: number; label: string }>
) {
  const table = schedule.table;
  if (!table || !Array.isArray(table.rows) || table.rows.length === 0 || columns.length === 0) return [];
  const tableColumnCount = (Array.isArray(table.column_headers) ? table.column_headers : []).reduce(
    (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
    0
  );
  const hasProcedureHeaderInFirstColumn = (Array.isArray(table.column_headers) ? table.column_headers : []).some(
    (row) => normalizeLite(String(Array.isArray(row) ? row[0] || "" : "")).includes("study procedure")
  );
  const byProcedure = new Map<string, string>();
  for (const row of table.rows) {
    const procedure = String(row.procedure || "").replace(/\s+/g, " ").trim();
    if (!procedure) continue;
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const rowHasProcedureCell = tableColumnCount > 0 && cells.length === tableColumnCount;
    const resolveCellIndex = (columnIndex: number) => {
      if (!hasProcedureHeaderInFirstColumn) return columnIndex;
      if (rowHasProcedureCell) return columnIndex;
      if (columnIndex <= 0) return -1;
      return columnIndex - 1;
    };
    const required = columns.some((column) => {
      const cellIndex = resolveCellIndex(column.index);
      if (cellIndex < 0) return false;
      return tableCellMarkedRequired(String(cells[cellIndex] || ""));
    });
    if (!required) continue;
    const key = normalizeProcedureName(procedure);
    if (!key) continue;
    if (!byProcedure.has(key)) byProcedure.set(key, procedure.replace(/\s*\^+\s*[0-9a-z]+\s*$/i, "").trim());
  }
  return Array.from(byProcedure.values());
}

function visitMatchesIntent(
  visit: { name: string; day?: string | null },
  intent: ReturnType<typeof extractVisitIntent>
) {
  if (!intent) return false;
  const label = normalizeLite(buildVisitLabel(visit));
  const dayText = normalizeLite(String(visit.day || ""));

  if (intent.screening && !/\bscreening\b/.test(label)) return false;
  if (intent.followUp && !/\bfollow[\s-]?up\b|\bf\/?u\b/.test(label)) return false;
  if (intent.endOfTreatment && !/\bend of treatment\b|\beot\b|\bend of study\b/.test(label)) return false;

  if (intent.cycle) {
    const cycleRe = new RegExp(`\\bcycle\\s*${intent.cycle}\\b`);
    const compactCycleRe = new RegExp(`\\bc${intent.cycle}\\b`);
    if (!cycleRe.test(label) && !compactCycleRe.test(label)) return false;
  }

  if (intent.day) {
    const dayRe = new RegExp(`\\bday\\s*${intent.day}\\b`);
    const compactDayRe = new RegExp(`\\bd${intent.day}\\b`);
    const rawDayRe = new RegExp(`(^|\\D)${intent.day}(\\D|$)`);
    if (!dayRe.test(label) && !compactDayRe.test(label) && !rawDayRe.test(dayText)) return false;
  }

  return true;
}

function normalizeProcedureName(value: string) {
  const raw = String(value || "")
    .replace(/\s*\^+\s*([0-9]+|[a-z]+)\s*$/i, "")
    .replace(/\s*[*†‡]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeLite(raw).replace(/\s+/g, " ").trim();
}

function dedupeProcedureList(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const normalized = normalizeProcedureName(cleaned);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleaned);
  }
  return output;
}

function normalizeVisitLabelForDedupe(value: string) {
  return normalizeLite(value)
    .replace(/\(\s*day\s*-?\d+\s*\)/g, "")
    .replace(/\(\s*-?\d+\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeVisitLabelList(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = String(value || "").replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const normalized = normalizeVisitLabelForDedupe(cleaned);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleaned);
  }
  return output;
}

function orderVisitLabels(values: string[], visits: Array<{ label: string }>) {
  const orderByVisit = new Map<string, number>();
  visits.forEach((visit, index) => {
    const normalized = normalizeLite(visit.label);
    if (!normalized) return;
    if (!orderByVisit.has(normalized)) orderByVisit.set(normalized, index);
  });

  const deduped = dedupeVisitLabelList(values);
  return deduped.sort((a, b) => {
    const aKey = normalizeLite(a);
    const bKey = normalizeLite(b);
    const aOrder = orderByVisit.get(aKey);
    const bOrder = orderByVisit.get(bKey);
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    return a.localeCompare(b);
  });
}

function inferProcedureMarkCountFromScheduleChunks(
  procedurePhrase: string,
  chunks: ProtocolContextChunk[]
) {
  const needle = normalizeProcedureName(procedurePhrase);
  if (!needle) return null;

  let best = 0;
  for (const chunk of chunks) {
    if (!isScheduleLikeChunk(chunk)) continue;
    const lines = String(chunk.chunkText || "").split(/\n+/);
    for (const line of lines) {
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      const normalizedLine = normalizeProcedureName(trimmed);
      if (!normalizedLine) continue;
      if (
        /\b(schedule of events|schedule of activities|schedule of assessments|study procedure|study days|visit window)\b/.test(
          normalizedLine
        )
      ) {
        continue;
      }
      const directMatch =
        normalizedLine.includes(needle) ||
        needle.includes(normalizedLine) ||
        normalizedLine.includes(needle.replace(/\btests?\b/g, "test"));
      if (!directMatch) continue;
      const marks = (trimmed.match(/\bX\b/g) || []).length;
      if (marks > best) best = marks;
    }
  }

  return best > 0 ? best : null;
}

function extractExplicitProcedurePhrase(query: string) {
  const normalizedQuery = normalizeLite(query);
  const directPatterns = [
    /\b(pregnancy test)\b/,
    /\b(12[-\s]?lead electrocardiogram|electrocardiogram|ecg|ekg)\b/,
    /\b(full blood count|cbc)\b/,
    /\b(serum chemistry panel|chemistry panel|cmp)\b/,
    /\b(coagulation)\b/,
    /\b(thyroid function)\b/,
    /\b(urinalysis)\b/,
    /\b(vital signs?)\b/,
    /\b(concomitant medications?)\b/,
    /\b(adverse events?)\b/,
    /\b(pk sampling)\b/,
    /\b(cytokine profile sampling)\b/,
    /\b(serum immunogenicity sample)\b/,
    /\b(tumor biopsy|tumor assessment)\b/,
  ];

  for (const pattern of directPatterns) {
    const match = normalizedQuery.match(pattern);
    if (match?.[1]) return match[1];
  }

  const questionPattern = normalizedQuery.match(
    /\bwhen\s+is\s+(?:an?\s+|the\s+)?(.+?)\s+(?:required|done|performed|scheduled)\b/
  );
  if (questionPattern?.[1]) {
    return questionPattern[1].replace(/\s+/g, " ").trim();
  }

  return null;
}

function normalizeSuperscriptDigits(value: string) {
  const map: Record<string, string> = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
  };
  return Array.from(String(value || ""))
    .map((char) => map[char] ?? char)
    .join("");
}

function extractProcedureNameFootnoteMarker(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const caret = raw.match(/\^([a-z0-9*†‡]+)/i);
  if (caret?.[1]) return caret[1];
  const superscript = raw.match(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s*$/);
  if (superscript?.[1]) return normalizeSuperscriptDigits(superscript[1]);
  const plain = raw.match(/(?:\s|\))([0-9]{1,3}|[a-z]|[*†‡])\s*$/i);
  if (plain?.[1]) return plain[1];
  return null;
}

function isProcedureInstructionQuestion(query: string) {
  const normalized = normalizeLite(query);
  const asksHow =
    /\bwhat is the procedure\b|\bwhat s the procedure\b|\bhow\b|\bwhat do (?:i|we|you|nurses?|site staff) need to do\b|\bwhat should (?:i|we|you|nurses?|site staff) do\b|\bwhat do (?:i|we|you|nurses?|site staff) do\b|\bwhat needs to be done\b|\bhow to\b|\bperform\b|\bsteps?\b|\binstructions?\b/.test(
      normalized
    );
  const asksTiming =
    /\bwhen\b|\brequired\b|\bwhich visits?\b|\bat visit\b|\bscheduled\b|\bhow often\b|\bfrequency\b/.test(normalized);
  return asksHow && !asksTiming;
}

function buildProcedureInstructionAnswer(options: {
  explicitProcedurePhrase: string;
  schedule: StructuredScheduleLike;
  requiredEntries: Array<{ procedure: string; visit: string; required: boolean; footnoteRef?: string | null }>;
  visits: Array<{ label: string }>;
  citation: string;
}) {
  const explicit = normalizeProcedureName(options.explicitProcedurePhrase);
  if (!explicit) return null;

  const allProcedureNames = Array.from(
    new Set([
      ...(Array.isArray(options.schedule.procedures)
        ? options.schedule.procedures.map((item) => String(item.name || ""))
        : []),
      ...options.requiredEntries.map((entry) => String(entry.procedure || "")),
    ])
  ).filter(Boolean);

  const ranked = allProcedureNames
    .map((name) => {
      const normalized = normalizeProcedureName(name);
      if (!normalized) return null;
      let score = 0;
      if (normalized === explicit) score += 100;
      if (normalized.includes(explicit)) score += 16;
      if (explicit.includes(normalized)) score += 8;
      return score > 0 ? { name, score } : null;
    })
    .filter((item): item is { name: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;

  const selectedNames = ranked
    .filter((item) => item.score >= ranked[0]!.score - 2)
    .slice(0, 3)
    .map((item) => item.name);
  const selectedKeys = new Set(selectedNames.map((name) => normalizeProcedureName(name)));

  const selectedEntries = options.requiredEntries.filter((entry) =>
    selectedKeys.has(normalizeProcedureName(entry.procedure))
  );
  const requiredVisits = orderVisitLabels(
    selectedEntries.map((entry) => entry.visit),
    options.visits
  );

  const footnoteLookup = new Map<string, string>();
  const footnotes = Array.isArray(options.schedule.footnotes) ? options.schedule.footnotes : [];
  for (const footnote of footnotes) {
    const marker = String(footnote.number || "").replace(/^\^+/, "").trim();
    const text = String(footnote.text || "").replace(/\s+/g, " ").trim();
    if (!marker || !text) continue;
    footnoteLookup.set(normalizeLite(marker), text);
  }

  const matchedMarkers = new Set<string>();
  for (const name of selectedNames) {
    const marker = extractProcedureNameFootnoteMarker(name);
    if (!marker) continue;
    const markerKey = normalizeLite(marker);
    if (footnoteLookup.has(markerKey)) matchedMarkers.add(markerKey);
  }
  for (const entry of selectedEntries) {
    const marker = String(entry.footnoteRef || "").replace(/^\^+/, "").trim();
    if (!marker) continue;
    const markerKey = normalizeLite(marker);
    if (footnoteLookup.has(markerKey)) matchedMarkers.add(markerKey);
  }

  const instructionLines = Array.from(matchedMarkers.values())
    .map((markerKey) => footnoteLookup.get(markerKey))
    .filter((text): text is string => Boolean(text));
  if (instructionLines.length === 0) return null;

  const displayName = selectedNames[0]!.replace(/\s*\^+\s*[0-9a-z]+\s*$/i, "").trim();
  const lines: string[] = [`Procedure guidance for ${displayName}:`];
  for (const instruction of instructionLines) {
    lines.push(`- ${instruction}`);
  }
  if (requiredVisits.length > 0) {
    lines.push("");
    lines.push("Required at:");
    lines.push(...requiredVisits.map((visit, index) => `${index + 1}. ${visit}`));
  }
  lines.push("");
  lines.push(options.citation);
  return lines.join("\n");
}

function getProcedureTargets(query: string, schedule: StructuredScheduleLike) {
  const proceduresFromRows = Array.isArray(schedule.entries)
    ? schedule.entries.map((entry) => String(entry.procedure || "")).filter(Boolean)
    : [];
  const proceduresFromMeta = Array.isArray(schedule.procedures)
    ? schedule.procedures.map((item) => String(item.name || "")).filter(Boolean)
    : [];
  const uniqueProcedures = Array.from(new Set([...proceduresFromRows, ...proceduresFromMeta]));
  if (uniqueProcedures.length === 0) return [];

  const normalizedQuery = normalizeLite(query);
  const explicitPhrase = extractExplicitProcedurePhrase(query);
  if (explicitPhrase) {
    const strictMatches = uniqueProcedures
      .map((name) => {
        const normalizedName = normalizeProcedureName(name);
        if (!normalizedName) return null;
        let score = 0;
        if (normalizedName === explicitPhrase) score += 100;
        if (normalizedName.includes(explicitPhrase)) score += 24;
        if (explicitPhrase.includes(normalizedName)) score += 12;
        if (
          normalizedName
            .replace(/\btests?\b/g, "test")
            .includes(explicitPhrase.replace(/\btests?\b/g, "test"))
        ) {
          score += 8;
        }
        return score > 0 ? { name, score } : null;
      })
      .filter((item): item is { name: string; score: number } => Boolean(item))
      .sort((a, b) => b.score - a.score);
    if (strictMatches.length > 0) {
      return [strictMatches[0]!.name];
    }
  }
  const queryTerms = tokenizeLite(query).filter(
    (term) =>
      term.length > 2 &&
      !["what", "when", "which", "required", "requirement", "requirements", "cycle", "day", "visit", "test", "tests"].includes(term)
  );

  const scored = uniqueProcedures
    .map((name) => {
      const normalizedName = normalizeProcedureName(name);
      if (!normalizedName) return null;
      let score = 0;
      if (normalizedQuery.includes(normalizedName)) score += 10;
      if (normalizedName.includes("pregnancy test") && normalizedQuery.includes("pregnancy")) score += 9;
      if (/\becg\b|\belectrocardiogram\b/.test(normalizedQuery) && /\becg\b|electrocardiogram/.test(normalizedName))
        score += 9;
      if (/\bcbc\b|full blood count/.test(normalizedQuery) && /\bcbc\b|full blood count/.test(normalizedName)) score += 9;
      for (const term of queryTerms) {
        if (normalizedName.includes(term)) score += 2;
      }
      return { name, score };
    })
    .filter((item): item is { name: string; score: number } => item !== null && item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return [];
  const topScore = scored[0]?.score ?? 0;
  const floor = Math.max(8, topScore - 4);
  return scored.filter((item) => item.score >= floor).slice(0, 3).map((item) => item.name);
}

async function buildDeterministicScheduleAnswer(
  queryPlan: UnifiedQueryPlan,
  query: string,
  chunks: ProtocolContextChunk[],
  protocolFileUrls?: Map<string, string | null>
) {
  if (queryPlan.focus !== "schedule" || queryPlan.amendmentIntent) return null;
  const best = collectStructuredScheduleEvidence(chunks);
  if (!best) {
    const fallbackProtocolId = chunks[0]?.protocolId;
    const fallbackFileUrl =
      typeof fallbackProtocolId === "string" ? protocolFileUrls?.get(fallbackProtocolId) ?? null : null;
    const assisted = await extractScheduleAnswerAssist(query, chunks, undefined, fallbackFileUrl);
    if (!assisted) return null;
    const fallbackChunk = chunks.find((chunk) => isScheduleLikeChunk(chunk));
    const fallbackCitation = fallbackChunk
      ? `[Source: ${fallbackChunk.citation.filename}, ${fallbackChunk.citation.page}]`
      : "[Source: Protocol schedule section]";
    if (assisted.requiredProcedures.length > 0) {
      return [
        "Required procedures:",
        ...dedupeProcedureList(assisted.requiredProcedures).map((name, index) => `${index + 1}. ${name}`),
        "",
        fallbackCitation,
      ].join("\n");
    }
    if (assisted.requiredVisits.length > 0) {
      return [
        "Required visits:",
        ...assisted.requiredVisits.map((name, index) => `${index + 1}. ${name}`),
        "",
        fallbackCitation,
      ].join("\n");
    }
    return null;
  }
  const schedule = best.structured;
  const visits = (schedule.visits || []).map((visit) => ({
    ...visit,
    label: `${visit.name}${visit.day ? ` (${visit.day})` : ""}`,
  }));
  const requiredEntries = (schedule.entries || []).filter((entry) => entry.required);
  const citation = `[Source: ${best.chunk.citation.filename}, ${best.pageLabel}]`;
  const scheduleFileUrl = protocolFileUrls?.get(best.chunk.protocolId) ?? null;
  const explicitProcedurePhrase = extractExplicitProcedurePhrase(query);
  if (explicitProcedurePhrase && isProcedureInstructionQuestion(query)) {
    const instructionAnswer = buildProcedureInstructionAnswer({
      explicitProcedurePhrase,
      schedule,
      requiredEntries,
      visits,
      citation,
    });
    if (instructionAnswer) return instructionAnswer;
    return null;
  }
  let assistedSchedule: Awaited<ReturnType<typeof extractScheduleAnswerAssist>> | null | undefined;
  const getAssistedSchedule = async () => {
    if (assistedSchedule !== undefined) return assistedSchedule;
    assistedSchedule = await extractScheduleAnswerAssist(query, chunks, schedule.sourcePages, scheduleFileUrl);
    return assistedSchedule;
  };

  const visitIntent = extractVisitIntent(query);
  if (visitIntent && visits.length > 0) {
    const strictCycleDayIntent = Boolean(visitIntent.cycle && visitIntent.day);
    let resolvedTableColumns = 0;
    if (schedule.table) {
      const exactColumns = resolveVisitColumnsFromStructuredTable(schedule.table, visitIntent);
      resolvedTableColumns = exactColumns.length;
      if (exactColumns.length > 0) {
        let procedures = dedupeProcedureList(getRequiredProceduresForVisitColumns(schedule, exactColumns));
        if (strictCycleDayIntent && scheduleFileUrl) {
          const exactAssist = await invokeExactVisitAssistFromPdf({
            query,
            fileUrl: scheduleFileUrl,
            sourcePages: schedule.sourcePages,
            intent: visitIntent,
          });
          if (exactAssist && exactAssist.length > 0) {
            const categoryByProcedure = new Map<string, string>();
            const structuredProcedures = Array.isArray(schedule.procedures) ? schedule.procedures : [];
            for (const item of structuredProcedures) {
              const key = normalizeProcedureName(String(item.name || ""));
              const category = String(item.category || "").trim();
              if (!key || !category) continue;
              if (!categoryByProcedure.has(key)) categoryByProcedure.set(key, category);
            }
            const structuredRows = Array.isArray(schedule.table?.rows) ? schedule.table?.rows : [];
            for (const row of structuredRows) {
              const key = normalizeProcedureName(String(row.procedure || ""));
              const category = String(row.category || "").trim();
              if (!key || !category) continue;
              if (!categoryByProcedure.has(key)) categoryByProcedure.set(key, category);
            }
            const exactSet = new Set(exactAssist.map((item) => normalizeProcedureName(item)));
            const pkCategory = (value: string) => /\bpk\b|pharmacodynamic/.test(normalizeLite(value));
            const exactPkHits = procedures.filter((procedure) => {
              const key = normalizeProcedureName(procedure);
              if (!exactSet.has(key)) return false;
              return pkCategory(categoryByProcedure.get(key) || "");
            }).length;

            if (procedures.length > 0 && exactPkHits > 0) {
              const filtered = procedures.filter((procedure) => {
                const key = normalizeProcedureName(procedure);
                if (exactSet.has(key)) return true;
                return !pkCategory(categoryByProcedure.get(key) || "");
              });
              if (filtered.length > 0) {
                procedures = dedupeProcedureList(filtered);
              }
            }
          }
          if (exactAssist && exactAssist.length > 0 && procedures.length === 0) {
            procedures = dedupeProcedureList(exactAssist);
          }
        }
        const labels = exactColumns.map((column) => column.label).filter(Boolean);
        if (procedures.length > 0) {
          return [
            `Required procedures for ${labels.length > 0 ? labels.join(", ") : "the requested visit/day"}:`,
            ...procedures.map((procedure, index) => `${index + 1}. ${procedure}`),
            "",
            citation,
          ].join("\n");
        }
        if (strictCycleDayIntent) {
          return [
            `No required procedures were marked for ${labels.length > 0 ? labels.join(", ") : "the requested visit/day"} in the structured schedule.`,
            citation,
          ].join("\n");
        }
      }
    }

    const matchedVisits = visits.filter((visit) => visitMatchesIntent(visit, visitIntent));
    if (matchedVisits.length > 0) {
      const dedupedVisitLabels = Array.from(
        orderVisitLabels(
          matchedVisits
            .map((visit) => visit.label)
            .filter(Boolean)
            .map((label) => label.replace(/\s+/g, " ").trim()),
          visits
        )
      );
      const visitKeys = matchedVisits.map((visit) => normalizeLite(visit.label));
      const dayNeedle = visitIntent.day ? new RegExp(`\\b${visitIntent.day}\\b`) : null;
      const cycleNeedle = visitIntent.cycle
        ? new RegExp(`\\bcycle\\s*${visitIntent.cycle}\\b|\\bc${visitIntent.cycle}\\b`)
        : null;
      const matchedEntries = requiredEntries.filter((entry) => {
        const entryVisit = normalizeLite(entry.visit);
        const directMatch = visitKeys.some((visitKey) => entryVisit.includes(visitKey) || visitKey.includes(entryVisit));
        if (directMatch) return true;
        if (!dayNeedle || !dayNeedle.test(entryVisit)) return false;
        if (!cycleNeedle) {
          // Some SOE parsers collapse visit values to a plain day token ("2").
          return /^\d{1,3}$/.test(entryVisit) || /^day\s*-?\d{1,3}$/.test(entryVisit);
        }
        return cycleNeedle.test(entryVisit);
      });
      let procedures = dedupeProcedureList(matchedEntries.map((entry) => entry.procedure));
      // Use LLM assist only as a fallback when structured schedule rows do not yield any required procedures.
      if (procedures.length === 0 && !strictCycleDayIntent) {
        const assisted = await getAssistedSchedule();
        if (assisted?.requiredProcedures?.length) {
          procedures = dedupeProcedureList(assisted.requiredProcedures);
        }
      }

      const lines: string[] = [
        `Required procedures for ${
          dedupedVisitLabels.length > 0 ? dedupedVisitLabels.join(", ") : "the requested visit/day"
        }:`,
        ...procedures.map((procedure, index) => `${index + 1}. ${procedure}`),
        "",
        citation,
      ];
      if (procedures.length === 0) {
        lines.splice(
          0,
          lines.length,
          `No required procedures were marked for ${
            dedupedVisitLabels.length > 0 ? dedupedVisitLabels.join(", ") : "the requested visit/day"
          } in the structured schedule.`,
          citation
        );
      }
      return lines.join("\n");
    }

    if (strictCycleDayIntent) {
      const detail =
        resolvedTableColumns > 0
          ? "No required procedures were marked for that exact cycle/day column."
          : "The structured schedule did not expose a unique cycle/day column for that request.";
      return [
        `${detail}`,
        "Please verify the exact day column in the Schedule of Assessments table.",
        citation,
      ].join("\n");
    }

    // If intent exists but no visit matched from structured schedule labels, try assist as last resort.
    const assisted = await getAssistedSchedule();
    if (assisted?.requiredProcedures?.length) {
      return [
        "Required procedures:",
        ...dedupeProcedureList(assisted.requiredProcedures).map((name, index) => `${index + 1}. ${name}`),
        "",
        citation,
      ].join("\n");
    }
  }

  if (explicitProcedurePhrase) {
    const normalizedExplicit = normalizeProcedureName(explicitProcedurePhrase);
    const strictMatches = requiredEntries.filter((entry) => {
      const procedure = normalizeProcedureName(entry.procedure);
      if (!procedure || !normalizedExplicit) return false;
      return (
        procedure === normalizedExplicit ||
        procedure.includes(normalizedExplicit) ||
        normalizedExplicit.includes(procedure)
      );
    });

    const structuredVisits = orderVisitLabels(
      strictMatches.map((entry) => entry.visit),
      visits
    );
    const expectedMarkCount = inferProcedureMarkCountFromScheduleChunks(
      explicitProcedurePhrase,
      chunks
    );
    let preferredVisits = structuredVisits;

    if (expectedMarkCount && structuredVisits.length > 0) {
      const structuredDistance = Math.abs(structuredVisits.length - expectedMarkCount);
      if (structuredDistance >= 2) {
        const assisted = await getAssistedSchedule();
        const assistedVisits = orderVisitLabels(assisted?.requiredVisits || [], visits);
        if (assistedVisits.length > 0) {
          const assistedDistance = Math.abs(assistedVisits.length - expectedMarkCount);
          if (assistedDistance < structuredDistance) {
            preferredVisits = assistedVisits;
          }
        }
      }
    }
    if (preferredVisits.length > 0) {
      return [
        `${explicitProcedurePhrase.replace(/\b\w/g, (ch) => ch.toUpperCase())} is required at:`,
        ...preferredVisits.map((visit, index) => `${index + 1}. ${visit}`),
        "",
        citation,
      ].join("\n");
    }

    const assisted = await getAssistedSchedule();
    const assistedVisits = orderVisitLabels(assisted?.requiredVisits || [], visits);
    if (assistedVisits.length > 0) {
      return [
        `${explicitProcedurePhrase.replace(/\b\w/g, (ch) => ch.toUpperCase())} is required at:`,
        ...assistedVisits.map((visit, index) => `${index + 1}. ${visit}`),
        "",
        citation,
      ].join("\n");
    }
  }

  const procedureTargets = getProcedureTargets(query, schedule);
  if (procedureTargets.length > 0) {
    const lines: string[] = [];
    for (const procedure of procedureTargets) {
      const normalizedProcedure = normalizeProcedureName(procedure);
      const matches = requiredEntries.filter(
        (entry) =>
          normalizeProcedureName(entry.procedure) === normalizedProcedure ||
          normalizeProcedureName(entry.procedure).includes(normalizedProcedure) ||
          normalizedProcedure.includes(normalizeProcedureName(entry.procedure))
      );
      if (matches.length === 0) continue;
      const uniqueVisits = orderVisitLabels(
        matches.map((entry) => entry.visit),
        visits
      );
      lines.push(`${procedure} is required at:`);
      lines.push(...uniqueVisits.map((visit, index) => `${index + 1}. ${visit}`));
      lines.push("");
    }
    // Preserve deterministic schedule rows; only call assist when structured rows cannot answer.
    if (lines.length === 0) {
      const assisted = await getAssistedSchedule();
      if (assisted?.requiredVisits?.length) {
        lines.push("Required visits:");
        lines.push(
          ...orderVisitLabels(assisted.requiredVisits, visits).map(
            (visit, index) => `${index + 1}. ${visit}`
          )
        );
        lines.push("");
      }
    }
    if (lines.length > 0) {
      lines.push(citation);
      return lines.join("\n");
    }
  }

  const lines: string[] = ["Schedule of Events is present in the protocol.", citation];
  if (visits.length > 0) {
    lines.push("", "Visits:", ...visits.slice(0, 20).map((visit, i) => `${i + 1}. ${visit.label}`));
  }
  if (requiredEntries.length > 0) {
    lines.push("", "Required procedures:", ...requiredEntries.slice(0, 30).map((entry, i) => `${i + 1}. ${entry.procedure} @ ${entry.visit}`));
  }
  return lines.join("\n");
}

function buildDeterministicCriteriaAnswer(
  queryPlan: UnifiedQueryPlan,
  chunks: ProtocolContextChunk[]
): string | null {
  if (
    queryPlan.focus !== "inclusion" &&
    queryPlan.focus !== "exclusion" &&
    queryPlan.focus !== "eligibility"
  ) {
    return null;
  }
  if (queryPlan.amendmentIntent) return null;

  const best = collectStructuredCriteriaEvidence(chunks);
  if (!best) return null;
  const structured = best.structured;
  const inclusion = Array.isArray(structured.inclusion) ? structured.inclusion : [];
  const exclusion = Array.isArray(structured.exclusion) ? structured.exclusion : [];
  const inclusionCitation = `[Source: ${best.chunk.citation.filename}, ${formatPageLabelFromPages(
    structured.inclusionSourcePages || structured.sourcePages,
    best.pageLabel
  )}]`;
  const exclusionCitation = `[Source: ${best.chunk.citation.filename}, ${formatPageLabelFromPages(
    structured.exclusionSourcePages || structured.sourcePages,
    best.pageLabel
  )}]`;
  const inclusionVerbatim = trimCriteriaVerbatim(
    (structured.inclusionVerbatim || "").trim(),
    "inclusion",
    inclusion
  );
  const exclusionVerbatim = trimCriteriaVerbatim(
    (structured.exclusionVerbatim || "").trim(),
    "exclusion",
    exclusion
  );

  if (queryPlan.focus === "inclusion" && inclusionVerbatim) {
    return [`Inclusion Criteria`, inclusionVerbatim, inclusionCitation].join("\n\n");
  }
  if (queryPlan.focus === "exclusion" && exclusionVerbatim) {
    return [`Exclusion Criteria`, exclusionVerbatim, exclusionCitation].join("\n\n");
  }
  if (queryPlan.focus === "eligibility" && (inclusionVerbatim || exclusionVerbatim)) {
    const lines: string[] = ["Eligibility Criteria"];
    if (inclusionVerbatim) {
      lines.push("", "Inclusion Criteria", inclusionVerbatim, inclusionCitation);
    }
    if (exclusionVerbatim) {
      lines.push("", "Exclusion Criteria", exclusionVerbatim, exclusionCitation);
    }
    return lines.join("\n");
  }

  const inclusionLines = inclusion.map((entry, i) => `${i + 1}. "${entry.text}" ${inclusionCitation}`);
  const exclusionLines = exclusion.map((entry, i) => `${i + 1}. "${entry.text}" ${exclusionCitation}`);

  const lines: string[] = [];
  if (queryPlan.focus === "inclusion") {
    if (inclusionLines.length === 0) return null;
    lines.push("Inclusion criteria:");
    lines.push(...inclusionLines);
  } else if (queryPlan.focus === "exclusion") {
    if (exclusionLines.length === 0) return null;
    lines.push("Exclusion criteria:");
    lines.push(...exclusionLines);
  } else {
    if (inclusionLines.length === 0 && exclusionLines.length === 0) return null;
    lines.push("Eligibility criteria:");
    if (inclusionLines.length > 0) {
      lines.push("");
      lines.push("Inclusion criteria:");
      lines.push(...inclusionLines);
    }
    if (exclusionLines.length > 0) {
      lines.push("");
      lines.push("Exclusion criteria:");
      lines.push(...exclusionLines);
    }
  }

  const verbatim =
    queryPlan.focus === "exclusion"
      ? exclusionLines.slice(0, 8)
      : queryPlan.focus === "inclusion"
      ? inclusionLines.slice(0, 8)
      : [...inclusionLines.slice(0, 5), ...exclusionLines.slice(0, 5)];
  if (verbatim.length > 0) {
    lines.push("", "Verbatim Evidence:");
    lines.push(...verbatim);
  }
  return lines.join("\n");
}

async function collectOperationalEvidence(
  db: any,
  trialId?: string,
  userId?: number,
  query?: string,
  demoMode: "sample" | "full" | "building" = "sample",
  beTrialUuid?: string | null
) {
  const targetDate = query ? parseOperationalTargetDate(query) : null;
  const targetDateKey = targetDate ? formatLocalDate(targetDate) : null;
  let userNameToken: string | null = null;
  if (typeof userId === "number") {
    const userRows = (await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)) as Array<{ name: string | null }>;
    const name = String(userRows[0]?.name || "").trim();
    if (name) userNameToken = normalizeLite(name);
  }
  const isTaskMine = (task: MapTask) => {
    if (typeof userId !== "number") return false;
    if (task.assignedUserId === userId) return true;
    if (!userNameToken) return false;
    const suggested = normalizeLite(String(task.suggestedAssignee || ""));
    if (!suggested) return false;
    // Keep "my task" assignment semantics aligned with Home4 dashboard:
    // exact assignee name match only (after normalization).
    return suggested === userNameToken;
  };
  if (!trialId) {
    const asOf = formatIsoNow();
    // Trials are BE-owned: list trials for this demo mode from the BE. Keep
    // `id` as the FE prefixed key (so the FE-keyed `protocols` join below still
    // matches) and carry the BE UUID for executionMaps (BE-keyed) lookups.
    let beTrialList: any[] = [];
    try {
      beTrialList = await callBackend<any[]>("/api/trials", { query: { demo_mode: demoMode } });
    } catch {
      beTrialList = [];
    }
    const trialRows = (beTrialList ?? []).map((t: any) => ({
      id: toDemoId(demoMode, String(t?.slug || t?.id)),
      beTrialUuid: (t?.id ?? null) as string | null,
      title: (t?.name ?? null) as string | null,
      investigationalProduct: (t?.investigational_product ?? null) as string | null,
      status: uqBeStatusToFe(t?.status),
      phase: (t?.phase ?? null) as string | null,
      enrolledPatients: Number(t?.enrolled_patients ?? 0),
      targetPatients: (t?.target_patients ?? null) as number | null,
    }));
    if (trialRows.length === 0) return [] as OperationalEvidence[];

    const evidence: OperationalEvidence[] = [];
    const statusCounts = trialRows.reduce((acc: Record<string, number>, trial) => {
      const key = String(trial.status || "unknown");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    evidence.push({
      label: "Cross-trial portfolio",
      value: `trials ${trialRows.length}; active ${statusCounts.active ?? 0}; recruiting ${
        statusCounts.recruiting ?? 0
      }; on-hold ${statusCounts["on-hold"] ?? 0}; completed ${statusCounts.completed ?? 0}`,
      asOf,
    });

    const enrolledTotal = trialRows.reduce((sum, trial) => sum + Number(trial.enrolledPatients || 0), 0);
    const targetTotal = trialRows.reduce((sum, trial) => sum + Number(trial.targetPatients || 0), 0);
    evidence.push({
      label: "Enrollment snapshot",
      value: `enrolled ${enrolledTotal}/${targetTotal || 0} across ${trialRows.length} trial(s)`,
      asOf,
    });
    const enrollmentLeaders = trialRows
      .filter((trial) => Number(trial.targetPatients || 0) > 0)
      .map((trial) => {
        const enrolled = Number(trial.enrolledPatients || 0);
        const target = Number(trial.targetPatients || 0);
        const pct = target > 0 ? Math.round((enrolled / target) * 100) : 0;
        const label = trial.investigationalProduct || trial.title || trial.id;
        return { label, pct, enrolled, target };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 4);
    if (enrollmentLeaders.length > 0) {
      evidence.push({
        label: "Cross-trial patient status",
        value: enrollmentLeaders
          .map((row) => `${row.label}: ${row.enrolled}/${row.target} (${row.pct}%)`)
          .join("; "),
        asOf,
      });
    }

    const allProtocolRows = (await db.select().from(protocols).orderBy(desc(protocols.updatedAt))) as Protocol[];
    const activeProtocolRows = allProtocolRows.filter((protocol) => !protocol.archivedAt);
    let indexedProtocolIds = new Set<string>();
    if (activeProtocolRows.length > 0) {
      const indexedRows = USES_EXTERNAL_RAG
        ? ((await db
            .select({ protocolId: protocolChunks.protocolId })
            .from(protocolChunks)
            .where(inArray(protocolChunks.protocolId, activeProtocolRows.map((protocol) => String(protocol.id))))) as Array<{
            protocolId: string;
          }>)
        : ((await db
            .select({ protocolId: fileSearchDocuments.protocolId })
            .from(fileSearchDocuments)
            .where(inArray(fileSearchDocuments.protocolId, activeProtocolRows.map((protocol) => String(protocol.id))))) as Array<{
            protocolId: string;
          }>);
      indexedProtocolIds = new Set(indexedRows.map((row) => row.protocolId));
    }
    const indexedCount = activeProtocolRows.filter((protocol) => indexedProtocolIds.has(String(protocol.id))).length;
    const coverage = activeProtocolRows.length
      ? Math.round((indexedCount / activeProtocolRows.length) * 100)
      : 0;
    evidence.push({
      label: "Cross-trial document readiness",
      value: `documents ${activeProtocolRows.length}; indexed ${indexedCount}; coverage ${coverage}%`,
      asOf,
    });
    const docsByTrial = activeProtocolRows.reduce((acc: Record<string, number>, protocol) => {
      acc[protocol.trialId] = (acc[protocol.trialId] ?? 0) + 1;
      return acc;
    }, {});
    const topDocsByTrial = Object.entries(docsByTrial)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([trialKey, count]) => {
        const trial = trialRows.find((row) => row.id === trialKey);
        const label = trial?.investigationalProduct || trial?.title || trialKey;
        return `${label}:${count}`;
      })
      .join("; ");
    if (topDocsByTrial) {
      evidence.push({
        label: "Documents by trial",
        value: topDocsByTrial,
        asOf,
      });
    }

    // executionMaps is BE-keyed: the BE trial list already carries each trial's
    // BE UUID, so map FE prefixed id -> BE UUID directly (FE trial-name lookups
    // are re-keyed by BE UUID below so display still resolves).
    const beUuidByFeId = new Map<string, string>();
    for (const trial of trialRows) {
      if (trial.beTrialUuid) beUuidByFeId.set(String(trial.id), trial.beTrialUuid);
    }
    const beTrialUuidsForMaps = Array.from(beUuidByFeId.values());
    const mapRows = beTrialUuidsForMaps.length
      ? ((await db
          .select()
          .from(executionMaps)
          .where(inArray(executionMaps.trialId, beTrialUuidsForMaps))
          .orderBy(desc(executionMaps.updatedAt))) as ExecutionMap[])
      : [];
    const groupedByTrial = new Map<string, ExecutionMap[]>();
    for (const map of mapRows) {
      if (!map.trialId) continue;
      const rows = groupedByTrial.get(map.trialId) ?? [];
      rows.push(map);
      groupedByTrial.set(map.trialId, rows);
    }
    const activeMaps = Array.from(groupedByTrial.values())
      .map((rows) => pickPreferredExecutionMap(rows, false))
      .filter(Boolean) as ExecutionMap[];
    if (activeMaps.length === 0) return evidence;

    evidence.push({
      label: "Execution maps",
      value: `${activeMaps.length} active map(s) across ${groupedByTrial.size} trial(s)`,
      asOf,
    });

    const mapIds = activeMaps.map((map) => map.id);
    const tasksRows = mapIds.length
      ? ((await db.select().from(mapTasks).where(inArray(mapTasks.mapId, mapIds))) as MapTask[])
      : [];
    const phasesRows = mapIds.length
      ? ((await db.select().from(mapPhases).where(inArray(mapPhases.mapId, mapIds))) as MapPhase[])
      : [];
    const phaseById = new Map<string, MapPhase>(phasesRows.map((phase) => [String(phase.id), phase]));

    const byStatus = tasksRows.reduce((acc: Record<string, number>, task: MapTask) => {
      const key = task.status || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const now = startOfLocalDay(new Date()).getTime();
    const overdue = tasksRows.filter((task: MapTask) => {
      const due = toLocalDayTimestamp(task.dueDate);
      if (due === null) return false;
      if (!isOpenTask(task)) return false;
      return due < now;
    });
    const dueSoon = tasksRows.filter((task: MapTask) => {
      const due = toLocalDayTimestamp(task.dueDate);
      if (due === null) return false;
      if (!isOpenTask(task)) return false;
      const delta = due - now;
      return delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000;
    });
    // Re-key trial names by BE UUID so cross-trial map/task lookups (which now
    // resolve to executionMaps.trialId = BE UUID) still find a display name.
    const trialNameById = new Map(
      trialRows
        .map((trial) => {
          const be = beUuidByFeId.get(String(trial.id));
          if (!be) return null;
          return [be, trial.investigationalProduct || trial.title || trial.id] as const;
        })
        .filter((entry): entry is readonly [string, string] => entry !== null)
    );
    const mapTrialById = new Map(activeMaps.map((map) => [String(map.id), String(map.trialId)]));

    evidence.push({
      label: "Cross-trial task progress",
      value: `total tasks ${tasksRows.length}; todo ${byStatus.todo ?? 0}; in_progress ${
        byStatus.in_progress ?? 0
      }; blocked ${(byStatus.blocked ?? 0) + (byStatus.waiting ?? 0)}; done ${byStatus.done ?? 0}`,
      asOf,
    });
    evidence.push({
      label: "Cross-trial deadline risk",
      value: `overdue ${overdue.length}; due in 7 days ${dueSoon.length}`,
      asOf,
    });

    const dueSoonTop = [...dueSoon]
      .sort(compareTasksByDueDate)
      .slice(0, 8);
    if (dueSoonTop.length > 0) {
      const dueSoonTaskItems = dueSoonTop
        .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById: trialNameById, phaseById }))
        .filter((task): task is OperationalTaskItem => Boolean(task));
      evidence.push({
        label: "Cross-trial tasks due this week",
        value: dueSoonTop
          .map((task) => {
            const trialKey = mapTrialById.get(String(task.mapId)) || "unknown";
            const trialName = trialNameById.get(trialKey) || trialKey;
            return `${trialName}: ${task.name} (${formatShortDate(task.dueDate)})`;
          })
          .join("; "),
        asOf,
        ...(dueSoonTaskItems.length > 0 ? { taskItems: dueSoonTaskItems } : {}),
      });
    }

    if (typeof userId === "number") {
      const assignedOpen = tasksRows.filter((task) => isTaskMine(task) && isOpenTask(task));
      const assignedDueSoon = assignedOpen
        .filter((task) => {
          const due = toLocalDayTimestamp(task.dueDate);
          if (due === null) return false;
          const delta = due - now;
          return delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000;
        })
        .sort(compareTasksByDueDate)
        .slice(0, 8);
      evidence.push({
        label: "My assigned tasks",
        value: `open ${assignedOpen.length}; due in 7 days ${assignedDueSoon.length}`,
        asOf,
      });
      if (assignedDueSoon.length > 0) {
        const myDueSoonTaskItems = assignedDueSoon
          .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById: trialNameById, phaseById }))
          .filter((task): task is OperationalTaskItem => Boolean(task));
        evidence.push({
          label: "My tasks due this week",
          value: assignedDueSoon.map((task) => `${task.name} (${formatShortDate(task.dueDate)})`).join("; "),
          asOf,
          ...(myDueSoonTaskItems.length > 0 ? { taskItems: myDueSoonTaskItems } : {}),
        });
      }
      if (targetDateKey) {
        const assignedDueOnTarget = assignedOpen
          .filter((task) => {
            if (!task.dueDate) return false;
            return formatLocalDate(task.dueDate) === targetDateKey;
          })
          .sort(compareTasksByDueDate)
          .slice(0, 12);
        const myDueOnTargetTaskItems = assignedDueOnTarget
          .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById: trialNameById, phaseById }))
          .filter((task): task is OperationalTaskItem => Boolean(task));
        evidence.push({
          label: `My tasks due ${targetDateKey}`,
          value:
            assignedDueOnTarget.length > 0
              ? assignedDueOnTarget
                  .map((task) => `${task.name} (${formatLocalDate(task.dueDate) || formatShortDate(task.dueDate)})`)
                  .join("; ")
              : "none",
          asOf,
          ...(myDueOnTargetTaskItems.length > 0 ? { taskItems: myDueOnTargetTaskItems } : {}),
        });
      }
    }

    if (targetDateKey) {
      const dueOnTarget = tasksRows
        .filter((task) => {
          if (!task.dueDate) return false;
          if (!isOpenTask(task)) return false;
          return formatLocalDate(task.dueDate) === targetDateKey;
        })
        .sort(compareTasksByDueDate)
        .slice(0, 12);
      const dueOnTargetTaskItems = dueOnTarget
        .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById: trialNameById, phaseById }))
        .filter((task): task is OperationalTaskItem => Boolean(task));
      evidence.push({
        label: `Cross-trial tasks due ${targetDateKey}`,
        value:
          dueOnTarget.length > 0
            ? dueOnTarget
                .map((task) => {
                  const trialKey = mapTrialById.get(String(task.mapId)) || "unknown";
                  const trialName = trialNameById.get(trialKey) || trialKey;
                  return `${trialName}: ${task.name} (${formatLocalDate(task.dueDate) || formatShortDate(task.dueDate)})`;
                })
                .join("; ")
            : "none",
        asOf,
        ...(dueOnTargetTaskItems.length > 0 ? { taskItems: dueOnTargetTaskItems } : {}),
      });

      const scopedProjectionSource =
        typeof userId === "number" && tasksRows.some((task) => isTaskMine(task) && isOpenTask(task))
          ? tasksRows.filter((task) => isTaskMine(task) && isOpenTask(task))
          : tasksRows.filter((task) => isOpenTask(task));
      const scopedProjection = buildQueuedTaskProjection(scopedProjectionSource);
      const scopedQueuedOnTarget =
        scopedProjection.find((point) => point.dateKey === targetDateKey)?.tasks.slice(0, 12) ?? [];
      const myQueuedTaskItems = scopedQueuedOnTarget
        .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById: trialNameById, phaseById }))
        .filter((task): task is OperationalTaskItem => Boolean(task));
      evidence.push({
        label: `My queued tasks ${targetDateKey}`,
        value:
          scopedQueuedOnTarget.length > 0
            ? scopedQueuedOnTarget
                .map((task) => `${task.name} (${formatLocalDate(task.dueDate) || "unscheduled"})`)
                .join("; ")
            : "none",
        asOf,
        ...(myQueuedTaskItems.length > 0 ? { taskItems: myQueuedTaskItems } : {}),
      });

      const crossTrialProjection = buildQueuedTaskProjection(tasksRows.filter((task) => isOpenTask(task)));
      const crossTrialQueuedOnTarget =
        crossTrialProjection.find((point) => point.dateKey === targetDateKey)?.tasks.slice(0, 12) ?? [];
      const crossTrialQueuedTaskItems = crossTrialQueuedOnTarget
        .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById: trialNameById, phaseById }))
        .filter((task): task is OperationalTaskItem => Boolean(task));
      evidence.push({
        label: `Cross-trial queued tasks ${targetDateKey}`,
        value:
          crossTrialQueuedOnTarget.length > 0
            ? crossTrialQueuedOnTarget
                .map((task) => {
                  const trialKey = mapTrialById.get(String(task.mapId)) || "unknown";
                  const trialName = trialNameById.get(trialKey) || trialKey;
                  return `${trialName}: ${task.name} (${formatLocalDate(task.dueDate) || "unscheduled"})`;
                })
                .join("; ")
            : "none",
        asOf,
        ...(crossTrialQueuedTaskItems.length > 0 ? { taskItems: crossTrialQueuedTaskItems } : {}),
      });
    }

    const overdueByTrial = overdue.reduce((acc: Record<string, number>, task) => {
      const trialKey = mapTrialById.get(String(task.mapId)) || "unknown";
      acc[trialKey] = (acc[trialKey] ?? 0) + 1;
      return acc;
    }, {});
    const topTrialRisks = (Object.entries(overdueByTrial) as Array<[string, number]>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([trialKey, count]) => `${trialNameById.get(trialKey) || trialKey}:${count}`)
      .join("; ");
    if (topTrialRisks) {
      evidence.push({
        label: "Top overdue trial(s)",
        value: topTrialRisks,
        asOf,
      });
    }

    return evidence;
  }
  const asOf = formatIsoNow();

  // Trials are BE-owned: fetch this trial's metadata from the BE by (slug,
  // demo_mode) instead of the retired FE `trials` table. The FE-keyed
  // `protocols` read below intentionally still uses the FE trial id; executionMaps
  // (BE-keyed) uses `beTrialUuid`.
  let trial: {
    id: string;
    title: string | null;
    investigationalProduct: string | null;
    status: string;
    phase: string | null;
    enrolledPatients: number;
    targetPatients: number | null;
  } | null = null;
  try {
    const beTrial = await callBackend<any>("/api/trials/by-slug", {
      query: { slug: stripDemoId(String(trialId)), demo_mode: demoMode },
    });
    if (beTrial?.id || beTrial?.slug) {
      trial = {
        // Keep the FE prefixed id as the internal join key (mapTrialById <->
        // trialLabelById), matching the pre-retirement behavior.
        id: toDemoId(demoMode, String(beTrial?.slug || beTrial?.id)),
        title: beTrial?.name ?? null,
        investigationalProduct: beTrial?.investigational_product ?? null,
        status: uqBeStatusToFe(beTrial?.status),
        phase: beTrial?.phase ?? null,
        enrolledPatients: Number(beTrial?.enrolled_patients ?? 0),
        targetPatients: beTrial?.target_patients ?? null,
      };
    }
  } catch {
    trial = null;
  }
  if (!trial) return [] as OperationalEvidence[];

  const evidence: OperationalEvidence[] = [];
  evidence.push({
    label: "Trial status",
    value: `${trial.status}; phase ${trial.phase || "n/a"}; enrolled ${trial.enrolledPatients || 0}/${trial.targetPatients || 0}`,
    asOf,
  });
  if (Number(trial.targetPatients || 0) > 0) {
    const enrolled = Number(trial.enrolledPatients || 0);
    const target = Number(trial.targetPatients || 0);
    const pct = Math.round((enrolled / target) * 100);
    evidence.push({
      label: "Patient enrollment status",
      value: `${enrolled}/${target} (${pct}%)`,
      asOf,
    });
  }

  const trialProtocolRows = (await db
    .select()
    .from(protocols)
    .where(and(eq(protocols.trialId, trialId), isNull(protocols.archivedAt)))
    .orderBy(desc(protocols.updatedAt))) as Protocol[];
  let indexedProtocolIds = new Set<string>();
  if (trialProtocolRows.length > 0) {
    const indexedRows = USES_EXTERNAL_RAG
      ? ((await db
          .select({ protocolId: protocolChunks.protocolId })
          .from(protocolChunks)
          .where(inArray(protocolChunks.protocolId, trialProtocolRows.map((protocol) => String(protocol.id))))) as Array<{
          protocolId: string;
        }>)
      : ((await db
          .select({ protocolId: fileSearchDocuments.protocolId })
          .from(fileSearchDocuments)
          .where(inArray(fileSearchDocuments.protocolId, trialProtocolRows.map((protocol) => String(protocol.id))))) as Array<{
          protocolId: string;
        }>);
    indexedProtocolIds = new Set(indexedRows.map((row) => row.protocolId));
  }
  const indexedTrialDocs = trialProtocolRows.filter((protocol) => indexedProtocolIds.has(String(protocol.id))).length;
  const docCoverage = trialProtocolRows.length
    ? Math.round((indexedTrialDocs / trialProtocolRows.length) * 100)
    : 0;
  evidence.push({
    label: "Document readiness",
    value: `documents ${trialProtocolRows.length}; indexed ${indexedTrialDocs}; coverage ${docCoverage}%`,
    asOf,
  });

  // executionMaps is BE-keyed: query by the BE trial UUID (the FE `trials` and
  // `protocols` reads above intentionally still use the FE trial id).
  const mapRows = beTrialUuid
    ? ((await db
        .select()
        .from(executionMaps)
        .where(eq(executionMaps.trialId, beTrialUuid))
        .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version))) as ExecutionMap[])
    : [];
  const activeMap = pickPreferredExecutionMap(mapRows, false);
  if (!activeMap) return evidence;

  evidence.push({
    label: "Execution map",
    value: `status ${activeMap.status}; version ${activeMap.version}; launched ${
      activeMap.launchedAt ? new Date(activeMap.launchedAt).toISOString().slice(0, 10) : "not launched"
    }`,
    asOf,
  });

  const tasksRows = (await db
    .select()
    .from(mapTasks)
    .where(eq(mapTasks.mapId, activeMap.id))) as MapTask[];
  const phasesRows = (await db
    .select()
    .from(mapPhases)
    .where(eq(mapPhases.mapId, activeMap.id))) as MapPhase[];
  const phaseById = new Map<string, MapPhase>(phasesRows.map((phase) => [String(phase.id), phase]));
  const mapTrialById = new Map<string, string>([[String(activeMap.id), String(trial.id)]]);
  const trialLabelById = new Map<string, string>([[String(trial.id), trial.investigationalProduct || trial.title || trial.id]]);

  const phaseCount = phasesRows.length;
  const total = tasksRows.length;
  const byStatus = tasksRows.reduce((acc: Record<string, number>, task: MapTask) => {
    const key = task.status || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const now = startOfLocalDay(new Date()).getTime();
  const overdue = tasksRows.filter((task: MapTask) => {
    const due = toLocalDayTimestamp(task.dueDate);
    if (due === null) return false;
    if (!isOpenTask(task)) return false;
    return due < now;
  });
  const dueSoon = tasksRows.filter((task: MapTask) => {
    const due = toLocalDayTimestamp(task.dueDate);
    if (due === null) return false;
    if (!isOpenTask(task)) return false;
    const delta = due - now;
    return delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000;
  });
  const roleCounts = tasksRows.reduce((acc: Record<string, number>, task: MapTask) => {
    if (!task.assignedRole) return acc;
    acc[task.assignedRole] = (acc[task.assignedRole] ?? 0) + 1;
    return acc;
  }, {});
  const topRoles = (Object.entries(roleCounts) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([role, count]) => `${role}:${count}`)
    .join(", ");

  evidence.push({
    label: "Task progress",
    value: `phases ${phaseCount}; total tasks ${total}; todo ${byStatus.todo ?? 0}; in_progress ${
      byStatus.in_progress ?? 0
    }; blocked ${(byStatus.blocked ?? 0) + (byStatus.waiting ?? 0)}; done ${byStatus.done ?? 0}`,
    asOf,
  });
  evidence.push({
    label: "Deadline risk",
    value: `overdue ${overdue.length}; due in 7 days ${dueSoon.length}`,
    asOf,
  });
  if (dueSoon.length > 0) {
    const dueSoonTaskItems = [...dueSoon]
      .sort(compareTasksByDueDate)
      .slice(0, 8)
      .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById, phaseById }))
      .filter((task): task is OperationalTaskItem => Boolean(task));
    evidence.push({
      label: "Tasks due this week",
      value: [...dueSoon]
        .sort(compareTasksByDueDate)
        .slice(0, 8)
        .map((task) => `${task.name} (${formatShortDate(task.dueDate)})`)
        .join("; "),
      asOf,
      ...(dueSoonTaskItems.length > 0 ? { taskItems: dueSoonTaskItems } : {}),
    });
  }
  if (typeof userId === "number") {
    const assignedOpen = tasksRows.filter((task) => isTaskMine(task) && isOpenTask(task));
    const assignedDueSoon = assignedOpen
      .filter((task) => {
        const due = toLocalDayTimestamp(task.dueDate);
        if (due === null) return false;
        const delta = due - now;
        return delta >= 0 && delta <= 7 * 24 * 60 * 60 * 1000;
      })
      .sort(compareTasksByDueDate)
      .slice(0, 8);
    evidence.push({
      label: "My assigned tasks",
      value: `open ${assignedOpen.length}; due in 7 days ${assignedDueSoon.length}`,
      asOf,
    });
    if (assignedDueSoon.length > 0) {
      const myDueSoonTaskItems = assignedDueSoon
        .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById, phaseById }))
        .filter((task): task is OperationalTaskItem => Boolean(task));
      evidence.push({
        label: "My tasks due this week",
        value: assignedDueSoon.map((task) => `${task.name} (${formatShortDate(task.dueDate)})`).join("; "),
        asOf,
        ...(myDueSoonTaskItems.length > 0 ? { taskItems: myDueSoonTaskItems } : {}),
      });
    }
    if (targetDateKey) {
      const assignedDueOnTarget = assignedOpen
        .filter((task) => {
          if (!task.dueDate) return false;
          return formatLocalDate(task.dueDate) === targetDateKey;
        })
        .sort(compareTasksByDueDate)
        .slice(0, 12);
      const myDueOnTargetTaskItems = assignedDueOnTarget
        .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById, phaseById }))
        .filter((task): task is OperationalTaskItem => Boolean(task));
      evidence.push({
        label: `My tasks due ${targetDateKey}`,
        value:
          assignedDueOnTarget.length > 0
            ? assignedDueOnTarget
                .map((task) => `${task.name} (${formatLocalDate(task.dueDate) || formatShortDate(task.dueDate)})`)
                .join("; ")
            : "none",
        asOf,
        ...(myDueOnTargetTaskItems.length > 0 ? { taskItems: myDueOnTargetTaskItems } : {}),
      });
    }
  }
  if (targetDateKey) {
    const dueOnTarget = tasksRows
      .filter((task) => {
        if (!task.dueDate) return false;
        if (!isOpenTask(task)) return false;
        return formatLocalDate(task.dueDate) === targetDateKey;
      })
      .sort(compareTasksByDueDate)
      .slice(0, 12);
    const dueOnTargetTaskItems = dueOnTarget
      .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById, phaseById }))
      .filter((task): task is OperationalTaskItem => Boolean(task));
    evidence.push({
      label: `Tasks due ${targetDateKey}`,
      value:
        dueOnTarget.length > 0
          ? dueOnTarget
              .map((task) => `${task.name} (${formatLocalDate(task.dueDate) || formatShortDate(task.dueDate)})`)
              .join("; ")
          : "none",
      asOf,
      ...(dueOnTargetTaskItems.length > 0 ? { taskItems: dueOnTargetTaskItems } : {}),
    });

    const scopedProjectionSource =
      typeof userId === "number" && tasksRows.some((task) => isTaskMine(task) && isOpenTask(task))
        ? tasksRows.filter((task) => isTaskMine(task) && isOpenTask(task))
        : tasksRows.filter((task) => isOpenTask(task));
    const scopedProjection = buildQueuedTaskProjection(scopedProjectionSource);
    const scopedQueuedOnTarget =
      scopedProjection.find((point) => point.dateKey === targetDateKey)?.tasks.slice(0, 12) ?? [];
    const myQueuedTaskItems = scopedQueuedOnTarget
      .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById, phaseById }))
      .filter((task): task is OperationalTaskItem => Boolean(task));
    evidence.push({
      label: `My queued tasks ${targetDateKey}`,
      value:
        scopedQueuedOnTarget.length > 0
          ? scopedQueuedOnTarget.map((task) => `${task.name} (${formatLocalDate(task.dueDate) || "unscheduled"})`).join("; ")
          : "none",
      asOf,
      ...(myQueuedTaskItems.length > 0 ? { taskItems: myQueuedTaskItems } : {}),
    });

    const trialProjection = buildQueuedTaskProjection(tasksRows.filter((task) => isOpenTask(task)));
    const queuedOnTarget = trialProjection.find((point) => point.dateKey === targetDateKey)?.tasks.slice(0, 12) ?? [];
    const queuedTaskItems = queuedOnTarget
      .map((task) => buildOperationalTaskItem(task, { mapTrialById, trialLabelById, phaseById }))
      .filter((task): task is OperationalTaskItem => Boolean(task));
    evidence.push({
      label: `Queued tasks ${targetDateKey}`,
      value:
        queuedOnTarget.length > 0
          ? queuedOnTarget.map((task) => `${task.name} (${formatLocalDate(task.dueDate) || "unscheduled"})`).join("; ")
          : "none",
      asOf,
      ...(queuedTaskItems.length > 0 ? { taskItems: queuedTaskItems } : {}),
    });
  }
  if (topRoles) {
    evidence.push({
      label: "Workload by role",
      value: topRoles,
      asOf,
    });
  }
  if (overdue.length > 0) {
    evidence.push({
      label: "Top overdue tasks",
      value: overdue
        .slice(0, 5)
        .map((task) => task.name)
        .join("; "),
      asOf,
    });
  }

  return evidence;
}

async function collectTelemetryEvidence(db: any, beTrialUuid?: string | null) {
  // mapTelemetryEvents is BE-keyed: query by the BE trial UUID only.
  if (!beTrialUuid) return [] as TelemetryEvidence[];
  const asOf = formatIsoNow();
  const rows = (await db
    .select()
    .from(mapTelemetryEvents)
    .where(eq(mapTelemetryEvents.trialId, beTrialUuid))
    .orderBy(desc(mapTelemetryEvents.createdAt))
    .limit(500)) as MapTelemetryEvent[];
  if (rows.length === 0) return [] as TelemetryEvidence[];

  const now = Date.now();
  const windowStart = now - 7 * 24 * 60 * 60 * 1000;
  const recent = rows.filter((row: MapTelemetryEvent) => {
    const ts = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    return ts >= windowStart;
  });

  const byType = recent.reduce((acc: Record<string, number>, row: MapTelemetryEvent) => {
    const key = row.eventType || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const topEvents = (Object.entries(byType) as Array<[string, number]>)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, count]) => `${name}:${count}`)
    .join(", ");

  return [
    {
      label: "Map telemetry (7d)",
      value: `events ${recent.length}; top ${topEvents || "n/a"}`,
      asOf,
    },
  ];
}

function buildDocContext(chunks: ProtocolContextChunk[], query: string, maxItems = 24) {
  if (chunks.length === 0) return [];

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: chunkRelevanceScore(query, chunk),
    }))
    .sort((a, b) => b.score - a.score);

  const selected: ProtocolContextChunk[] = [];
  const seenPages = new Set<string>();
  const softCapPerSection = 4;
  const sectionCounts = new Map<string, number>();

  for (const item of scored) {
    if (selected.length >= maxItems) break;
    const sectionKey = `${item.chunk.protocolId}:${normalizeLite(item.chunk.sectionTitle || item.chunk.sectionType)}`;
    const pageKey = `${item.chunk.protocolId}:${item.chunk.pageStart ?? item.chunk.pageEnd ?? "na"}`;
    const count = sectionCounts.get(sectionKey) ?? 0;

    // Keep diversity first, then allow deeper coverage per section.
    if (count >= softCapPerSection && selected.length < Math.floor(maxItems * 0.8)) {
      continue;
    }
    if (seenPages.has(pageKey) && selected.length < Math.floor(maxItems * 0.7)) {
      continue;
    }

    selected.push(item.chunk);
    sectionCounts.set(sectionKey, count + 1);
    seenPages.add(pageKey);
  }

  // Backfill if diversity constraints were too strict.
  if (selected.length < maxItems) {
    const selectedIds = new Set(selected.map((chunk) => chunk.id));
    for (const item of scored) {
      if (selected.length >= maxItems) break;
      if (selectedIds.has(item.chunk.id)) continue;
      selected.push(item.chunk);
      selectedIds.add(item.chunk.id);
    }
  }

  return selected
    .sort((a, b) => {
      if (a.protocolId !== b.protocolId) {
        return String(a.protocolId).localeCompare(String(b.protocolId));
      }
      const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.id - b.id;
    })
    .map((chunk, index) => {
      return `(${index + 1}) ${chunk.citation.filename} | ${chunk.sectionTitle || chunk.sectionType} | ${
        chunk.citation.page
      }\n${chunk.chunkText.slice(0, 1800)}`;
    });
}

function normalizeQuoteText(value: string) {
  return value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();
}

function buildExactQuoteCandidates(query: string, chunks: ProtocolContextChunk[], maxQuotes = 8): QuoteCandidate[] {
  if (chunks.length === 0) return [];
  const terms = tokenizeLite(query);
  const candidates: QuoteCandidate[] = [];

  for (const chunk of chunks) {
    const rawLines = chunk.chunkText
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.;:])\s+/))
      .map((line) => normalizeQuoteText(line))
      .filter((line) => line.length >= 24 && line.length <= 320);

    for (const line of rawLines) {
      const normalized = normalizeLite(line);
      if (!normalized) continue;
      let overlap = 0;
      for (const term of terms) {
        if (normalized.includes(term)) overlap += 1;
      }
      const keywordBoost =
        /\b(inclusion|exclusion|criteria|schedule|visit|procedure|endpoint|objective|dose|dosing|lab|sample)\b/.test(
          normalized
        )
          ? 1
          : 0;
      const score = overlap * 3 + keywordBoost;
      if (score <= 0) continue;
      candidates.push({
        quote: line,
        filename: chunk.citation.filename,
        pageLabel: chunk.citation.page,
        page: chunk.pageStart ?? chunk.pageEnd ?? null,
        section: chunk.sectionTitle || chunk.sectionType,
        score,
      });
    }
  }

  if (candidates.length === 0) {
    for (const chunk of chunks.slice(0, Math.min(8, chunks.length))) {
      const fallback = normalizeQuoteText(chunk.chunkText.slice(0, 260));
      if (!fallback) continue;
      candidates.push({
        quote: fallback,
        filename: chunk.citation.filename,
        pageLabel: chunk.citation.page,
        page: chunk.pageStart ?? chunk.pageEnd ?? null,
        section: chunk.sectionTitle || chunk.sectionType,
        score: 1,
      });
    }
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score || a.quote.length - b.quote.length)
    .filter((row) => {
      const key = normalizeLite(row.quote);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxQuotes);
}

function formatQuoteCandidatesForPrompt(candidates: QuoteCandidate[]) {
  return candidates.map((item, index) => {
    return `(${index + 1}) "${item.quote}" [Source: ${item.filename}, ${item.pageLabel}]`;
  });
}

function formatVerbatimEvidenceBlock(candidates: QuoteCandidate[], maxItems = 6) {
  if (candidates.length === 0) return null;
  return candidates
    .slice(0, maxItems)
    .map((item, index) => `${index + 1}. "${item.quote}" [Source: ${item.filename}, ${item.pageLabel}]`)
    .join("\n");
}

function buildOperationalContext(lines: OperationalEvidence[]) {
  return lines.map((line) => `- ${line.label}: ${line.value} (as-of ${line.asOf})`);
}

function buildTelemetryContext(lines: TelemetryEvidence[]) {
  return lines.map((line) => `- ${line.label}: ${line.value} (as-of ${line.asOf})`);
}

function parseOperationalTaskList(value: string) {
  const raw = String(value || "").trim();
  if (!raw || raw.toLowerCase() === "none") return [] as string[];
  return raw
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeMarkdownLinkLabel(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function buildOperationalTaskMarkdownLink(
  task: OperationalTaskItem,
  options?: {
    includeTrialLabel?: boolean;
  }
) {
  const taskId = String(task.taskId || "").trim();
  if (!taskId) return null;
  const params = new URLSearchParams();
  params.set("taskId", taskId);
  if (task.trialId) params.set("trialId", String(task.trialId));
  if (task.mapId) params.set("mapId", String(task.mapId));
  if (task.taskName) params.set("taskName", String(task.taskName));
  const href = `/__themison/task?${params.toString()}`;
  const taskLabel =
    options?.includeTrialLabel && task.trialLabel
      ? `${task.trialLabel}: ${task.taskName || "Untitled task"}`
      : task.taskName || "Untitled task";
  const dueLabel = task.dueDate || "unscheduled";
  return `[${escapeMarkdownLinkLabel(taskLabel)}](${href}) (${dueLabel})`;
}

function isDateScopedTaskQuestion(query: string) {
  const normalized = normalizeLite(query);
  if (!/\b(task|tasks|todo|to do|work)\b/.test(normalized)) return false;
  return (
    /\b(today|tomorrow|yesterday|day after tomorrow)\b/.test(normalized) ||
    /\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/.test(normalized)
  );
}

function buildDeterministicOperationalDateAnswer(query: string, opEvidence: OperationalEvidence[]) {
  if (!isDateScopedTaskQuestion(query)) return null;
  const targetDate = parseOperationalTargetDate(query);
  if (!targetDate) return null;

  const targetDateKey = formatLocalDate(targetDate);
  if (!targetDateKey) return null;

  const normalized = normalizeLite(query);
  const asksForMyTasks = /\b(my|mine|i|me)\b/.test(normalized);
  const explicitDueIntent = /\bdue\b/.test(normalized);
  const preferredLabels = asksForMyTasks
    ? explicitDueIntent
      ? [
          `My tasks due ${targetDateKey}`,
          `My queued tasks ${targetDateKey}`,
          `Tasks due ${targetDateKey}`,
          `Queued tasks ${targetDateKey}`,
          `Cross-trial tasks due ${targetDateKey}`,
          `Cross-trial queued tasks ${targetDateKey}`,
        ]
      : [
          `My queued tasks ${targetDateKey}`,
          `My tasks due ${targetDateKey}`,
          `Queued tasks ${targetDateKey}`,
          `Tasks due ${targetDateKey}`,
          `Cross-trial queued tasks ${targetDateKey}`,
          `Cross-trial tasks due ${targetDateKey}`,
        ]
    : explicitDueIntent
      ? [
          `Tasks due ${targetDateKey}`,
          `Queued tasks ${targetDateKey}`,
          `Cross-trial tasks due ${targetDateKey}`,
          `Cross-trial queued tasks ${targetDateKey}`,
          `My tasks due ${targetDateKey}`,
          `My queued tasks ${targetDateKey}`,
        ]
      : [
          `Queued tasks ${targetDateKey}`,
          `Tasks due ${targetDateKey}`,
          `Cross-trial queued tasks ${targetDateKey}`,
          `Cross-trial tasks due ${targetDateKey}`,
          `My queued tasks ${targetDateKey}`,
          `My tasks due ${targetDateKey}`,
        ];

  const candidates = preferredLabels
    .map((label) => opEvidence.find((entry) => entry.label === label))
    .filter((entry): entry is OperationalEvidence => Boolean(entry))
    .map((entry) => {
      const includeTrialLabel = normalizeLite(entry.label).includes("cross trial");
      const linkedItems = (entry.taskItems || [])
        .map((task) => buildOperationalTaskMarkdownLink(task, { includeTrialLabel }))
        .filter((item): item is string => Boolean(item));
      const fallbackItems = parseOperationalTaskList(entry.value);
      return {
        entry,
        items: linkedItems.length > 0 ? linkedItems : fallbackItems,
      };
    });
  if (candidates.length === 0) return null;
  const selectedCandidate = candidates.find((candidate) => candidate.items.length > 0) || candidates[0];
  const selected = selectedCandidate.entry;
  const taskItems = selectedCandidate.items;
  const queueLabel = normalizeLite(selected.label).includes("queued");
  const lines: string[] = [];
  if (asksForMyTasks && !normalizeLite(selected.label).startsWith("my ")) {
    lines.push(
      `No directly assigned tasks were found for ${targetDateKey}; showing scoped ${queueLabel ? "queue" : "task"} items.`
    );
    lines.push("");
  }
  if (taskItems.length === 0) {
    lines.push(
      queueLabel
        ? `No tasks are queued for ${targetDateKey} based on current operational data.`
        : `No open tasks are due on ${targetDateKey} based on current operational data.`
    );
  } else {
    lines.push(`${queueLabel ? "Queued tasks" : "Open tasks due"} on ${targetDateKey}:`);
    taskItems.slice(0, 20).forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
  }
  lines.push("", `[Operational: ${selected.label}, as-of ${selected.asOf}]`);

  return {
    message: lines.join("\n"),
    confidence: taskItems.length > 0 ? 0.9 : 0.86,
    thinking: "Returned deterministic date-scoped task answer from operational evidence.",
  };
}

function buildFallbackCitations(docEvidence: DocumentEvidence[], opEvidence: OperationalEvidence[], telemetry: TelemetryEvidence[]) {
  const lines: string[] = [];
  if (docEvidence.length > 0) {
    const unique = new Set<string>();
    for (const item of docEvidence) {
      const citation = `[Source: ${item.filename}, ${item.pageLabel}]`;
      if (unique.has(citation)) continue;
      unique.add(citation);
      lines.push(citation);
      if (lines.length >= 4) break;
    }
  }
  if (opEvidence.length > 0) {
    lines.push(`[Operational: trial_state, as-of ${opEvidence[0].asOf}]`);
  }
  if (telemetry.length > 0) {
    lines.push(`[Telemetry: map_telemetry_events, window=7d]`);
  }
  return lines;
}

function countListedItems(answer: string) {
  const numbered = answer.match(/^\s*\d+[\).]\s+/gm)?.length ?? 0;
  const bullets = answer.match(/^\s*[-•]\s+/gm)?.length ?? 0;
  return Math.max(numbered, bullets);
}

function extractSourceCitedPages(answer: string) {
  const citations = answer.match(/\[Source:[^\]]+\]/gi) || [];
  const pages: number[] = [];
  for (const citation of citations) {
    const matches = citation.match(/\b(?:p|pp)\.\s*(\d+)(?:\s*-\s*(\d+))?/gi) || [];
    for (const token of matches) {
      const parsed = token.match(/\b(?:p|pp)\.\s*(\d+)(?:\s*-\s*(\d+))?/i);
      if (!parsed) continue;
      const start = Number.parseInt(parsed[1], 10);
      const end = parsed[2] ? Number.parseInt(parsed[2], 10) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      for (let page = low; page <= high; page += 1) pages.push(page);
    }
  }
  return Array.from(new Set(pages)).sort((a, b) => a - b);
}

function collectChunkPages(chunks: ProtocolContextChunk[]) {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    const start = chunk.pageStart;
    const end = chunk.pageEnd;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const low = Math.min(Number(start), Number(end));
      const high = Math.max(Number(start), Number(end));
      for (let page = low; page <= high; page += 1) pages.add(page);
      continue;
    }
    if (Number.isFinite(start)) pages.add(Number(start));
    if (Number.isFinite(end)) pages.add(Number(end));
  }
  return pages;
}

function validateGeneratedAnswer(args: {
  question: string;
  answer: string;
  needsDoc: boolean;
  docChunks: ProtocolContextChunk[];
  expectedListSize: number | null;
}) {
  const issues: string[] = [];
  const normalizedAnswer = String(args.answer || "");
  const sourceCitationCount = (normalizedAnswer.match(/\[Source:[^\]]+\]/gi) || []).length;
  const longSentences = normalizedAnswer
    .split(/[.!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 20);

  if (args.needsDoc && longSentences.length >= 3 && sourceCitationCount === 0) {
    issues.push("Answer contains factual claims but no document citations.");
  }

  const citedPages = extractSourceCitedPages(normalizedAnswer);
  if (args.needsDoc && citedPages.length > 0) {
    const availablePages = collectChunkPages(args.docChunks);
    const invalid = citedPages.filter((page) => !availablePages.has(page));
    if (invalid.length > 0) {
      issues.push(`Citations reference pages not present in retrieved evidence: ${invalid.join(", ")}.`);
    }
  }

  const hedgingPatterns =
    /\btypically\b|\busually\b|\bgenerally\b|\bin most protocols\b|\bcommon practice\b|\bstandard procedure\b|\bit is likely\b/i;
  if (hedgingPatterns.test(normalizedAnswer)) {
    issues.push("Answer contains hedging language that may indicate inference.");
  }

  const countClaim = normalizedAnswer.match(
    /\b(\d+)\s*(?:procedures|items|criteria|assessments|tests|visits|requirements)\b/i
  );
  if (countClaim) {
    const claimed = Number.parseInt(countClaim[1], 10);
    const listed = countListedItems(normalizedAnswer);
    if (Number.isFinite(claimed) && listed > 0 && Math.abs(claimed - listed) > 1) {
      issues.push(`Answer claims ${claimed} items but lists ${listed}.`);
    }
  }

  if (args.expectedListSize && args.expectedListSize >= 4) {
    const listed = countListedItems(normalizedAnswer);
    if (listed > 0 && listed < Math.max(3, Math.floor(args.expectedListSize * 0.65))) {
      issues.push(
        `List completeness appears low (${listed}/${args.expectedListSize}) for a comprehensive query.`
      );
    }
  }

  const requiresRegeneration = issues.some((issue) =>
    /no document citations|hedging|claims .* but lists|completeness|pages not present/i.test(issue)
  );

  return {
    issues,
    requiresRegeneration,
  };
}

function inferExpectedDocListSize(
  queryPlan: UnifiedQueryPlan,
  chunks: ProtocolContextChunk[]
): number | null {
  if (!queryPlan.comprehensive) return null;

  let expected: number | null = null;
  for (const chunk of chunks) {
    const metadata = chunk.metadata ?? {};
    const structuredCriteria = metadata.structuredCriteria as
      | { inclusion?: Array<unknown>; exclusion?: Array<unknown> }
      | undefined;
    const structuredSchedule = metadata.structuredSchedule as
      | { entries?: Array<unknown>; procedures?: Array<unknown> }
      | undefined;

    if (queryPlan.focus === "inclusion" && structuredCriteria?.inclusion?.length) {
      expected = Math.max(expected ?? 0, structuredCriteria.inclusion.length);
    } else if (queryPlan.focus === "exclusion" && structuredCriteria?.exclusion?.length) {
      expected = Math.max(expected ?? 0, structuredCriteria.exclusion.length);
    } else if (queryPlan.focus === "eligibility" && structuredCriteria) {
      const size = (structuredCriteria.inclusion?.length ?? 0) + (structuredCriteria.exclusion?.length ?? 0);
      if (size > 0) expected = Math.max(expected ?? 0, size);
    } else if (queryPlan.focus === "schedule" && structuredSchedule) {
      const size = structuredSchedule.entries?.length ?? structuredSchedule.procedures?.length ?? 0;
      if (size > 0) expected = Math.max(expected ?? 0, Math.min(size, 24));
    }
  }
  return expected;
}

function buildAbstainMessage(reason: string, evidence: UnifiedEvidenceBundle) {
  const lines = [`I can’t answer this safely with complete evidence right now: ${reason}`];
  if (evidence.document.length > 0) {
    const top = evidence.document
      .slice(0, 3)
      .map((item) => `"${normalizeQuoteText(item.excerpt).slice(0, 180)}" [Source: ${item.filename}, ${item.pageLabel}]`);
    lines.push("", "Closest evidence found:", ...top);
  }
  if (evidence.operational.length > 0) {
    lines.push("", `[Operational: ${evidence.operational[0].label}, as-of ${evidence.operational[0].asOf}]`);
  }
  if (evidence.telemetry.length > 0) {
    lines.push("", `[Telemetry: map_telemetry_events, window=7d]`);
  }
  return lines.join("\n");
}

function buildSynthesisPromptBundle(args: {
  route: UnifiedRoute;
  query: string;
  history: string;
  docContext: string[];
  quoteContext: string[];
  opContext: string[];
  telemetryContext: string[];
  gaps: string[];
}) {
  const systemPrompt = `You are Themison AI, the operational intelligence layer for clinical trials.
You must answer ONLY using the provided evidence blocks.
Hard rules:
1) Never fabricate missing facts. If evidence is insufficient, explicitly state that.
2) Every claim from documents must include citation [Source: <filename>, <page label>].
2a) Document-grounded answers must include exact protocol wording in quotes, not paraphrase.
3) Every claim from live app state must include [Operational: <label>, as-of <ISO timestamp>].
4) Every claim from telemetry patterns must include [Telemetry: <dataset>, <window>].
5) For list/table/criteria questions, return complete numbered results from evidence; if partial, clearly say what is missing.
6) If conflicting evidence exists across docs, show both and call out the conflict.
7) Add a final section titled "Verbatim Evidence" with quoted excerpts + citations in this format:
   "exact excerpt" [Source: <filename>, <page label>]
Keep answers concise but complete.`;

  const userPrompt = [
    `Route: ${args.route}`,
    `Question: ${args.query}`,
    args.history ? `Conversation history:\n${args.history}` : "Conversation history: (none)",
    args.docContext.length > 0 ? `Document Evidence:\n${args.docContext.join("\n\n---\n\n")}` : "Document Evidence: (none)",
    args.quoteContext.length > 0
      ? `Verbatim Quote Candidates (copy exact text only):\n${args.quoteContext.join("\n")}`
      : "Verbatim Quote Candidates: (none)",
    args.opContext.length > 0 ? `Operational Evidence:\n${args.opContext.join("\n")}` : "Operational Evidence: (none)",
    args.telemetryContext.length > 0 ? `Telemetry Evidence:\n${args.telemetryContext.join("\n")}` : "Telemetry Evidence: (none)",
    args.gaps.length > 0 ? `Known Gaps:\n- ${args.gaps.join("\n- ")}` : "Known Gaps: (none)",
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

export async function runUnifiedQuery(params: {
  db: any;
  query: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  protocolIds?: string[];
  trialId?: string;
  /** BE trial UUID for migrated child tables (executionMaps, mapTelemetryEvents). */
  beTrialUuid?: string | null;
  demoMode?: "sample" | "full" | "building";
  userId?: number;
  maxDocChunks?: number;
}) {
  const originalQuery = params.query.trim();
  const query = applyHistoryVisitContext(originalQuery, params.messages);
  const provisionalPlan = buildUnifiedQueryPlan(
    query,
    Boolean((params.protocolIds && params.protocolIds.length > 0) || params.trialId),
    Boolean(params.trialId)
  );
  const protocolRows = await resolveProtocolsForScope(
    params.db,
    params.protocolIds,
    params.trialId,
    provisionalPlan,
    params.demoMode
  );
  const protocolFileUrls = new Map<string, string | null>(
    protocolRows.map((protocol) => [protocol.coreBackendDocumentId ?? String(protocol.id), protocol.fileUrl ?? null])
  );
  const queryPlan = buildUnifiedQueryPlan(query, protocolRows.length > 0, Boolean(params.trialId));
  const route = queryPlan.route;

  const needsDoc = queryPlan.tools.includes("document_retrieval");
  const needsOp = queryPlan.tools.includes("operational_state");
  const needsTelemetry = queryPlan.tools.includes("telemetry_patterns");

  const [docResult, opEvidence, telemetryEvidence] = await Promise.all([
    needsDoc
      ? collectDocumentEvidence(params.db, query, protocolRows, queryPlan)
      : Promise.resolve({ evidence: [], chunks: [] }),
    needsOp
      ? collectOperationalEvidence(params.db, params.trialId, params.userId, query, params.demoMode, params.beTrialUuid ?? null)
      : Promise.resolve([]),
    needsTelemetry ? collectTelemetryEvidence(params.db, params.beTrialUuid ?? null) : Promise.resolve([]),
  ]);

  const gaps: string[] = [];
  if (needsDoc && docResult.evidence.length === 0) {
    gaps.push("No relevant document evidence found in selected trial documents.");
  }
  if (needsOp && opEvidence.length === 0) {
    gaps.push("Operational state data is unavailable for this trial context.");
  }
  if (needsTelemetry && telemetryEvidence.length === 0) {
    gaps.push("Telemetry patterns are not yet available for this trial.");
  }

  const evidence: UnifiedEvidenceBundle = {
    route,
    document: docResult.evidence,
    operational: opEvidence,
    telemetry: telemetryEvidence,
    gaps,
  };

  const seenOperationalTaskSourceKeys = new Set<string>();
  const operationalTaskSources = opEvidence
    .flatMap((item) =>
      (item.taskItems || []).map((task) => {
        const key = `${task.trialId}:${task.taskId}`;
        if (!task.taskId || !task.trialId || seenOperationalTaskSourceKeys.has(key)) return null;
        seenOperationalTaskSourceKeys.add(key);
        const metaParts = [
          task.trialLabel || null,
          task.phaseName || null,
          task.dueDate ? `Due ${task.dueDate}` : "No due date",
          task.status ? `Status ${String(task.status).replace(/_/g, " ")}` : null,
          task.assigneeName ? `Assignee ${task.assigneeName}` : task.assignedRole ? `Role ${task.assignedRole}` : null,
        ].filter(Boolean);
        return {
          sourceType: "operational" as const,
          filename: task.taskName,
          section: item.label,
          page: null,
          excerpt: metaParts.join(" · "),
          category: "Task",
          taskId: task.taskId,
          trialId: task.trialId,
          mapId: task.mapId,
          dueDate: task.dueDate,
          taskStatus: task.status,
          assignedRole: task.assignedRole,
          assigneeName: task.assigneeName,
          phaseName: task.phaseName,
        };
      })
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 20);

  const operationalSummarySources = opEvidence.slice(0, 6).map((item) => ({
    sourceType: "operational" as const,
    filename: item.label,
    section: item.label,
    page: null,
    excerpt: item.value,
  }));

  const sources = [
    ...docResult.evidence.slice(0, 14).map((item) => ({
      sourceType: "document" as const,
      filename: item.filename,
      fileUrl: item.fileUrl,
      protocolId: item.protocolId,
      section: item.section,
      page: item.page,
      excerpt: item.excerpt,
      category: null,
    })),
    ...(operationalTaskSources.length > 0
      ? [...operationalTaskSources, ...operationalSummarySources.slice(0, 2)]
      : operationalSummarySources),
    ...telemetryEvidence.slice(0, 4).map((item) => ({
      sourceType: "telemetry" as const,
      filename: item.label,
      section: item.label,
      page: null,
      excerpt: item.value,
    })),
  ];

  if (route === "operational" && needsOp) {
    const deterministicOperationalDate = buildDeterministicOperationalDateAnswer(query, opEvidence);
    if (deterministicOperationalDate) {
      return {
        plan: queryPlan,
        route,
        message: deterministicOperationalDate.message,
        thinking: deterministicOperationalDate.thinking,
        sources,
        evidence,
        confidence: clamp01(deterministicOperationalDate.confidence),
        abstained: false,
        abstainReason: null,
      } satisfies UnifiedQueryResult;
    }
  }

  const hardBlockingGaps: string[] = [];
  if (queryPlan.requiredTools.includes("document_retrieval") && docResult.evidence.length === 0) {
    hardBlockingGaps.push("document evidence is missing");
  }
  if (queryPlan.requiredTools.includes("operational_state") && opEvidence.length === 0) {
    hardBlockingGaps.push("operational state data is missing");
  }
  if (queryPlan.requiredTools.includes("telemetry_patterns") && telemetryEvidence.length === 0) {
    hardBlockingGaps.push("telemetry patterns are missing");
  }
  if (hardBlockingGaps.length > 0) {
    const reason = `Required evidence unavailable: ${hardBlockingGaps.join(", ")}.`;
    return {
      plan: queryPlan,
      route,
      message: buildAbstainMessage(reason, evidence),
      thinking: "Abstaining because required evidence was not available for this query plan.",
      sources,
      evidence,
      confidence: 0,
      abstained: true,
      abstainReason: reason,
    } satisfies UnifiedQueryResult;
  }

  if (needsDoc) {
    const deterministicSchedule = await buildDeterministicScheduleAnswer(
      queryPlan,
      query,
      docResult.chunks,
      protocolFileUrls
    );
    if (deterministicSchedule) {
      const confidence = clamp01(0.86 + (docResult.evidence.length > 8 ? 0.08 : 0));
      return {
        plan: queryPlan,
        route,
        message: deterministicSchedule,
        thinking: "Returned deterministic structured schedule evidence for schedule/table query.",
        sources,
        evidence,
        confidence,
        abstained: false,
        abstainReason: null,
      } satisfies UnifiedQueryResult;
    }

    const deterministicCriteria = buildDeterministicCriteriaAnswer(queryPlan, docResult.chunks);
    if (deterministicCriteria) {
      const confidence = clamp01(0.88 + (docResult.evidence.length > 8 ? 0.06 : 0));
      return {
        plan: queryPlan,
        route,
        message: deterministicCriteria,
        thinking: "Returned deterministic structured criteria to maximize completeness and citation fidelity.",
        sources,
        evidence,
        confidence,
        abstained: false,
        abstainReason: null,
      } satisfies UnifiedQueryResult;
    }
  }

  const priorMessages = (params.messages || []).slice(-8, -1);
  const history = priorMessages.map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`).join("\n\n");
  const docContext = buildDocContext(
    docResult.chunks,
    query,
    params.maxDocChunks ?? (isComprehensiveQuestion(query) ? 40 : 24)
  );
  const quoteCandidates = needsDoc
    ? buildExactQuoteCandidates(query, docResult.chunks, isComprehensiveQuestion(query) ? 12 : 8)
    : [];
  const quoteContext = quoteCandidates.length
    ? formatQuoteCandidatesForPrompt(quoteCandidates)
    : ["(none)"];
  const opContext = buildOperationalContext(opEvidence);
  const telemetryContext = buildTelemetryContext(telemetryEvidence);
  const { systemPrompt, userPrompt } = buildSynthesisPromptBundle({
    route,
    query: query === originalQuery ? query : `${originalQuery}\n(Resolved context: ${query})`,
    history,
    docContext,
    quoteContext,
    opContext,
    telemetryContext,
    gaps,
  });

  let answer = "";
  try {
    const llmResponse = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    answer =
      extractTextContent(llmResponse.choices[0]?.message?.content) ||
      "I don't have enough evidence to answer that safely from the current trial context.";
  } catch (error) {
    // Phase 6: when the FE-local LLM is unreachable (no key), don't leak the
    // raw "[FE LLM deprecated] invokeLLM()…" internals to users — show a clean
    // note. The verbatim evidence below is still returned.
    const reason =
      error instanceof Error
        ? error.message.includes("[FE LLM deprecated]")
          ? "AI synthesis isn't available for this scope in the cloud — showing the closest matching evidence instead."
          : error.message
        : "LLM generation failed.";
    const fallbackLines: string[] = [
      "Themison AI could not generate a full synthesis right now.",
      `Reason: ${reason}`,
    ];
    const evidenceBlock = formatVerbatimEvidenceBlock(quoteCandidates, isComprehensiveQuestion(query) ? 8 : 5);
    if (evidenceBlock) {
      fallbackLines.push("", "Verbatim Evidence:", evidenceBlock);
    } else if (docResult.evidence.length > 0) {
      const top = docResult.evidence
        .slice(0, 5)
        .map((item, idx) => `${idx + 1}. "${normalizeQuoteText(item.excerpt)}" [Source: ${item.filename}, ${item.pageLabel}]`);
      fallbackLines.push("", "Closest evidence found:", ...top);
    }
    if (needsOp && opEvidence.length > 0) {
      fallbackLines.push("", `[Operational: ${opEvidence[0].label}, as-of ${opEvidence[0].asOf}]`);
    }
    if (needsTelemetry && telemetryEvidence.length > 0) {
      fallbackLines.push("", `[Telemetry: map_telemetry_events, window=7d]`);
    }
    return {
      plan: queryPlan,
      route,
      message: fallbackLines.join("\n"),
      thinking: "LLM synthesis failed; returned direct evidence fallback.",
      sources,
      evidence,
      confidence: 0,
      abstained: true,
      abstainReason: reason,
    } satisfies UnifiedQueryResult;
  }

  const fallbackCitations = buildFallbackCitations(docResult.evidence, opEvidence, telemetryEvidence);
  const applyAnswerCompliancePass = (draft: string) => {
    let next = draft;
    if (docResult.evidence.length > 0 && !hasDocCitation(next)) {
      next += `\n\n${fallbackCitations.filter((line) => line.startsWith("[Source:")).join("\n")}`;
    }
    if (needsOp && opEvidence.length > 0 && !hasOperationalCitation(next)) {
      next += `\n\n[Operational: trial_state, as-of ${opEvidence[0].asOf}]`;
    }
    if (needsTelemetry && telemetryEvidence.length > 0 && !hasTelemetryCitation(next)) {
      next += `\n\n[Telemetry: map_telemetry_events, window=7d]`;
    }
    if (needsTelemetry && telemetryEvidence.length === 0 && !next.toLowerCase().includes("telemetry")) {
      next += `\n\nTelemetry patterns are not available yet for this trial.`;
    }
    if (needsDoc && docResult.evidence.length > 0 && !hasQuotedDocumentEvidence(next)) {
      const evidenceBlock = formatVerbatimEvidenceBlock(quoteCandidates, isComprehensiveQuestion(query) ? 8 : 5);
      if (evidenceBlock) {
        next += `\n\nVerbatim Evidence:\n${evidenceBlock}`;
      }
    }
    return next;
  };

  answer = applyAnswerCompliancePass(answer);
  const expectedListSize = inferExpectedDocListSize(queryPlan, docResult.chunks);
  let answerValidation = validateGeneratedAnswer({
    question: query,
    answer,
    needsDoc: needsDoc && docResult.evidence.length > 0,
    docChunks: docResult.chunks,
    expectedListSize,
  });

  if (answerValidation.requiresRegeneration) {
    try {
      const retryResponse = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `${userPrompt}

Validation issues to fix:
- ${answerValidation.issues.join("\n- ")}

Previous draft (fix this, do not repeat errors):
${answer}

Return a corrected final answer that:
- uses only provided evidence
- cites every factual claim with [Source: ..., p./pp.]
- avoids hedging language
- keeps list counts and listed items consistent`,
          },
        ],
      });
      const retryText = extractTextContent(retryResponse.choices[0]?.message?.content);
      if (retryText) {
        answer = applyAnswerCompliancePass(retryText);
        answerValidation = validateGeneratedAnswer({
          question: query,
          answer,
          needsDoc: needsDoc && docResult.evidence.length > 0,
          docChunks: docResult.chunks,
          expectedListSize,
        });
      }
    } catch (error) {
      console.warn("[unifiedQuery] Regeneration after validation failure did not complete", error);
    }
  }

  const citationViolations: string[] = [];
  if (needsDoc && docResult.evidence.length > 0 && !hasDocCitation(answer)) {
    citationViolations.push("missing document citations");
  }
  if (needsDoc && docResult.evidence.length > 0 && !hasQuotedDocumentEvidence(answer)) {
    citationViolations.push("missing verbatim document excerpts");
  }
  if (needsOp && opEvidence.length > 0 && !hasOperationalCitation(answer)) {
    citationViolations.push("missing operational citations");
  }
  if (needsTelemetry && telemetryEvidence.length > 0 && !hasTelemetryCitation(answer)) {
    citationViolations.push("missing telemetry citations");
  }
  if (citationViolations.length > 0) {
    const reason = `Citation guard failed: ${citationViolations.join(", ")}.`;
    return {
      plan: queryPlan,
      route,
      message: buildAbstainMessage(reason, evidence),
      thinking: "Abstaining because citation requirements were not satisfied.",
      sources,
      evidence,
      confidence: 0,
      abstained: true,
      abstainReason: reason,
    } satisfies UnifiedQueryResult;
  }

  if (answerValidation.issues.length > 0) {
    const reason = `Post-answer validation failed: ${answerValidation.issues.join(" | ")}`;
    return {
      plan: queryPlan,
      route,
      message: buildAbstainMessage(reason, evidence),
      thinking: "Abstaining because answer did not pass post-generation validation checks.",
      sources,
      evidence,
      confidence: 0,
      abstained: true,
      abstainReason: reason,
    } satisfies UnifiedQueryResult;
  }

  const confidenceBase =
    (docResult.evidence.length > 0 ? 0.45 : 0) +
    (opEvidence.length > 0 ? 0.3 : 0) +
    (telemetryEvidence.length > 0 ? 0.2 : 0) -
    gaps.length * 0.15;
  const confidence = clamp01(confidenceBase);

  return {
    plan: queryPlan,
    route,
    message: answer,
    thinking:
      route === "hybrid"
        ? "Combining protocol evidence with live operational context for a unified answer."
        : route === "document"
        ? "Grounding response in trial document evidence with page-level citations."
        : route === "operational"
        ? "Answering from live trial execution data and task state."
        : "Checking telemetry patterns and known execution signals.",
    sources,
    evidence,
    confidence,
    abstained: isAbstainLanguage(answer) || gaps.length > 0,
    abstainReason: isAbstainLanguage(answer) ? "Model self-reported insufficient evidence." : null,
  } satisfies UnifiedQueryResult;
}

export async function runUnifiedQueryDiagnostics(params: {
  db: any;
  query: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  protocolIds?: string[];
  trialId?: string;
  /** BE trial UUID for migrated child tables (executionMaps, mapTelemetryEvents). */
  beTrialUuid?: string | null;
  demoMode?: "sample" | "full" | "building";
  userId?: number;
  maxDocChunks?: number;
}) {
  const originalQuery = params.query.trim();
  const query = applyHistoryVisitContext(originalQuery, params.messages);
  const provisionalPlan = buildUnifiedQueryPlan(
    query,
    Boolean((params.protocolIds && params.protocolIds.length > 0) || params.trialId),
    Boolean(params.trialId)
  );
  const protocolRows = await resolveProtocolsForScope(
    params.db,
    params.protocolIds,
    params.trialId,
    provisionalPlan,
    params.demoMode
  );
  const protocolFileUrls = new Map<string, string | null>(
    protocolRows.map((protocol) => [protocol.coreBackendDocumentId ?? String(protocol.id), protocol.fileUrl ?? null])
  );
  const queryPlan = buildUnifiedQueryPlan(query, protocolRows.length > 0, Boolean(params.trialId));
  const route = queryPlan.route;

  const needsDoc = queryPlan.tools.includes("document_retrieval");
  const needsOp = queryPlan.tools.includes("operational_state");
  const needsTelemetry = queryPlan.tools.includes("telemetry_patterns");

  const [docResult, opEvidence, telemetryEvidence] = await Promise.all([
    needsDoc
      ? collectDocumentEvidence(params.db, query, protocolRows, queryPlan)
      : Promise.resolve({
          evidence: [] as DocumentEvidence[],
          chunks: [] as ProtocolContextChunk[],
          debug: {
            hints: [],
            expandedQuery: query,
            queryExpansionMatches: [],
            routing: {
              preferredChunkTypes: [],
              boostSections: [],
              minChunks: 3,
              maxChunks: 8,
              requireCompletenessCheck: false,
            },
            comprehensive: false,
            candidateCount: 0,
            selectedCount: 0,
            candidates: [],
          } satisfies DocumentRetrievalDebug,
        }),
    needsOp
      ? collectOperationalEvidence(params.db, params.trialId, params.userId, query, params.demoMode, params.beTrialUuid ?? null)
      : Promise.resolve([]),
    needsTelemetry ? collectTelemetryEvidence(params.db, params.beTrialUuid ?? null) : Promise.resolve([]),
  ]);

  const gaps: string[] = [];
  if (needsDoc && docResult.evidence.length === 0) gaps.push("No relevant document evidence found.");
  if (needsOp && opEvidence.length === 0) gaps.push("Operational state data unavailable.");
  if (needsTelemetry && telemetryEvidence.length === 0) gaps.push("Telemetry patterns unavailable.");

  const priorMessages = (params.messages || []).slice(-8, -1);
  const history = priorMessages.map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`).join("\n\n");
  const docContext = buildDocContext(
    docResult.chunks,
    query,
    params.maxDocChunks ?? (isComprehensiveQuestion(query) ? 40 : 24)
  );
  const quoteCandidates = needsDoc
    ? buildExactQuoteCandidates(query, docResult.chunks, isComprehensiveQuestion(query) ? 12 : 8)
    : [];
  const quoteContext = quoteCandidates.length
    ? formatQuoteCandidatesForPrompt(quoteCandidates)
    : ["(none)"];
  const opContext = buildOperationalContext(opEvidence);
  const telemetryContext = buildTelemetryContext(telemetryEvidence);
  const prompts = buildSynthesisPromptBundle({
    route,
    query: query === originalQuery ? query : `${originalQuery}\n(Resolved context: ${query})`,
    history,
    docContext,
    quoteContext,
    opContext,
    telemetryContext,
    gaps,
  });

  const deterministicCriteria = needsDoc ? buildDeterministicCriteriaAnswer(queryPlan, docResult.chunks) : null;
  const deterministicSchedule = needsDoc
    ? await buildDeterministicScheduleAnswer(queryPlan, query, docResult.chunks, protocolFileUrls)
    : null;

  const primaryProtocol = protocolRows[0];
  let parserPages: Array<{ pageNumber: number; textSnippet: string }> = [];
  if (primaryProtocol?.fileKey) {
    try {
      // Read bytes by key (authenticated/disk) rather than fetching the
      // raw fileUrl, which fails on cloud (Render) with "fetch failed".
      const pdfBuffer = await storageReadBytes(primaryProtocol.fileKey);
      const pages = await extractPdfPagesFromBuffer(pdfBuffer);
      const preferred = new Set<number>();
      for (const chunk of docResult.chunks.slice(0, 24)) {
        if (chunk.pageStart) preferred.add(chunk.pageStart);
        if (chunk.pageEnd) preferred.add(chunk.pageEnd);
      }
      const scheduleEvidence = collectStructuredScheduleEvidence(docResult.chunks);
      const criteriaEvidence = collectStructuredCriteriaEvidence(docResult.chunks);
      for (const page of scheduleEvidence?.structured.sourcePages || []) preferred.add(page);
      for (const page of criteriaEvidence?.structured.sourcePages || []) preferred.add(page);
      const pagesToShow = Array.from(preferred)
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
        .slice(0, 8);
      parserPages = pagesToShow
        .map((pageNumber) => {
          const page = pages.find((item) => item.pageNumber === pageNumber);
          if (!page) return null;
          return {
            pageNumber,
            textSnippet: page.text.slice(0, 2200),
          };
        })
        .filter((item): item is { pageNumber: number; textSnippet: string } => Boolean(item));
    } catch {
      parserPages = [];
    }
  }

  const answer = await runUnifiedQuery(params);
  return {
    query,
    plan: queryPlan,
    route,
    protocols: protocolRows.map((protocol) => ({
      protocolId: protocol.coreBackendDocumentId ?? String(protocol.id),
      filename: protocol.filename,
      category: protocol.category ?? null,
      isCurrent: Boolean(protocol.isCurrent),
      createdAt: protocol.createdAt ? new Date(protocol.createdAt).toISOString() : null,
      fileUrl: protocol.fileUrl ?? null,
    })),
    retrieval: docResult.debug,
    parserPages,
    chunkCoverage: docResult.chunks.slice(0, 40).map((chunk) => ({
      chunkId: chunk.id,
      protocolId: chunk.protocolId,
      sectionType: chunk.sectionType,
      sectionTitle: chunk.sectionTitle,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      pageLabel: chunk.citation.page,
      excerpt: chunk.chunkText.slice(0, 280),
    })),
    context: {
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      docContextCount: docContext.length,
      quoteCandidateCount: quoteCandidates.length,
      operationalEvidenceCount: opEvidence.length,
      telemetryEvidenceCount: telemetryEvidence.length,
    },
    deterministicPreview: {
      criteria: deterministicCriteria,
      schedule: deterministicSchedule,
    },
    answer,
  } satisfies UnifiedQueryDiagnostics;
}

export async function evaluateUnifiedRetrievalQuality(params: {
  db: any;
  query: string;
  protocolIds: string[];
}) {
  const queryPlan = buildUnifiedQueryPlan(params.query, true, false);
  const protocolRows = await resolveProtocolsForScope(params.db, params.protocolIds, undefined, queryPlan);
  const route = queryPlan.route;
  const grouped = await Promise.all(
    protocolRows.map(async (protocol) => {
      const chunks = await getProtocolContextChunks({
        protocolId: protocol.coreBackendDocumentId ?? String(protocol.id),
        query: params.query,
        comprehensive: true,
        limit: 12,
      });
      const uniqueSections = new Set(chunks.map((chunk) => chunk.sectionTitle || chunk.sectionType));
      const uniquePages = new Set(chunks.map((chunk) => chunk.pageStart ?? chunk.pageEnd ?? null));
      const eligibilityHits = chunks.filter((chunk) => chunk.sectionType === "eligibility").length;
      const scheduleHits = chunks.filter((chunk) => chunk.sectionType === "schedule").length;
      const amendmentLikeHits = chunks.filter((chunk) =>
        /\bamendment\b|\brevision\b/.test(normalizeLite(`${chunk.sectionTitle || ""} ${chunk.chunkText.slice(0, 500)}`))
      ).length;

      const qualityFlags: string[] = [];
      if (chunks.length < 4) qualityFlags.push("LOW_RETRIEVAL_COUNT");
      if (eligibilityHits === 0 && /(inclusion|exclusion|criteria|eligibility)/i.test(params.query)) {
        qualityFlags.push("MISSING_ELIGIBILITY_CHUNKS");
      }
      if (scheduleHits === 0 && /(schedule|visit|table|soa|assessments?)/i.test(params.query)) {
        qualityFlags.push("MISSING_SCHEDULE_CHUNKS");
      }
      if (amendmentLikeHits > Math.max(2, Math.round(chunks.length * 0.6))) {
        qualityFlags.push("AMENDMENT_BIAS");
      }

      return {
        protocolId: protocol.coreBackendDocumentId ?? String(protocol.id),
        filename: protocol.filename,
        retrievedCount: chunks.length,
        uniqueSections: uniqueSections.size,
        uniquePages: uniquePages.size,
        eligibilityHits,
        scheduleHits,
        amendmentLikeHits,
        qualityFlags,
        topPages: Array.from(uniquePages).slice(0, 8),
        topSections: Array.from(uniqueSections).slice(0, 8),
      };
    })
  );

  const totalFlags = grouped.reduce((sum, item) => sum + item.qualityFlags.length, 0);
  const qualityScore = clamp01(1 - totalFlags / Math.max(4, grouped.length * 4));
  const notes: string[] = [];
  if (qualityScore < 0.6) notes.push("Retrieval quality is low; review chunking and section hint routing.");
  if (grouped.some((item) => item.qualityFlags.includes("AMENDMENT_BIAS"))) {
    notes.push("Amendment-heavy retrieval detected; boost canonical protocol sections for this query class.");
  }

  return {
    route,
    query: params.query,
    protocols: grouped,
    qualityScore,
    notes,
  } satisfies RetrievalQualityReport;
}
