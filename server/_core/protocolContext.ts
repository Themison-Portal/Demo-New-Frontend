import { createHash } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { protocolChunks, protocols } from "../../drizzle/schema";
import { getDb } from "../db";
import { invokeEmbeddings, invokeLLM } from "./llm";
import { extractPdfPages, type PdfPageText } from "../pdfExtractor";

type SectionAccumulator = {
  title: string;
  sectionType: string;
  lines: string[];
  pageStart: number | null;
  pageEnd: number | null;
};

type ScheduleVisit = {
  name: string;
  day?: string | null;
};

type ScheduleProcedure = {
  name: string;
  category?: string | null;
};

type ScheduleEntry = {
  procedure: string;
  visit: string;
  required: boolean;
  footnoteRef?: string | null;
};

type ScheduleFootnote = {
  number: string;
  text: string;
};

export type StructuredSchedule = {
  visits: ScheduleVisit[];
  procedures: ScheduleProcedure[];
  entries: ScheduleEntry[];
  footnotes: ScheduleFootnote[];
  sourcePages: number[];
};

export type ParsedProtocolChunk = {
  chunkIndex: number;
  sectionType: string;
  sectionTitle: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  tokenEstimate: number;
  contentHash: string;
  chunkText: string;
  metadata: Record<string, unknown>;
};

export type ProtocolContextChunk = {
  id: number;
  protocolId: number;
  trialId: string;
  sectionType: string;
  sectionTitle: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  chunkText: string;
  tokenEstimate: number | null;
  score?: number;
  citation: {
    filename: string;
    sectionTitle: string | null;
    page: string;
  };
  retrievalScores?: {
    lexical: number;
    semantic: number;
  };
};

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\r/g, "")
    .trim();
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function estimateTokens(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words * 1.3));
}

function parsePageMarker(line: string) {
  const marker =
    line.match(/^page\s+(\d{1,4})$/i) ||
    line.match(/^\[?\s*p(?:age)?\.?\s*(\d{1,4})\s*\]?$/i) ||
    line.match(/\bpage\s+(\d{1,4})\b/i);
  if (!marker) return null;
  const parsed = Number.parseInt(marker[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function headingKeywordMatch(line: string) {
  return /^(synopsis|study synopsis|objectives?|endpoints?|study design|schedule of assessments?|schedule of activities|inclusion criteria|exclusion criteria|eligibility|screening|baseline|visit\s+\d+|follow[\s-]?up|end[\s-]?of[\s-]?study|safety|adverse events?|laboratory|lab|dosing|drug administration|statistical)/i.test(
    line
  );
}

function isLikelyHeading(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized || normalized.length < 3 || normalized.length > 130) return false;

  if (headingKeywordMatch(normalized)) return true;
  if (/^\d+(\.\d+){0,3}\s+[A-Za-z]/.test(normalized)) return true;

  const letters = normalized.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  const uppercase = letters.replace(/[^A-Z]/g, "").length;
  const uppercaseRatio = uppercase / letters.length;
  const words = normalized.split(/\s+/).length;
  return uppercaseRatio > 0.72 && words <= 14;
}

function classifySectionType(title: string) {
  const normalized = title.toLowerCase();
  if (/(inclusion|exclusion|eligibility)/.test(normalized)) return "eligibility";
  if (/(visit|screening|baseline|follow-up|follow up|end of study|schedule)/.test(normalized)) {
    return "visits";
  }
  if (/(objective)/.test(normalized)) return "objectives";
  if (/(endpoint)/.test(normalized)) return "endpoints";
  if (/(safety|adverse event|ae|serious adverse)/.test(normalized)) return "safety";
  if (/(lab|laboratory|sample|biomarker)/.test(normalized)) return "laboratory";
  if (/(dose|dosing|drug administration|ip|investigational product)/.test(normalized)) {
    return "dosing";
  }
  if (/(statistical|analysis)/.test(normalized)) return "analysis";
  if (/(synopsis|summary)/.test(normalized)) return "synopsis";
  return "general";
}

function splitTextWindowed(text: string, maxChars = 2400, overlapChars = 320) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const maxEnd = Math.min(normalized.length, start + maxChars);
    let cut = maxEnd;
    if (maxEnd < normalized.length) {
      const searchStart = Math.max(start + Math.floor(maxChars * 0.55), start);
      const sentenceCut = normalized.lastIndexOf(". ", maxEnd);
      if (sentenceCut >= searchStart) {
        cut = sentenceCut + 1;
      } else {
        const spaceCut = normalized.lastIndexOf(" ", maxEnd);
        if (spaceCut > searchStart) cut = spaceCut;
      }
    }

    const chunk = normalized.slice(start, cut).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (cut >= normalized.length) break;
    start = Math.max(cut - overlapChars, start + 1);
  }
  return chunks;
}

