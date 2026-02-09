import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  executionMaps,
  fileSearchDocuments,
  mapPhases,
  mapTasks,
  mapTelemetryEvents,
  protocols,
  trials,
  type ExecutionMap,
  type MapPhase,
  type MapTask,
  type MapTelemetryEvent,
  type Protocol,
  type Trial,
} from "../../drizzle/schema";
import { invokeLLM } from "./llm";
import { getProtocolContextChunks, type ProtocolContextChunk } from "./protocolContext";

export type UnifiedRoute = "document" | "operational" | "hybrid" | "telemetry";

export type DocumentEvidence = {
  protocolId: number;
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
  route: UnifiedRoute;
  message: string;
  thinking: string;
  sources: Array<{
    filename: string;
    fileUrl?: string | null;
    protocolId?: number;
    section?: string;
    page?: number | null;
    excerpt?: string;
    category?: string | null;
    sourceType: "document" | "operational" | "telemetry";
  }>;
  evidence: UnifiedEvidenceBundle;
  confidence: number;
  abstained: boolean;
};

export type RetrievalQualityReport = {
  route: UnifiedRoute;
  query: string;
  protocols: Array<{
    protocolId: number;
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

function isComprehensiveQuestion(query: string) {
  return /(all|list|criteria|criterion|requirements?|which|what are|table|schedule|assessments?|endpoints?|procedures?|eligibility|inclusion|exclusion|footnote|visit window|dosing|cohort|arm\b)/i.test(
    query
  );
}

function getSectionTypeHints(query: string): string[] | undefined {
  const normalized = query.toLowerCase();
  if (/(inclusion|exclusion|eligibility|criteria)/i.test(normalized)) return ["eligibility"];
  if (/(schedule|table|matrix|visit window|assessments?)/i.test(normalized)) return ["schedule", "visits"];
  if (/(endpoint|endpoints|objective|objectives)/i.test(normalized)) return ["endpoints", "objectives"];
  if (/(procedure|procedures|dosing|drug administration|laboratory|lab sample|samples)/i.test(normalized)) {
    return ["dosing", "laboratory", "visits", "schedule"];
  }
  return undefined;
}

function inferRoute(query: string, hasDocs: boolean, hasTrial: boolean): UnifiedRoute {
  const normalized = normalizeLite(query);
  const docSignals =
    /\b(protocol|manual|icf|sop|amendment|criteria|inclusion|exclusion|section|page|visit window|schedule|table|endpoint|dose|dosing|procedure)\b/.test(
      normalized
    ) || hasDocs;
  const opSignals =
    /\b(task|overdue|assigned|team|status|progress|on track|deadline|pending|blocked|enrollment|enrolled|map|launch)\b/.test(
      normalized
    ) || hasTrial;
  const telemetrySignals =
    /\b(usually|historically|trend|pattern|average|common|across sites|most often|frequently)\b/.test(normalized);

  if (telemetrySignals && !docSignals && !opSignals) return "telemetry";
  if (docSignals && opSignals) return "hybrid";
  if (opSignals) return "operational";
  return "document";
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

function hasOperationalCitation(text: string) {
  return /\[Operational:\s*[^\]]+\]/i.test(text);
}

function hasTelemetryCitation(text: string) {
  return /\[Telemetry:\s*[^\]]+\]/i.test(text);
}

function formatIsoNow() {
  return new Date().toISOString();
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
  explicitProtocolIds: number[] | undefined,
  trialId: string | undefined
): Promise<Protocol[]> {
  if (explicitProtocolIds && explicitProtocolIds.length > 0) {
    return (await db.select().from(protocols).where(inArray(protocols.id, explicitProtocolIds))) as Protocol[];
  }
  if (!trialId) return [];

  const active = (await db
    .select()
    .from(protocols)
    .where(and(eq(protocols.trialId, trialId), isNull(protocols.archivedAt)))
    .orderBy(desc(protocols.createdAt))) as Protocol[];

  if (active.length > 0) return active;
  return (await db.select().from(protocols).where(eq(protocols.trialId, trialId)).orderBy(desc(protocols.createdAt))) as Protocol[];
}

async function collectDocumentEvidence(
  db: any,
  query: string,
  protocolRows: Protocol[]
) {
  if (protocolRows.length === 0) {
    return {
      evidence: [] as DocumentEvidence[],
      chunks: [] as ProtocolContextChunk[],
    };
  }

  const hints = getSectionTypeHints(query);
  const comprehensive = isComprehensiveQuestion(query);

  const grouped = await Promise.all(
    protocolRows.map(async (protocol) => {
      const requestBase = {
        protocolId: protocol.id,
        query,
        comprehensive: true as const,
        limit: comprehensive ? 10 : 6,
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

  const ranked = uniqueChunks
    .map((chunk) => ({
      chunk,
      score: Math.max(chunk.score ?? 0, scoreChunkLite(query, chunk)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, comprehensive ? 32 : 18);

  const selectedChunks = ranked
    .map((item) => item.chunk)
    .sort((a, b) => {
      if (a.protocolId !== b.protocolId) return a.protocolId - b.protocolId;
      const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.id - b.id;
    });

  const protocolById = new Map(protocolRows.map((protocol) => [protocol.id, protocol]));
  const evidence = ranked.map(({ chunk, score }): DocumentEvidence => {
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

  return { evidence, chunks: selectedChunks };
}

async function collectOperationalEvidence(db: any, trialId?: string) {
  if (!trialId) return [] as OperationalEvidence[];
  const asOf = formatIsoNow();

  const trialRows = (await db.select().from(trials).where(eq(trials.id, trialId)).limit(1)) as Trial[];
  const trial = trialRows[0];
  if (!trial) return [] as OperationalEvidence[];

  const evidence: OperationalEvidence[] = [];
  evidence.push({
    label: "Trial status",
    value: `${trial.status}; phase ${trial.phase || "n/a"}; enrolled ${trial.enrolledPatients || 0}/${trial.targetPatients || 0}`,
    asOf,
  });

  const mapRows = (await db
    .select()
    .from(executionMaps)
    .where(eq(executionMaps.trialId, trialId))
    .orderBy(desc(executionMaps.status), desc(executionMaps.updatedAt))
    .limit(1)) as ExecutionMap[];
  const activeMap = mapRows[0];
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

  const phaseCount = phasesRows.length;
  const total = tasksRows.length;
  const byStatus = tasksRows.reduce((acc: Record<string, number>, task: MapTask) => {
    const key = task.status || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const now = Date.now();
  const overdue = tasksRows.filter((task: MapTask) => {
    if (!task.dueDate) return false;
    if (task.status === "done" || task.status === "cancelled" || task.status === "skipped") return false;
    return new Date(task.dueDate).getTime() < now;
  });
  const dueSoon = tasksRows.filter((task: MapTask) => {
    if (!task.dueDate) return false;
    if (task.status === "done" || task.status === "cancelled" || task.status === "skipped") return false;
    const delta = new Date(task.dueDate).getTime() - now;
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

async function collectTelemetryEvidence(db: any, trialId?: string) {
  if (!trialId) return [] as TelemetryEvidence[];
  const asOf = formatIsoNow();
  const rows = (await db
    .select()
    .from(mapTelemetryEvents)
    .where(eq(mapTelemetryEvents.trialId, trialId))
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

function buildDocContext(chunks: ProtocolContextChunk[], maxItems = 24) {
  return chunks.slice(0, maxItems).map((chunk, index) => {
    return `(${index + 1}) ${chunk.citation.filename} | ${chunk.sectionTitle || chunk.sectionType} | ${
      chunk.citation.page
    }\n${chunk.chunkText.slice(0, 1800)}`;
  });
}

function buildOperationalContext(lines: OperationalEvidence[]) {
  return lines.map((line) => `- ${line.label}: ${line.value} (as-of ${line.asOf})`);
}

function buildTelemetryContext(lines: TelemetryEvidence[]) {
  return lines.map((line) => `- ${line.label}: ${line.value} (as-of ${line.asOf})`);
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

export async function runUnifiedQuery(params: {
  db: any;
  query: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  protocolIds?: number[];
  trialId?: string;
  userId?: number;
  maxDocChunks?: number;
}) {
  const query = params.query.trim();
  const protocolRows = await resolveProtocolsForScope(params.db, params.protocolIds, params.trialId);
  const route = inferRoute(query, protocolRows.length > 0, Boolean(params.trialId));

  const needsDoc = route === "document" || route === "hybrid";
  const needsOp = route === "operational" || route === "hybrid";
  const needsTelemetry = route === "telemetry" || route === "hybrid";

  const [docResult, opEvidence, telemetryEvidence] = await Promise.all([
    needsDoc ? collectDocumentEvidence(params.db, query, protocolRows) : Promise.resolve({ evidence: [], chunks: [] }),
    needsOp ? collectOperationalEvidence(params.db, params.trialId) : Promise.resolve([]),
    needsTelemetry ? collectTelemetryEvidence(params.db, params.trialId) : Promise.resolve([]),
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

  const priorMessages = (params.messages || []).slice(-8, -1);
  const history = priorMessages.map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`).join("\n\n");
  const docContext = buildDocContext(docResult.chunks, params.maxDocChunks ?? 24);
  const opContext = buildOperationalContext(opEvidence);
  const telemetryContext = buildTelemetryContext(telemetryEvidence);

  const systemPrompt = `You are Themison AI, the operational intelligence layer for clinical trials.
You must answer ONLY using the provided evidence blocks.
Hard rules:
1) Never fabricate missing facts. If evidence is insufficient, explicitly state that.
2) Every claim from documents must include citation [Source: <filename>, <page label>].
3) Every claim from live app state must include [Operational: <label>, as-of <ISO timestamp>].
4) Every claim from telemetry patterns must include [Telemetry: <dataset>, <window>].
5) For list/table/criteria questions, return complete numbered results from evidence; if partial, clearly say what is missing.
6) If conflicting evidence exists across docs, show both and call out the conflict.
Keep answers concise but complete.`;

  const userPrompt = [
    `Route: ${route}`,
    `Question: ${query}`,
    history ? `Conversation history:\n${history}` : "Conversation history: (none)",
    docContext.length > 0 ? `Document Evidence:\n${docContext.join("\n\n---\n\n")}` : "Document Evidence: (none)",
    opContext.length > 0 ? `Operational Evidence:\n${opContext.join("\n")}` : "Operational Evidence: (none)",
    telemetryContext.length > 0 ? `Telemetry Evidence:\n${telemetryContext.join("\n")}` : "Telemetry Evidence: (none)",
    gaps.length > 0 ? `Known Gaps:\n- ${gaps.join("\n- ")}` : "Known Gaps: (none)",
  ].join("\n\n");

  const llmResponse = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  let answer =
    extractTextContent(llmResponse.choices[0]?.message?.content) ||
    "I don't have enough evidence to answer that safely from the current trial context.";

  const fallbackCitations = buildFallbackCitations(docResult.evidence, opEvidence, telemetryEvidence);
  if (docResult.evidence.length > 0 && !hasDocCitation(answer)) {
    answer += `\n\n${fallbackCitations.filter((line) => line.startsWith("[Source:")).join("\n")}`;
  }
  if (needsOp && opEvidence.length > 0 && !hasOperationalCitation(answer)) {
    answer += `\n\n[Operational: trial_state, as-of ${opEvidence[0].asOf}]`;
  }
  if (needsTelemetry && telemetryEvidence.length > 0 && !hasTelemetryCitation(answer)) {
    answer += `\n\n[Telemetry: map_telemetry_events, window=7d]`;
  }
  if (needsTelemetry && telemetryEvidence.length === 0 && !answer.toLowerCase().includes("telemetry")) {
    answer += `\n\nTelemetry patterns are not available yet for this trial.`;
  }

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
    ...opEvidence.slice(0, 6).map((item) => ({
      sourceType: "operational" as const,
      filename: item.label,
      section: item.label,
      page: null,
      excerpt: item.value,
    })),
    ...telemetryEvidence.slice(0, 4).map((item) => ({
      sourceType: "telemetry" as const,
      filename: item.label,
      section: item.label,
      page: null,
      excerpt: item.value,
    })),
  ];

  const confidenceBase =
    (docResult.evidence.length > 0 ? 0.45 : 0) +
    (opEvidence.length > 0 ? 0.3 : 0) +
    (telemetryEvidence.length > 0 ? 0.2 : 0) -
    gaps.length * 0.15;
  const confidence = clamp01(confidenceBase);

  return {
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
  } satisfies UnifiedQueryResult;
}

export async function evaluateUnifiedRetrievalQuality(params: {
  db: any;
  query: string;
  protocolIds: number[];
}) {
  const protocolRows = await resolveProtocolsForScope(params.db, params.protocolIds, undefined);
  const route = inferRoute(params.query, protocolRows.length > 0, false);
  const grouped = await Promise.all(
    protocolRows.map(async (protocol) => {
      const chunks = await getProtocolContextChunks({
        protocolId: protocol.id,
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
        protocolId: protocol.id,
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