function splitEligibilityCriteria(sectionText: string) {
  const lines = sectionText
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const numbered = lines.filter((line) => /^(\d+[\).]|[-•])\s+/.test(line));
  if (numbered.length >= 3) {
    return numbered.map((line) => line.replace(/^(\d+[\).]|[-•])\s+/, "").trim());
  }
  return splitTextWindowed(sectionText);
}

function detectChunkType(section: SectionAccumulator, chunkText: string) {
  const title = normalizeText(section.title);
  const body = normalizeText(chunkText);
  if (title.includes("schedule of activities") || title.includes("schedule of assessments")) {
    return "table";
  }
  if (section.sectionType === "eligibility") {
    if (title.includes("inclusion")) return "inclusion_criterion";
    if (title.includes("exclusion")) return "exclusion_criterion";
    return "eligibility_criterion";
  }
  if (body.includes("footnote") || /\(\d+\)/.test(chunkText)) return "footnote";
  if (section.sectionType === "visits") return "visit_description";
  if (section.sectionType === "dosing") return "procedure_description";
  return "text";
}

function sectionContextPrefix(section: SectionAccumulator) {
  const pageLabel =
    section.pageStart && section.pageEnd && section.pageEnd !== section.pageStart
      ? `pp.${section.pageStart}-${section.pageEnd}`
      : section.pageStart
      ? `p.${section.pageStart}`
      : "page n/a";
  return `Section: ${section.title || "Untitled"} (${section.sectionType}, ${pageLabel})`;
}

function splitSectionIntoChunks(section: SectionAccumulator) {
  const text = normalizeWhitespace(section.lines.join("\n"));
  if (!text) return [];
  if (section.sectionType === "eligibility") {
    return splitEligibilityCriteria(text);
  }
  return splitTextWindowed(text);
}

function scheduleStructuredText(schedule: StructuredSchedule) {
  const visitLines = schedule.visits.map((visit) => `${visit.name}${visit.day ? ` (${visit.day})` : ""}`);
  const entryLines = schedule.entries.map((entry) => {
    const foot = entry.footnoteRef ? ` [fn ${entry.footnoteRef}]` : "";
    return `${entry.procedure} @ ${entry.visit}: ${entry.required ? "required" : "optional"}${foot}`;
  });
  const footnotes = schedule.footnotes.map((note) => `${note.number}: ${note.text}`);
  return [
    "Structured Schedule of Activities",
    "",
    "Visits:",
    ...visitLines.map((line) => `- ${line}`),
    "",
    "Procedure Requirements:",
    ...entryLines.map((line) => `- ${line}`),
    ...(footnotes.length > 0 ? ["", "Footnotes:", ...footnotes.map((line) => `- ${line}`)] : []),
  ].join("\n");
}

function toEmbeddingVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const vector = value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isFinite(item));
  return vector.length > 0 ? vector : null;
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function extractScheduleSourcePages(chunks: ParsedProtocolChunk[]) {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    if (!chunk.pageStart && !chunk.pageEnd) continue;
    if (chunk.pageStart) pages.add(chunk.pageStart);
    if (chunk.pageEnd) pages.add(chunk.pageEnd);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

async function extractStructuredScheduleFromChunks(
  chunks: ParsedProtocolChunk[]
): Promise<StructuredSchedule | null> {
  const scheduleChunks = chunks.filter((chunk) => {
    const title = normalizeText(chunk.sectionTitle ?? "");
    const body = normalizeText(chunk.chunkText);
    return (
      title.includes("schedule of activities") ||
      title.includes("schedule of assessments") ||
      body.includes("schedule of activities") ||
      body.includes("schedule of assessments")
    );
  });
  if (scheduleChunks.length === 0) return null;

  const sourcePages = extractScheduleSourcePages(scheduleChunks);
  const sourceText = scheduleChunks
    .slice(0, 6)
    .map((chunk) => chunk.chunkText)
    .join("\n\n")
    .slice(0, 18000);

  if (!sourceText.trim()) return null;

  const systemPrompt = `You extract Schedule of Activities tables from clinical trial protocols.
Return only JSON with:
{
  "visits":[{"name":"Screening","day":"Day -14 to -1"}],
  "procedures":[{"name":"Informed consent","category":"consent"}],
  "entries":[{"procedure":"Informed consent","visit":"Screening","required":true,"footnoteRef":null}],
  "footnotes":[{"number":"1","text":"Only first visit each cycle"}]
}
Rules:
- Preserve visit and procedure names exactly when possible.
- If uncertain, still include best effort but keep structure valid.
- required must be boolean.
- footnoteRef can be string or null.`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract structured SOA JSON from this protocol content:\n\n${sourceText}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "structured_schedule",
        strict: true,
        schema: {
          type: "object",
          properties: {
            visits: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  day: { type: ["string", "null"] },
                },
                required: ["name", "day"],
                additionalProperties: false,
              },
            },
            procedures: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  category: { type: ["string", "null"] },
                },
                required: ["name", "category"],
                additionalProperties: false,
              },
            },
            entries: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  procedure: { type: "string" },
                  visit: { type: "string" },
                  required: { type: "boolean" },
                  footnoteRef: { type: ["string", "null"] },
                },
                required: ["procedure", "visit", "required", "footnoteRef"],
                additionalProperties: false,
              },
            },
            footnotes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  number: { type: "string" },
                  text: { type: "string" },
                },
                required: ["number", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["visits", "procedures", "entries", "footnotes"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") return null;
  const parsed = JSON.parse(content) as Omit<StructuredSchedule, "sourcePages">;
  return {
    ...parsed,
    sourcePages,
  };
}

export function buildProtocolChunks(documentText: string): ParsedProtocolChunk[] {
  const lines = documentText.split("\n");
  const sections: SectionAccumulator[] = [];
  let current: SectionAccumulator = {
    title: "Synopsis",
    sectionType: "synopsis",
    lines: [],
    pageStart: null,
    pageEnd: null,
  };
  let lastSeenPage: number | null = null;

  const flushCurrent = () => {
    const merged = normalizeWhitespace(current.lines.join("\n"));
    if (!merged) return;
    sections.push({
      ...current,
      lines: [merged],
    });
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;

    const page = parsePageMarker(line);
    if (page !== null) {
      lastSeenPage = page;
      if (current.pageStart === null) current.pageStart = page;
      current.pageEnd = page;
      continue;
    }

    if (isLikelyHeading(line)) {
      flushCurrent();
      const sectionType = classifySectionType(line);
      current = {
        title: line,
        sectionType,
        lines: [],
        pageStart: lastSeenPage,
        pageEnd: lastSeenPage,
      };
      continue;
    }

    current.lines.push(line);
  }

  flushCurrent();

  if (sections.length === 0) {
    const fallbackText = normalizeWhitespace(documentText);
    if (!fallbackText) return [];
    const hash = createHash("sha256").update(fallbackText).digest("hex");
    return [
      {
        chunkIndex: 0,
        sectionType: "general",
        sectionTitle: "Document Content",
        pageStart: null,
        pageEnd: null,
        tokenEstimate: estimateTokens(fallbackText),
        contentHash: hash,
        chunkText: fallbackText,
        metadata: { fallback: true },
      },
    ];
  }

  const output: ParsedProtocolChunk[] = [];
  let index = 0;
  for (const section of sections) {
    const sectionChunks = splitSectionIntoChunks(section);
    for (const sectionChunk of sectionChunks) {
      const chunkType = detectChunkType(section, sectionChunk);
      const contextualChunk = `${sectionContextPrefix(section)}\n\n${sectionChunk}`;
      const contentHash = createHash("sha256").update(sectionChunk).digest("hex");
      output.push({
        chunkIndex: index,
        sectionType: section.sectionType,
        sectionTitle: section.title || null,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
        tokenEstimate: estimateTokens(contextualChunk),
        contentHash,
        chunkText: contextualChunk,
        metadata: {
          sectionType: section.sectionType,
          sectionTitle: section.title,
          chunkType,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          source: "protocol-parser-v1",
        },
      });
      index += 1;
    }
  }

  return output;
}

export async function ingestProtocolContextChunks(options: {
  protocolId: number;
  forceRefresh?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [protocol] = await db
    .select()
    .from(protocols)
    .where(eq(protocols.id, options.protocolId))
    .limit(1);
  if (!protocol) throw new Error("Protocol not found");

  const existingChunkRows = await db
    .select({ id: protocolChunks.id })
    .from(protocolChunks)
    .where(eq(protocolChunks.protocolId, options.protocolId))
    .limit(1);
  if (existingChunkRows.length > 0 && !options.forceRefresh) {
    return {
      protocol,
      created: 0,
      reused: true,
      pageCount: null,
      wordCount: null,
      hasStructuredSchedule: null,
      embeddingCount: null,
    };
  }

  const pages: PdfPageText[] = await extractPdfPages(protocol.fileUrl);
  const mergedText = pages
    .map((page) => `Page ${page.pageNumber}\n${page.text}`)
    .join("\n\n");
  const normalized = normalizeWhitespace(mergedText);
  const totalWords = normalized.split(/\s+/).filter(Boolean).length;
  console.log(
    `[protocolContext] Parsed protocol ${protocol.id} (${protocol.filename}) pages=${pages.length} words=${totalWords}`
  );
  const documentHash = createHash("sha256").update(normalized).digest("hex");
  const parsedChunks = buildProtocolChunks(normalized);
  const structuredSchedule = await extractStructuredScheduleFromChunks(parsedChunks).catch((error) => {
    console.warn("[protocolContext] Failed to extract structured schedule", error);
    return null;
  });

  if (structuredSchedule) {
    const summaryText = scheduleStructuredText(structuredSchedule);
    parsedChunks.push({
      chunkIndex: parsedChunks.length,
      sectionType: "schedule",
      sectionTitle: "Schedule of Activities (structured)",
      pageStart: structuredSchedule.sourcePages[0] ?? null,
      pageEnd:
        structuredSchedule.sourcePages.length > 0
          ? structuredSchedule.sourcePages[structuredSchedule.sourcePages.length - 1]
          : null,
      tokenEstimate: estimateTokens(summaryText),
      contentHash: createHash("sha256").update(summaryText).digest("hex"),
      chunkText: summaryText,
      metadata: {
        sectionType: "schedule",
        sectionTitle: "Schedule of Activities (structured)",
        chunkType: "table",
        source: "soa-extractor-v1",
        structuredSchedule,
      },
    });
  }

  let chunkEmbeddings: number[][] = [];
  try {
    const embeddingInputs = parsedChunks.map((chunk) => chunk.chunkText.slice(0, 6000));
    chunkEmbeddings = await invokeEmbeddings(embeddingInputs, "text-embedding-3-small");
  } catch (error) {
    console.warn("[protocolContext] Failed to generate chunk embeddings", error);
  }

  await db.delete(protocolChunks).where(eq(protocolChunks.protocolId, options.protocolId));

  if (parsedChunks.length > 0) {
    await db.insert(protocolChunks).values(
      parsedChunks.map((chunk) => {
        const embedding = chunkEmbeddings[chunk.chunkIndex];
        return {
          protocolId: options.protocolId,
          trialId: protocol.trialId,
          chunkIndex: chunk.chunkIndex,
          sectionType: chunk.sectionType,
          sectionTitle: chunk.sectionTitle,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          tokenEstimate: chunk.tokenEstimate,
          contentHash: chunk.contentHash,
          chunkText: chunk.chunkText,
          metadata: {
            ...chunk.metadata,
            embedding: Array.isArray(embedding) && embedding.length > 0 ? embedding : undefined,
            documentHash,
            filename: protocol.filename,
            totalPages: pages.length,
            totalWords,
          },
        };
      })
    );
  }

  return {
    protocol,
    created: parsedChunks.length,
    reused: false,
    pageCount: pages.length,
    wordCount: totalWords,
    hasStructuredSchedule: Boolean(structuredSchedule),
    embeddingCount: chunkEmbeddings.filter((vector) => Array.isArray(vector) && vector.length > 0).length,
  };
}

function tokenizeQuery(query: string) {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 2)
    )
  );
}

type QueryFocus =
  | "inclusion"
  | "exclusion"
  | "eligibility"
  | "schedule"
  | "endpoints"
  | "procedures"
  | "general";

function detectQueryFocus(query: string): QueryFocus {
  const normalized = normalizeText(query);
  if (/\binclusion\b/.test(normalized) && /\bcriteria?\b/.test(normalized)) return "inclusion";
  if (/\bexclusion\b/.test(normalized) && /\bcriteria?\b/.test(normalized)) return "exclusion";
  if (/\beligibility\b/.test(normalized) || /\bcriteria?\b/.test(normalized)) return "eligibility";
  if (/\bschedule\b|\btable\b|\bmatrix\b|\bvisit\b|\bassessments?\b/.test(normalized)) return "schedule";
  if (/\bendpoint\b|\bendpoints\b|\bobjective\b|\bobjectives\b/.test(normalized)) return "endpoints";
  if (/\bprocedure\b|\bprocedures\b|\bdosing\b|\bdrug administration\b|\blab\b/.test(normalized)) {
    return "procedures";
  }
  return "general";
}

export async function getStructuredScheduleOfActivities(protocolId: number): Promise<StructuredSchedule | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const chunkRows = await db
    .select({ metadata: protocolChunks.metadata, sectionType: protocolChunks.sectionType })
    .from(protocolChunks)
    .where(eq(protocolChunks.protocolId, protocolId));

  for (const row of chunkRows) {
    if (row.sectionType !== "schedule") continue;
    const metadata = row.metadata as Record<string, unknown> | null;
    const structured = metadata?.structuredSchedule;
    if (structured && typeof structured === "object") {
      return structured as StructuredSchedule;
    }
  }

  return null;
}

function scoreChunk(query: string, row: typeof protocolChunks.$inferSelect) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedChunk = row.chunkText.toLowerCase();
  const normalizedTitle = (row.sectionTitle || "").toLowerCase();
  const normalizedSectionType = (row.sectionType || "").toLowerCase();
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  const chunkType = String(metadata?.chunkType || "").toLowerCase();
  const focus = detectQueryFocus(query);
  const terms = tokenizeQuery(query);

  let score = 0;
  for (const term of terms) {
    const occurrences = normalizedChunk.split(term).length - 1;
    score += Math.min(occurrences, 6);
    if (normalizedTitle.includes(term)) {
      score += 2;
    }
    if (normalizedSectionType.includes(term)) {
      score += 1.5;
    }
  }

  if (focus === "inclusion") {
    if (normalizedSectionType === "eligibility") score += 16;
    if (normalizedTitle.includes("inclusion")) score += 18;
    if (chunkType.includes("inclusion")) score += 18;
    if (chunkType.includes("eligibility")) score += 10;
    if (normalizedTitle.includes("exclusion")) score -= 6;
    if (normalizedChunk.includes("amendment")) score -= 8;
  } else if (focus === "exclusion") {
    if (normalizedSectionType === "eligibility") score += 16;
    if (normalizedTitle.includes("exclusion")) score += 18;
    if (chunkType.includes("exclusion")) score += 18;
    if (chunkType.includes("eligibility")) score += 10;
    if (normalizedTitle.includes("inclusion")) score -= 6;
    if (normalizedChunk.includes("amendment")) score -= 8;
  } else if (focus === "eligibility") {
    if (normalizedSectionType === "eligibility") score += 14;
    if (chunkType.includes("criterion") || chunkType.includes("eligibility")) score += 12;
    if (normalizedChunk.includes("amendment")) score -= 6;
  } else if (focus === "schedule") {
    if (normalizedSectionType === "schedule") score += 16;
    if (normalizedTitle.includes("schedule of activities") || normalizedTitle.includes("schedule of assessments")) {
      score += 18;
    }
    if (chunkType.includes("table")) score += 12;
  } else if (focus === "endpoints") {
    if (normalizedSectionType === "endpoints" || normalizedSectionType === "objectives") score += 14;
    if (normalizedTitle.includes("endpoint") || normalizedTitle.includes("objective")) score += 12;
  } else if (focus === "procedures") {
    if (
      normalizedSectionType === "visits" ||
      normalizedSectionType === "dosing" ||
      normalizedSectionType === "laboratory"
    ) {
      score += 10;
    }
    if (chunkType.includes("procedure") || chunkType.includes("visit")) score += 10;
  }

  if (normalizedTitle.includes("amendment") || normalizedTitle.includes("revision history")) {
    score -= 4;
  }

  if (normalizedChunk.includes(normalizedQuery)) score += 6;
  return score;
}

export async function getProtocolContextChunks(options: {
  protocolId: number;
  query?: string;
  sectionTypes?: string[];
  limit?: number;
  comprehensive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { protocolId, query, sectionTypes, limit = 6, comprehensive = false } = options;
  const [protocol] = await db
    .select({
      id: protocols.id,
      filename: protocols.filename,
    })
    .from(protocols)
    .where(eq(protocols.id, protocolId))
    .limit(1);
  if (!protocol) throw new Error("Protocol not found");

  const filters = [eq(protocolChunks.protocolId, protocolId)];
  if (sectionTypes && sectionTypes.length > 0) {
    filters.push(inArray(protocolChunks.sectionType, sectionTypes));
  }

  const chunkRows = await db
    .select()
    .from(protocolChunks)
    .where(and(...filters));

  let queryEmbedding: number[] | null = null;
  if (query && query.trim().length > 0) {
    try {
      const vectors = await invokeEmbeddings([query], "text-embedding-3-small");
      queryEmbedding = vectors[0] ?? null;
    } catch (error) {
      console.warn("[protocolContext] Failed to embed context query", error);
      queryEmbedding = null;
    }
  }

  const scoredItems = query
    ? chunkRows.map((row) => {
        const lexicalScore = scoreChunk(query, row);
        const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
        const chunkEmbedding = toEmbeddingVector(metadata?.embedding);
        const semanticScore =
          queryEmbedding && chunkEmbedding
            ? Math.max(0, cosineSimilarity(queryEmbedding, chunkEmbedding))
            : 0;
        return {
          row,
          score: lexicalScore + semanticScore * 12,
          lexicalScore,
          semanticScore,
        };
      })
    : chunkRows.map((row) => ({ row, score: 0, lexicalScore: 0, semanticScore: 0 }));

  const byScoreDesc = [...scoredItems].sort(
    (a, b) => b.score - a.score || a.row.chunkIndex - b.row.chunkIndex
  );

  const queryNeedsCoverage =
    !!query &&
    /(all|list|criteria|criterion|requirements?|what are|what is|which|table|schedule|matrix|rows?|columns?|assessments?|endpoints?|procedures?|eligibility|inclusion|exclusion|visit window|footnote|cohort|arm\b)/i.test(
      query
    );

  let selected = query
    ? byScoreDesc.filter((item) => item.score > 0)
    : [...scoredItems].sort((a, b) => a.row.chunkIndex - b.row.chunkIndex);

  if (query && comprehensive && chunkRows.length > 0) {
    const seeded = (selected.length > 0 ? selected : byScoreDesc).slice(0, Math.max(limit, 8));
    const selectedIds = new Set<number>(seeded.map((item) => item.row.id));
    const normalizedSectionKeys = new Set(
      seeded.map((item) => normalizeText(item.row.sectionTitle || item.row.sectionType))
    );
    const anchorChunks = seeded.map((item) => item.row.chunkIndex);
    const anchorPages = seeded
      .map((item) => item.row.pageStart)
      .filter((page): page is number => Number.isFinite(page));
    const maxDistance = queryNeedsCoverage ? 4 : 1;

    for (const item of scoredItems) {
      if (selectedIds.has(item.row.id)) continue;
      const sectionKey = normalizeText(item.row.sectionTitle || item.row.sectionType);
      const isSameSection = normalizedSectionKeys.has(sectionKey);
      const isNearby = anchorChunks.some((anchor) => Math.abs(anchor - item.row.chunkIndex) <= maxDistance);
      const pageStart = item.row.pageStart;
      const isNearbyPage =
        Number.isFinite(pageStart) &&
        anchorPages.some((anchorPage) => Math.abs(anchorPage - Number(pageStart)) <= 1);
      const metadata = (item.row.metadata as Record<string, unknown> | null) ?? null;
      const chunkType = String(metadata?.chunkType || "").toLowerCase();
      const tableLike = chunkType.includes("table") || item.row.sectionType === "schedule";
      const listLike =
        chunkType.includes("criterion") ||
        chunkType.includes("footnote") ||
        chunkType.includes("visit") ||
        chunkType.includes("procedure");
      if (isSameSection || isNearby || isNearbyPage || (queryNeedsCoverage && (tableLike || listLike))) {
        selectedIds.add(item.row.id);
      }
    }

    const cap = Math.min(42, Math.max(limit * 3, queryNeedsCoverage ? 24 : 18));
    selected = scoredItems
      .filter((item) => selectedIds.has(item.row.id))
      .sort((a, b) => {
        const ap = a.row.pageStart ?? Number.MAX_SAFE_INTEGER;
        const bp = b.row.pageStart ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return a.row.chunkIndex - b.row.chunkIndex;
      })
      .slice(0, cap);
  }

  return selected
    .slice(0, Math.max(1, comprehensive ? selected.length : limit))
    .map(({ row, score, lexicalScore, semanticScore }): ProtocolContextChunk => {
    const page = row.pageStart
      ? row.pageEnd && row.pageEnd !== row.pageStart
        ? `pp. ${row.pageStart}-${row.pageEnd}`
        : `p. ${row.pageStart}`
      : "page n/a";
    return {
      id: row.id,
      protocolId: row.protocolId,
      trialId: row.trialId,
      sectionType: row.sectionType,
      sectionTitle: row.sectionTitle,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      chunkText: row.chunkText,
      tokenEstimate: row.tokenEstimate,
      score,
      citation: {
        filename: protocol.filename,
        sectionTitle: row.sectionTitle,
        page,
      },
      retrievalScores: {
        lexical: lexicalScore,
        semantic: semanticScore,
      },
    };
  });
}
