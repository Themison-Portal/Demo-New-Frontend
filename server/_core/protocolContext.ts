import { createHash } from "crypto";
import { execFile as execFileCb } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { promisify } from "util";
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

type PageLine = {
  page: number;
  line: string;
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

type StructuredScheduleTableRow = {
  category: string | null;
  procedure: string;
  cells: string[];
};

type StructuredScheduleTableFootnote = {
  marker: string;
  text: string;
};

type StructuredScheduleTable = {
  table_title: string;
  section: string;
  column_headers: string[][];
  rows: StructuredScheduleTableRow[];
  footnotes: StructuredScheduleTableFootnote[];
  page_numbers: number[];
};

type ScheduleVariantSource = "text_full" | "text_page" | "vision";

type ScheduleVariantCandidate = {
  source: ScheduleVariantSource;
  schedule: Omit<StructuredSchedule, "sourcePages">;
};

export type StructuredSchedule = {
  visits: ScheduleVisit[];
  procedures: ScheduleProcedure[];
  entries: ScheduleEntry[];
  footnotes: ScheduleFootnote[];
  table?: StructuredScheduleTable | null;
  sourcePages: number[];
};

type StructuredCriteriaEntry = {
  index: string;
  text: string;
};

export type StructuredCriteria = {
  inclusion: StructuredCriteriaEntry[];
  exclusion: StructuredCriteriaEntry[];
  sourcePages: number[];
  inclusionSourcePages?: number[];
  exclusionSourcePages?: number[];
  inclusionVerbatim?: string;
  exclusionVerbatim?: string;
  source: "deterministic" | "llm";
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
  metadata?: Record<string, unknown> | null;
  retrievalScores?: {
    lexical: number;
    semantic: number;
  };
};

type ProtocolChunkRow = typeof protocolChunks.$inferSelect;
const PROTOCOL_CONTEXT_PARSER_VERSION = "protocol-parser-v25";
const execFile = promisify(execFileCb);

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[ ]{3,}/g, "  ")
    .replace(/\r/g, "")
    .trim();
}

function preserveTableWhitespace(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/\t/g, "    ")
    .split("\n")
    .map((line) => line.replace(/[ ]+$/g, ""))
    .join("\n")
    .trim();
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLite(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
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
  return /^(synopsis|study synopsis|objectives?|endpoints?|study design|schedule of assessments?|schedule of activities|schedule of events|inclusion criteria|exclusion criteria|eligibility|screening|baseline|visit\s+\d+|follow[\s-]?up|end[\s-]?of[\s-]?study|safety|adverse events?|laboratory|lab|dosing|drug administration|statistical)/i.test(
    line
  );
}

function isLikelyHeading(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized || normalized.length < 3 || normalized.length > 130) return false;

  if (headingKeywordMatch(normalized)) return true;
  // Ignore list-style rows like "3. Foo" or "a. Bar" to avoid splitting criteria/tables.
  if (/^\d+[\).]\s+[A-Za-z]/.test(normalized) || /^[a-z][\).]\s+[A-Za-z]/i.test(normalized)) {
    return false;
  }
  // Section headings generally use hierarchical numbering like "10.1", "6.2.3", etc.
  if (/^\d+\.\d+(\.\d+){0,3}\s+[A-Za-z]/.test(normalized)) return true;

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

function isScheduleHeadingText(value: string) {
  const normalized = normalizeText(value);
  return (
    normalized.includes("schedule of events") ||
    normalized.includes("schedule of activities") ||
    normalized.includes("schedule of assessments") ||
    /\bsoe\b/.test(normalized) ||
    /\bsoa\b/.test(normalized)
  );
}

function isAmendmentLikeText(title: string, body: string) {
  const hay = normalizeText(`${title} ${body}`);
  if (!hay) return false;
  return (
    /\bamendment\b|\brevision history\b|\bversion history\b|\bsummary of changes\b|\bchange log\b|\bchanges from\b|\bchanges to\b/.test(
      hay
    ) ||
    /\badded\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\bremoved\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\bmodified\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\bupdated\b.*\b(criteria|criterion|section|visit|dose|schedule)\b/.test(hay) ||
    /\btrack(ed)?\s+changes?\b/.test(hay)
  );
}

function isAmendmentLikeParsedChunk(chunk: ParsedProtocolChunk) {
  return isAmendmentLikeText(chunk.sectionTitle || "", chunk.chunkText.slice(0, 2200));
}

function isAmendmentLikeRow(row: ProtocolChunkRow) {
  return isAmendmentLikeText(row.sectionTitle || "", row.chunkText.slice(0, 2200));
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
  if (isScheduleHeadingText(section.title) || isScheduleHeadingText(chunkText)) {
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

function scheduleVisitLabel(visit: ScheduleVisit) {
  return `${visit.name}${visit.day ? ` (${visit.day})` : ""}`.trim();
}

function formatPagesLabel(pages: number[]) {
  const sorted = Array.from(new Set((pages || []).filter((page) => Number.isFinite(page)))).sort((a, b) => a - b);
  if (sorted.length === 0) return "page n/a";
  if (sorted.length === 1) return `p. ${sorted[0]}`;
  return `pp. ${sorted[0]}-${sorted[sorted.length - 1]}`;
}

function normalizeFootnoteMarker(marker: string | null | undefined) {
  const raw = normalizeWhitespace(String(marker || ""));
  if (!raw) return "";
  return raw.replace(/^\^+/, "").trim();
}

function buildScheduleFootnoteLookup(schedule: StructuredSchedule) {
  const lookup = new Map<string, string>();
  for (const note of schedule.footnotes) {
    const marker = normalizeFootnoteMarker(note.number);
    const text = normalizeWhitespace(note.text);
    if (!marker || !text) continue;
    lookup.set(normalizeLite(marker), text);
  }
  return lookup;
}

function buildScheduleProcedureCategoryLookup(schedule: StructuredSchedule) {
  const lookup = new Map<string, string | null>();
  for (const procedure of schedule.procedures) {
    const key = normalizeProcedureKey(procedure.name);
    if (!key) continue;
    lookup.set(key, procedure.category ? normalizeWhitespace(procedure.category) : null);
  }
  return lookup;
}

function formatSourceSummary(schedule: StructuredSchedule) {
  const title = normalizeWhitespace(String(schedule.table?.table_title || "Schedule of Activities"));
  const section = normalizeWhitespace(String(schedule.table?.section || ""));
  const pages = formatPagesLabel(schedule.sourcePages);
  if (section) return `${title} | ${section} | ${pages}`;
  return `${title} | ${pages}`;
}

function buildStructuredScheduleVisitSummaries(schedule: StructuredSchedule) {
  const visitOrder = new Map<string, number>();
  for (let i = 0; i < schedule.visits.length; i += 1) {
    visitOrder.set(normalizeLite(scheduleVisitLabel(schedule.visits[i])), i);
  }
  const procedureCategoryLookup = buildScheduleProcedureCategoryLookup(schedule);
  const footnoteLookup = buildScheduleFootnoteLookup(schedule);
  const requiredEntries = schedule.entries.filter((entry) => entry.required);
  const sourceSummary = formatSourceSummary(schedule);

  return schedule.visits
    .map((visit) => {
      const label = scheduleVisitLabel(visit);
      const labelKey = normalizeLite(label);
      const matched = requiredEntries.filter((entry) => {
        const entryVisitKey = normalizeLite(entry.visit);
        if (entryVisitKey === labelKey) return true;
        if (entryVisitKey && labelKey && (entryVisitKey.includes(labelKey) || labelKey.includes(entryVisitKey))) {
          return true;
        }
        return false;
      });
      if (matched.length === 0) return null;

      const procedureMap = new Map<
        string,
        { procedure: string; category: string | null; footnoteMarkers: Set<string> }
      >();
      for (const entry of matched) {
        const procedure = normalizeWhitespace(entry.procedure);
        const key = normalizeProcedureKey(procedure);
        if (!key) continue;
        if (!procedureMap.has(key)) {
          procedureMap.set(key, {
            procedure,
            category: procedureCategoryLookup.get(key) ?? null,
            footnoteMarkers: new Set<string>(),
          });
        }
        const marker = normalizeFootnoteMarker(entry.footnoteRef);
        if (marker) procedureMap.get(key)!.footnoteMarkers.add(marker);
      }

      const procedures = Array.from(procedureMap.values()).sort((a, b) =>
        normalizeProcedureKey(a.procedure).localeCompare(normalizeProcedureKey(b.procedure))
      );
      const applicableFootnotes = new Set<string>();
      for (const item of procedures) {
        for (const marker of Array.from(item.footnoteMarkers.values())) {
          const markerKey = normalizeLite(marker);
          const footnoteText = footnoteLookup.get(markerKey);
          if (footnoteText) applicableFootnotes.add(`${marker}: ${footnoteText}`);
        }
      }

      const lines: string[] = [
        "[Structured Schedule Visit Summary]",
        `Visit: ${label}`,
        `Required procedures (${procedures.length}):`,
        ...procedures.map((item, index) => {
          const markers = Array.from(item.footnoteMarkers.values());
          const markerSuffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
          const categorySuffix = item.category ? ` (${item.category})` : "";
          return `${index + 1}. ${item.procedure}${categorySuffix}${markerSuffix}`;
        }),
      ];
      if (applicableFootnotes.size > 0) {
        lines.push("");
        lines.push("Footnotes:");
        for (const note of Array.from(applicableFootnotes.values()).sort((a, b) => a.localeCompare(b))) {
          lines.push(`- ${note}`);
        }
      }
      lines.push("");
      lines.push(`Source: ${sourceSummary}`);

      return {
        visit,
        visitLabel: label,
        visitOrder: visitOrder.get(labelKey) ?? Number.MAX_SAFE_INTEGER,
        text: lines.join("\n"),
        procedureCount: procedures.length,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function buildStructuredScheduleProcedureSummaries(schedule: StructuredSchedule) {
  const visitLookup = new Map<string, { label: string; order: number }>();
  for (let i = 0; i < schedule.visits.length; i += 1) {
    const label = scheduleVisitLabel(schedule.visits[i]);
    visitLookup.set(normalizeLite(label), { label, order: i });
  }
  const procedureCategoryLookup = buildScheduleProcedureCategoryLookup(schedule);
  const footnoteLookup = buildScheduleFootnoteLookup(schedule);
  const sourceSummary = formatSourceSummary(schedule);
  const requiredEntries = schedule.entries.filter((entry) => entry.required);

  const procedureMap = new Map<
    string,
    { name: string; category: string | null; visits: Array<{ label: string; order: number; markers: Set<string> }> }
  >();

  for (const entry of requiredEntries) {
    const procedureName = normalizeWhitespace(entry.procedure);
    const procedureKey = normalizeProcedureKey(procedureName);
    if (!procedureKey) continue;
    if (!procedureMap.has(procedureKey)) {
      procedureMap.set(procedureKey, {
        name: procedureName,
        category: procedureCategoryLookup.get(procedureKey) ?? null,
        visits: [],
      });
    }
    const procedure = procedureMap.get(procedureKey)!;
    const entryVisitKey = normalizeLite(entry.visit);
    const fallbackOrder = schedule.visits.length + procedure.visits.length + 1;
    const visit = visitLookup.get(entryVisitKey) || { label: normalizeWhitespace(entry.visit), order: fallbackOrder };
    const existing = procedure.visits.find((item) => normalizeLite(item.label) === normalizeLite(visit.label));
    const marker = normalizeFootnoteMarker(entry.footnoteRef);
    if (existing) {
      if (marker) existing.markers.add(marker);
      continue;
    }
    procedure.visits.push({
      label: visit.label,
      order: visit.order,
      markers: marker ? new Set([marker]) : new Set<string>(),
    });
  }

  return Array.from(procedureMap.values())
    .map((procedure) => {
      const visits = [...procedure.visits].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
      if (visits.length === 0) return null;
      const applicableFootnotes = new Set<string>();
      for (const visit of visits) {
        for (const marker of Array.from(visit.markers.values())) {
          const text = footnoteLookup.get(normalizeLite(marker));
          if (text) applicableFootnotes.add(`${marker}: ${text}`);
        }
      }
      const lines: string[] = [
        "[Structured Schedule Procedure Summary]",
        `Procedure: ${procedure.name}`,
        ...(procedure.category ? [`Category: ${procedure.category}`] : []),
        `Required visits (${visits.length}):`,
        ...visits.map((visit, index) => {
          const markers = Array.from(visit.markers.values());
          const markerSuffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
          return `${index + 1}. ${visit.label}${markerSuffix}`;
        }),
      ];
      if (applicableFootnotes.size > 0) {
        lines.push("");
        lines.push("Footnotes:");
        for (const note of Array.from(applicableFootnotes.values()).sort((a, b) => a.localeCompare(b))) {
          lines.push(`- ${note}`);
        }
      }
      lines.push("");
      lines.push(`Source: ${sourceSummary}`);
      return {
        procedureName: procedure.name,
        procedureCategory: procedure.category,
        visitCount: visits.length,
        text: lines.join("\n"),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => normalizeProcedureKey(a.procedureName).localeCompare(normalizeProcedureKey(b.procedureName)));
}

function criteriaStructuredText(criteria: StructuredCriteria) {
  const inclusion = criteria.inclusion.map((entry) => `${entry.index} ${entry.text}`);
  const exclusion = criteria.exclusion.map((entry) => `${entry.index} ${entry.text}`);
  return [
    "Structured Eligibility Criteria",
    "",
    "Inclusion Criteria:",
    ...(inclusion.length > 0 ? inclusion.map((line) => `- ${line}`) : ["- (none detected)"]),
    "",
    "Exclusion Criteria:",
    ...(exclusion.length > 0 ? exclusion.map((line) => `- ${line}`) : ["- (none detected)"]),
  ].join("\n");
}

function unwrapContextChunkText(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";
  if (normalized.startsWith("Section:")) {
    const split = normalized.split(/\n\s*\n/);
    if (split.length > 1) {
      return split.slice(1).join("\n\n").trim();
    }
  }
  return normalized;
}

function extractCriteriaSourcePages(chunks: ParsedProtocolChunk[]) {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    if (isAmendmentLikeParsedChunk(chunk)) continue;
    const title = normalizeText(chunk.sectionTitle ?? "");
    const body = normalizeText(chunk.chunkText);
    const looksLikeCriteria =
      chunk.sectionType === "eligibility" ||
      title.includes("inclusion criteria") ||
      title.includes("exclusion criteria") ||
      body.includes("inclusion criteria") ||
      body.includes("exclusion criteria");
    if (!looksLikeCriteria) continue;
    if (chunk.pageStart) pages.add(chunk.pageStart);
    if (chunk.pageEnd) pages.add(chunk.pageEnd);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function collectCriteriaLines(chunks: ParsedProtocolChunk[]) {
  return [...chunks]
    .sort((a, b) => {
      const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.chunkIndex - b.chunkIndex;
    })
    .flatMap((chunk) => unwrapContextChunkText(chunk.chunkText).split(/\n+/))
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function buildPageLines(pages: PdfPageText[]) {
  const lines: PageLine[] = [];
  for (const page of pages) {
    const pageLines = page.text
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean);
    for (const line of pageLines) {
      lines.push({ page: page.pageNumber, line });
    }
  }
  return lines;
}

function parseLooseNumberedCriteria(lines: string[]) {
  const entries: StructuredCriteriaEntry[] = [];
  let current: StructuredCriteriaEntry | null = null;
  const pushCurrent = () => {
    if (!current) return;
    current.text = normalizeWhitespace(current.text);
    if (current.text.length > 0) entries.push(current);
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line) continue;
    if (/^section:\s/i.test(line)) continue;
    if (/^page\s+\d+/i.test(line)) continue;
    if (isAmendmentLikeText("", line)) continue;

    const numbered = line.match(/^(\d{1,2})[\).\s-]*(.*)$/);
    if (numbered) {
      const num = Number.parseInt(numbered[1], 10);
      if (!Number.isFinite(num) || num > 30) continue;
      pushCurrent();
      current = { index: `${numbered[1]}.`, text: numbered[2]?.trim() || "" };
      continue;
    }

    const alpha = line.match(/^([a-z])[\).\s-]*(.*)$/i);
    if (alpha) {
      const alphaText = alpha[2]?.trim() || "";
      if (!current) {
        current = { index: `${alpha[1]})`, text: alphaText };
      } else {
        current.text += ` (${alpha[1].toLowerCase()})${alphaText ? ` ${alphaText}` : ""}`;
      }
      continue;
    }

    if (/^[-•]\s+/.test(line)) {
      const bullet = line.replace(/^[-•]\s+/, "").trim();
      if (!bullet) continue;
      if (!current) {
        current = { index: `${entries.length + 1}.`, text: bullet };
      } else {
        current.text += ` ${bullet}`;
      }
      continue;
    }

    if (current && !isLikelyHeading(line)) {
      current.text += ` ${line}`;
    }
  }
  pushCurrent();
  return entries;
}

type FocusedCriteriaExtraction = {
  entries: StructuredCriteriaEntry[];
  usedChunks: ParsedProtocolChunk[];
};

type FocusedPageCriteriaExtraction = {
  entries: StructuredCriteriaEntry[];
  sourcePages: number[];
  maxTopNumber: number;
  verbatimText: string;
};

function parseTopLevelNumber(value: string) {
  const match = normalizeWhitespace(value).match(/^(\d{1,2})\s*[\).\-]?\s*(.*)$/);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  if (!Number.isFinite(num) || num > 30) return null;
  return {
    num,
    text: (match[2] || "").trim(),
  };
}

function isLikelyTableOfContentsLine(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return false;
  if (/\.{3,}\s*\d{1,4}\s*$/i.test(normalized)) return true;
  if (/^\s*(list of tables|list of figures|table of contents)\b/i.test(normalized)) return true;
  if (/^\s*--\s*\d+\s*(of|\/)\s*\d+\s*--\s*$/i.test(normalized)) return true;
  if (/^\d+(\.\d+){0,3}\s+.+\s+\d{1,4}$/.test(normalized) && /[A-Z]/.test(normalized)) return true;
  return false;
}

function isCriteriaHeadingLine(line: string, focus: "inclusion" | "exclusion") {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return false;
  if (isLikelyTableOfContentsLine(normalized)) return false;
  const lower = normalized.toLowerCase();
  const needle = focus === "inclusion" ? /\binclusion criteria\b/i : /\bexclusion criteria\b/i;
  if (!needle.test(normalized)) return false;
  if (isAmendmentLikeText("", normalized)) return false;
  // Accept only heading-shaped lines; reject inline references like "inclusion criteria 8".
  const strictHeading =
    /^(?:\d+(?:\.\d+){0,2}\s+)?(?:study population\s+)?(?:inclusion|exclusion)\s+criteria\s*(?:\([^)]+\))?\s*:?\s*$/i;
  if (strictHeading.test(normalized)) return true;
  // Common OCR variant where section number and heading are split by dots/spaces.
  const relaxedHeading =
    /^(?:\d+(?:\.\d+){0,2}[\s.\-]*)?(?:study population[\s.\-]*)?(?:inclusion|exclusion)\s+criteria\s*:?\s*$/i;
  if (relaxedHeading.test(normalized)) return true;
  // If there are too many tokens or trailing words after "criteria", treat as body text.
  const tailAfterCriteria = lower.split("criteria")[1]?.trim() ?? "";
  if (tailAfterCriteria.length > 0) return false;
  return false;
}

function isProtocolBoilerplateLine(line: string) {
  const normalized = normalizeWhitespace(line);
  if (!normalized) return true;
  if (isLikelyTableOfContentsLine(normalized)) return true;
  if (/^confidential$/i.test(normalized)) return true;
  if (/^page\s+\d+\s*(of|\/)\s*\d+$/i.test(normalized)) return true;
  if (/^protocol version\b/i.test(normalized)) return true;
  if (/^amendment version\b/i.test(normalized)) return true;
  if (/^clinical protocol\b/i.test(normalized)) return true;
  if (/^study population$/i.test(normalized)) return true;
  return false;
}

function normalizeCriteriaVerbatimLines(lines: string[], focus: "inclusion" | "exclusion") {
  const cleaned = lines
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0)
    .filter((line) => !isProtocolBoilerplateLine(line));

  if (cleaned.length === 0) return "";

  const headingNeedle = focus === "inclusion" ? /\binclusion criteria\b/i : /\bexclusion criteria\b/i;
  const headingIndex = cleaned.findIndex((line) => headingNeedle.test(line));
  const bodyLines = headingIndex >= 0 ? cleaned.slice(headingIndex) : cleaned;

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of bodyLines) {
    const key = normalizeText(line);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }
  return deduped.join("\n").trim();
}

function firstSequentialNumberedRun(entries: StructuredCriteriaEntry[]) {
  const run: StructuredCriteriaEntry[] = [];
  let started = false;
  let lastNum = 0;
  for (const entry of entries) {
    const numMatch = entry.index.match(/^(\d{1,2})\./);
    if (!numMatch) {
      if (started && run.length > 0) {
        run[run.length - 1] = {
          ...run[run.length - 1],
          text: `${run[run.length - 1].text} ${entry.text}`.trim(),
        };
      }
      continue;
    }
    const num = Number.parseInt(numMatch[1], 10);
    if (!Number.isFinite(num)) continue;
    if (!started) {
      started = true;
      lastNum = num;
      run.push(entry);
      continue;
    }
    if (num === lastNum) {
      run[run.length - 1] = {
        ...run[run.length - 1],
        text: `${run[run.length - 1].text} ${entry.text}`.trim(),
      };
      continue;
    }
    if (num > lastNum && num - lastNum <= 3) {
      lastNum = num;
      run.push(entry);
      continue;
    }
    if (num < lastNum && run.length >= 3) {
      break;
    }
    if (run.length < 3) {
      run.length = 0;
      run.push(entry);
      lastNum = num;
      started = true;
      continue;
    }
    break;
  }
  return run.length > 0 ? run : entries;
}

function findBestPageCriteriaAnchor(
  lines: PageLine[],
  focus: "inclusion" | "exclusion"
) {
  const headingNeedle = focus === "inclusion" ? /\binclusion criteria\b/ : /\bexclusion criteria\b/;
  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const hay = normalizeText(lines[i].line);
    if (headingNeedle.test(hay) && isCriteriaHeadingLine(lines[i].line, focus)) candidates.push(i);
  }
  if (candidates.length === 0) {
    for (let i = 0; i < lines.length; i += 1) {
      const hay = normalizeText(lines[i].line);
      if (headingNeedle.test(hay) && !isAmendmentLikeText("", lines[i].line)) candidates.push(i);
    }
  }
  if (candidates.length === 0) return -1;

  let bestIndex = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const index of candidates) {
    let score = 0;
    const local = lines.slice(Math.max(0, index - 10), Math.min(lines.length, index + 120));
    const localText = local.map((row) => row.line).join(" ");
    const tocLines = local.filter((row) => isLikelyTableOfContentsLine(row.line)).length;
    if (/\ball patients must meet\b|\bmust meet all of the following\b/i.test(localText)) score += 18;
    if (focus === "exclusion" && /\bmust not meet\b|\bnone of the following\b/i.test(localText)) score += 16;
    if (/\beligibility\b/i.test(localText)) score += 6;
    if (focus === "exclusion" && /\b(excluded|will be excluded|ineligible|not eligible)\b/i.test(localText)) score += 14;
    if (
      /\bsummary of changes\b|\brevision history\b|\bchange log\b|\btrack(ed)? changes?\b|\bamendment\s+history\b/i.test(
        localText
      )
    ) {
      score -= 70;
    }
    if (/\badded\b|\bmodified\b|\bremoved\b|\bcorrected\b|\bstreamlined\b|\bconsolidated\b/i.test(localText)) {
      score -= 40;
    }
    if (isAmendmentLikeText(lines[index].line, localText)) score -= 20;
    if (tocLines > 0) score -= tocLines * 10;

    let numbered = 0;
    let alpha = 0;
    for (const row of local) {
      if (/^(\d{1,2})[\).\s-]+/.test(row.line)) numbered += 1;
      else if (/^([a-z])[\).\s-]+/i.test(row.line)) alpha += 1;
    }
    score += Math.min(numbered, 16) * 2;
    score += Math.min(alpha, 12);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function extractFocusedCriteriaFromPageLines(
  allLines: PageLine[],
  focus: "inclusion" | "exclusion"
): FocusedPageCriteriaExtraction {
  if (allLines.length === 0) return { entries: [], sourcePages: [], maxTopNumber: 0, verbatimText: "" };
  const headingNeedle = focus === "inclusion" ? /\binclusion criteria\b/ : /\bexclusion criteria\b/;
  const stopNeedles =
    focus === "inclusion"
      ? [
          /\bendpoints?\b/,
          /\bstudy design\b/,
          /\bstudy procedures?\b/,
          /\bstatistical\b/,
        ]
      : [
          /\bendpoints?\b/,
          /\bstudy design\b/,
          /\bstudy procedures?\b/,
          /\bconcomitant\b/,
          /\bstatistical\b/,
        ];

  const anchor = findBestPageCriteriaAnchor(allLines, focus);
  if (anchor < 0) return { entries: [], sourcePages: [], maxTopNumber: 0, verbatimText: "" };

  const collected: PageLine[] = [];
  const startPage = allLines[anchor]?.page ?? null;
  let maxTopNumber = 0;
  for (let i = anchor; i < allLines.length; i += 1) {
    const row = allLines[i];
    if (isLikelyTableOfContentsLine(row.line)) continue;
    const normalized = normalizeText(row.line);
    if (i > anchor) {
      if (focus === "inclusion" && isCriteriaHeadingLine(row.line, "exclusion")) break;
      if (focus === "exclusion" && isCriteriaHeadingLine(row.line, "inclusion")) break;
    }
    if (i > anchor && stopNeedles.some((needle) => needle.test(normalized))) {
      // Some PDFs place stop-like headings before the tail of numbered criteria.
      // If we can still see higher-numbered rows ahead, continue collecting.
      const lookAhead = allLines.slice(i + 1, i + 80);
      const futureMax = lookAhead.reduce((max, line) => {
        const parsed = parseTopLevelNumber(line.line);
        if (!parsed) return max;
        return Math.max(max, parsed.num);
      }, 0);
      if (futureMax <= maxTopNumber) break;
    }
    if (startPage !== null && row.page - startPage > 8) break;
    if (isAmendmentLikeText("", row.line)) continue;
    const parsedNumber = parseTopLevelNumber(row.line);
    if (parsedNumber) {
      maxTopNumber = Math.max(maxTopNumber, parsedNumber.num);
    }
    collected.push(row);
  }

  const lineTexts = collected.map((row) => row.line);
  const tocLikeCount = lineTexts.filter((line) => isLikelyTableOfContentsLine(line)).length;
  if (lineTexts.length > 0 && tocLikeCount / lineTexts.length > 0.1) {
    return { entries: [], sourcePages: [], maxTopNumber: 0, verbatimText: "" };
  }
  if (!lineTexts.some((line) => headingNeedle.test(normalizeText(line)))) {
    lineTexts.unshift(focus === "inclusion" ? "Inclusion Criteria" : "Exclusion Criteria");
  }

  let entries = parseCriteriaEntries(lineTexts, headingNeedle, [], 0);
  if (entries.length === 0) entries = parseLooseNumberedCriteria(lineTexts);
  const verbatimText = normalizeCriteriaVerbatimLines(lineTexts, focus);
  if (entries.length === 0 && !verbatimText) {
    return { entries: [], sourcePages: [], maxTopNumber, verbatimText: "" };
  }
  entries = firstSequentialNumberedRun(entries);
  const sourcePages = Array.from(new Set(collected.map((row) => row.page))).sort((a, b) => a - b);
  return { entries, sourcePages, maxTopNumber, verbatimText };
}

function extractFocusedCriteriaFromChunks(
  chunks: ParsedProtocolChunk[],
  focus: "inclusion" | "exclusion"
): FocusedCriteriaExtraction {
  if (chunks.length === 0) return { entries: [], usedChunks: [] };
  const headingNeedle = focus === "inclusion" ? /\binclusion criteria\b/ : /\bexclusion criteria\b/;
  const stopNeedles =
    focus === "inclusion"
      ? [
          /\bexclusion criteria\b/,
          /\bendpoints?\b/,
          /\bstudy design\b/,
          /\bstudy procedures?\b/,
          /\bstatistical\b/,
        ]
      : [
          /\bendpoints?\b/,
          /\bstudy design\b/,
          /\bstudy procedures?\b/,
          /\bconcomitant\b/,
          /\bstatistical\b/,
        ];

  const ordered = [...chunks].sort((a, b) => {
    const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
    const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.chunkIndex - b.chunkIndex;
  });

  const anchors: number[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const hay = normalizeText(`${ordered[i].sectionTitle || ""} ${ordered[i].chunkText.slice(0, 1200)}`);
    if (!headingNeedle.test(hay)) continue;
    if (isAmendmentLikeParsedChunk(ordered[i])) continue;
    anchors.push(i);
  }

  const windows: Array<FocusedCriteriaExtraction & { score: number }> = [];
  for (const anchor of anchors) {
    const usedChunks: ParsedProtocolChunk[] = [];
    let amendmentHits = 0;
    const lines: string[] = [];

    for (let i = anchor; i < ordered.length && i < anchor + 20; i += 1) {
      const row = ordered[i];
      const hay = normalizeText(`${row.sectionTitle || ""} ${row.chunkText.slice(0, 1400)}`);
      if (i > anchor && stopNeedles.some((needle) => needle.test(hay))) break;
      if (i > anchor && headingNeedle.test(hay)) break;
      if (isAmendmentLikeParsedChunk(row)) {
        amendmentHits += 1;
        continue;
      }
      usedChunks.push(row);
      const rowLines = unwrapContextChunkText(row.chunkText)
        .split(/\n+/)
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);
      lines.push(...rowLines);
    }

    if (lines.length === 0 || usedChunks.length === 0) continue;
    if (!lines.some((line) => headingNeedle.test(normalizeText(line)))) {
      lines.unshift(focus === "inclusion" ? "Inclusion Criteria" : "Exclusion Criteria");
    }
    let entries = parseCriteriaEntries(lines, headingNeedle, stopNeedles);
    if (entries.length === 0) {
      entries = parseLooseNumberedCriteria(lines);
    }
    const hasAllPatientsCue = lines.some((line) =>
      /\ball patients must meet\b|\bmust meet all of the following\b/i.test(line)
    );
    const numberedHints = lines.filter((line) => /^(\d{1,2})[\).\s-]+/.test(line)).length;
    const score = entries.length * 8 + (hasAllPatientsCue ? 8 : 0) + Math.min(numberedHints, 12) - amendmentHits * 6;
    windows.push({ entries, usedChunks, score });
  }

  if (windows.length > 0) {
    windows.sort((a, b) => b.score - a.score || b.entries.length - a.entries.length);
    const best = windows[0];
    return { entries: best.entries, usedChunks: best.usedChunks };
  }

  // Fallback: aggregate all non-amendment chunks where heading appears in title/body.
  const fallbackChunks = ordered.filter((chunk) => {
    if (isAmendmentLikeParsedChunk(chunk)) return false;
    const hay = normalizeText(`${chunk.sectionTitle || ""} ${chunk.chunkText.slice(0, 1200)}`);
    return headingNeedle.test(hay) || chunk.sectionType === "eligibility";
  });
  const lines = collectCriteriaLines(fallbackChunks);
  if (!lines.some((line) => headingNeedle.test(normalizeText(line)))) {
    lines.unshift(focus === "inclusion" ? "Inclusion Criteria" : "Exclusion Criteria");
  }
  let entries = parseCriteriaEntries(lines, headingNeedle, stopNeedles);
  if (entries.length === 0) entries = parseLooseNumberedCriteria(lines);
  return { entries, usedChunks: fallbackChunks };
}

function scoreCriteriaChunkForLLM(chunk: ParsedProtocolChunk) {
  const hay = normalizeText(`${chunk.sectionTitle || ""} ${chunk.chunkText.slice(0, 2200)}`);
  let score = 0;
  if (chunk.sectionType === "eligibility") score += 12;
  if (/\binclusion criteria\b/.test(hay)) score += 14;
  if (/\bexclusion criteria\b/.test(hay)) score += 12;
  if (/\ball patients must meet\b|\bmust meet all of the following\b/.test(hay)) score += 14;
  const numbered = chunk.chunkText.match(/\b\d{1,2}[\).]/g)?.length ?? 0;
  score += Math.min(numbered, 10) * 2;
  if (isAmendmentLikeParsedChunk(chunk)) score -= 40;
  return score;
}

function findCriteriaAnchorIndex(lines: string[], startNeedle: RegExp, stopNeedles: RegExp[]) {
  const candidates: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (startNeedle.test(normalizeText(lines[i]))) candidates.push(i);
  }
  if (candidates.length === 0) return -1;

  let bestIndex = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const index of candidates) {
    let score = 0;
    const heading = lines[index];
    if (/\ball patients must meet\b|\bmust meet all of the following\b/i.test(heading)) score += 8;
    if (/\binclusion criteria\b|\bexclusion criteria\b/i.test(heading)) score += 4;
    if (isAmendmentLikeText(heading, lines.slice(index, Math.min(lines.length, index + 3)).join(" "))) {
      score -= 14;
    }

    for (let i = index + 1; i < Math.min(lines.length, index + 56); i += 1) {
      const line = lines[i];
      const normalized = normalizeText(line);
      if (stopNeedles.some((needle) => needle.test(normalized))) break;
      if (/^(\d{1,2})[\).\s-]+/.test(line)) score += 3;
      else if (/^([a-z])[\).\s-]+/i.test(line)) score += 1;
      if (isAmendmentLikeText("", line)) score -= 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function parseCriteriaEntries(lines: string[], startNeedle: RegExp, stopNeedles: RegExp[], anchorIndex?: number) {
  const entries: StructuredCriteriaEntry[] = [];
  const startIndex =
    typeof anchorIndex === "number" && anchorIndex >= 0
      ? anchorIndex
      : lines.findIndex((line) => startNeedle.test(normalizeText(line)));
  if (startIndex < 0) return entries;

  let current: StructuredCriteriaEntry | null = null;
  const pushCurrent = () => {
    if (!current) return;
    current.text = normalizeWhitespace(current.text);
    if (current.text.length > 0) entries.push(current);
  };

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const normalized = normalizeText(line);
    if (stopNeedles.some((needle) => needle.test(normalized))) break;

    const numbered = line.match(/^(\d{1,2})[\).\s-]+(.+)$/);
    if (numbered) {
      pushCurrent();
      current = {
        index: `${numbered[1]}.`,
        text: numbered[2].trim(),
      };
      continue;
    }

    const alpha = line.match(/^([a-z])[\).\s-]+(.+)$/i);
    if (alpha) {
      if (!current) {
        current = {
          index: `${alpha[1]})`,
          text: alpha[2].trim(),
        };
      } else {
        current.text += ` (${alpha[1].toLowerCase()}) ${alpha[2].trim()}`;
      }
      continue;
    }

    // Criteria sections often include inline subheadings (e.g., "Bone marrow function").
    // Treat them as continuation context instead of terminating extraction.
    if (
      isLikelyHeading(line) &&
      !/^\d+\.\d+/.test(line) &&
      !/^(\d{1,2})[\).\s-]+/.test(line) &&
      !/^([a-z])[\).\s-]+/i.test(line)
    ) {
      if (current) {
        current.text += ` ${line}:`;
      }
      continue;
    }

    if (/^[-•]\s+/.test(line)) {
      const bullet = line.replace(/^[-•]\s+/, "");
      if (!current) {
        current = { index: `${entries.length + 1}.`, text: bullet };
      } else {
        current.text += ` ${bullet}`;
      }
      continue;
    }

    // Continuation lines belong to the active criterion.
    if (current) {
      current.text += ` ${line}`;
    }
  }
  pushCurrent();
  return entries;
}

async function extractStructuredCriteriaFromChunks(
  chunks: ParsedProtocolChunk[],
  pages?: PdfPageText[]
): Promise<StructuredCriteria | null> {
  const allCandidateChunks = chunks.filter((chunk) => {
    const title = normalizeText(chunk.sectionTitle ?? "");
    const body = normalizeText(chunk.chunkText);
    return (
      chunk.sectionType === "eligibility" ||
      title.includes("inclusion criteria") ||
      title.includes("exclusion criteria") ||
      body.includes("inclusion criteria") ||
      body.includes("exclusion criteria")
    );
  });
  if (allCandidateChunks.length === 0) return null;

  const candidateChunks = allCandidateChunks.filter((chunk) => !isAmendmentLikeParsedChunk(chunk));
  const sourceChunks = candidateChunks.length > 0 ? candidateChunks : allCandidateChunks;

  let inclusion: StructuredCriteriaEntry[] = [];
  let exclusion: StructuredCriteriaEntry[] = [];
  let sourcePages: number[] = [];
  let inclusionSourcePages: number[] = [];
  let exclusionSourcePages: number[] = [];
  let inclusionVerbatim = "";
  let exclusionVerbatim = "";
  let pageExtractionIncomplete = false;

  if (pages && pages.length > 0) {
    const pageLines = buildPageLines(pages);
    const inclusionFromPages = extractFocusedCriteriaFromPageLines(pageLines, "inclusion");
    const exclusionFromPages = extractFocusedCriteriaFromPageLines(pageLines, "exclusion");
    inclusion = inclusionFromPages.entries;
    exclusion = exclusionFromPages.entries;
    inclusionSourcePages = inclusionFromPages.sourcePages;
    exclusionSourcePages = exclusionFromPages.sourcePages;
    inclusionVerbatim = inclusionFromPages.verbatimText;
    exclusionVerbatim = exclusionFromPages.verbatimText;
    sourcePages = Array.from(new Set([...inclusionFromPages.sourcePages, ...exclusionFromPages.sourcePages])).sort(
      (a, b) => a - b
    );

    // If we can detect higher numbering than parsed entries, parser is incomplete.
    // Let LLM fallback run using focused source context.
    const inclusionLooksIncomplete =
      inclusionFromPages.maxTopNumber > 0 && inclusion.length > 0 && inclusion.length < inclusionFromPages.maxTopNumber;
    const exclusionLooksIncomplete =
      exclusionFromPages.maxTopNumber > 0 && exclusion.length > 0 && exclusion.length < exclusionFromPages.maxTopNumber;
    if (inclusionLooksIncomplete || exclusionLooksIncomplete) {
      pageExtractionIncomplete = true;
    }
  }

  if (inclusion.length === 0 && exclusion.length === 0 && !pageExtractionIncomplete) {
    const inclusionResult = extractFocusedCriteriaFromChunks(sourceChunks, "inclusion");
    const exclusionResult = extractFocusedCriteriaFromChunks(sourceChunks, "exclusion");
    inclusion = inclusionResult.entries;
    exclusion = exclusionResult.entries;
    inclusionSourcePages = extractCriteriaSourcePages(inclusionResult.usedChunks);
    exclusionSourcePages = extractCriteriaSourcePages(exclusionResult.usedChunks);
    const usedForPages = new Set<ParsedProtocolChunk>([...inclusionResult.usedChunks, ...exclusionResult.usedChunks]);
    const sourcePageSeed = usedForPages.size > 0 ? Array.from(usedForPages) : sourceChunks;
    sourcePages = extractCriteriaSourcePages(sourcePageSeed);
  }

  const deterministic: StructuredCriteria = {
    inclusion,
    exclusion,
    sourcePages,
    inclusionSourcePages,
    exclusionSourcePages,
    inclusionVerbatim,
    exclusionVerbatim,
    source: "deterministic",
  };

  // Deterministic pass is usually enough; use LLM only when extraction is too sparse.
  if (deterministic.inclusion.length >= 4 || deterministic.exclusion.length >= 4) {
    return deterministic;
  }

  const llmSeedChunks = [...sourceChunks]
    .sort((a, b) => scoreCriteriaChunkForLLM(b) - scoreCriteriaChunkForLLM(a))
    .slice(0, 16)
    .sort((a, b) => {
      const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return a.chunkIndex - b.chunkIndex;
    });

  const sourceText = llmSeedChunks
    .map((chunk) => {
      const pageLabel =
        chunk.pageStart && chunk.pageEnd && chunk.pageEnd !== chunk.pageStart
          ? `pp.${chunk.pageStart}-${chunk.pageEnd}`
          : chunk.pageStart
          ? `p.${chunk.pageStart}`
          : "page n/a";
      return `Section: ${chunk.sectionTitle || chunk.sectionType} (${pageLabel})\n${unwrapContextChunkText(chunk.chunkText)}`;
    })
    .join("\n\n")
    .slice(0, 30000);
  if (!sourceText.trim()) return deterministic;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "Extract inclusion/exclusion criteria from protocol text. Return only JSON with inclusion/exclusion arrays containing numbered criteria entries.",
        },
        {
          role: "user",
          content: `Return JSON with this shape:
{
  "inclusion":[{"index":"1.","text":"..."}],
  "exclusion":[{"index":"1.","text":"..."}]
}

Protocol content:
${sourceText}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_criteria",
          strict: true,
          schema: {
            type: "object",
            properties: {
              inclusion: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "string" },
                    text: { type: "string" },
                  },
                  required: ["index", "text"],
                  additionalProperties: false,
                },
              },
              exclusion: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "string" },
                    text: { type: "string" },
                  },
                  required: ["index", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["inclusion", "exclusion"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return deterministic;
    const parsed = JSON.parse(content) as Pick<StructuredCriteria, "inclusion" | "exclusion">;
    const merged: StructuredCriteria = {
      inclusion: parsed.inclusion?.length ? parsed.inclusion : deterministic.inclusion,
      exclusion: parsed.exclusion?.length ? parsed.exclusion : deterministic.exclusion,
      sourcePages: deterministic.sourcePages,
      inclusionSourcePages: deterministic.inclusionSourcePages,
      exclusionSourcePages: deterministic.exclusionSourcePages,
      source: "llm",
    };
    return merged;
  } catch {
    return deterministic;
  }
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

function extractScheduleSourcePagesFromChunks(chunks: ParsedProtocolChunk[]) {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    if (chunk.pageStart) pages.add(chunk.pageStart);
    if (chunk.pageEnd) pages.add(chunk.pageEnd);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

function isLikelyTableOfContentsPage(page: PdfPageText) {
  const lines = String(page.text || "")
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  if (lines.length === 0) return false;
  if (/table of contents|list of tables|list of figures/i.test(lines.join(" "))) return true;
  const tocLikeCount = lines.filter((line) => isLikelyTableOfContentsLine(line)).length;
  return tocLikeCount >= 6 && tocLikeCount / lines.length > 0.22;
}

function scoreSchedulePage(page: PdfPageText) {
  const text = String(page.text || "");
  const normalized = normalizeText(text);
  if (!normalized) return -100;
  if (isLikelyTableOfContentsPage(page)) return -60;

  const lines = text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  let score = 0;
  if (isScheduleHeadingText(normalized)) score += 24;
  if (/\bstudy procedure\b/i.test(text)) score += 16;
  if (/\bvisit window\b/i.test(text)) score += 14;
  if (/\bstudy days?\b/i.test(text)) score += 12;
  if (/\bscreening\b/i.test(text)) score += 6;
  if (/\bcycle\b/i.test(text)) score += 6;
  if (/\bfollow[\s-]?up\b/i.test(text)) score += 5;
  if (/\bend of treatment\b/i.test(text)) score += 5;

  const xHits = (text.match(/\bX\b/g) || []).length;
  score += Math.min(40, xHits);

  if (isAmendmentLikeText("", text.slice(0, 3000))) score -= 25;

  const rowSignals = lines.filter((line) =>
    /\b(informed consent|vital signs|pregnancy test|ecg|urinalysis|coagulation|concomitant medications?|adverse events?)\b/i.test(
      line
    )
  ).length;
  score += Math.min(16, rowSignals * 2);

  return score;
}

function collectScheduleSourcePages(pages: PdfPageText[]) {
  if (pages.length === 0) return [];
  const scored = pages
    .map((page) => ({
      page: page.pageNumber,
      score: scoreSchedulePage(page),
      text: page.text,
      isToc: isLikelyTableOfContentsPage(page),
    }))
    .sort((a, b) => b.score - a.score || a.page - b.page);

  const best = scored[0];
  if (!best || best.score < 10) return [];

  const byPage = new Map(scored.map((item) => [item.page, item]));
  const selected = new Set<number>([best.page]);

  let lowRun = 0;
  for (let page = best.page + 1; page <= best.page + 8; page += 1) {
    const row = byPage.get(page);
    if (!row) break;
    const hasScheduleSignals =
      !row.isToc &&
      (row.score >= 6 || /\b(study procedure|visit window|study days?|schedule of (events|activities|assessments))\b/i.test(row.text));
    if (hasScheduleSignals) {
      selected.add(page);
      lowRun = 0;
      continue;
    }
    lowRun += 1;
    if (lowRun >= 2) break;
  }

  for (let page = best.page - 1; page >= Math.max(1, best.page - 3); page -= 1) {
    const row = byPage.get(page);
    if (!row) continue;
    if (
      !row.isToc &&
      (row.score >= 8 || /\bschedule of (events|activities|assessments)\b/i.test(row.text))
    ) {
      selected.add(page);
    }
  }

  return Array.from(selected).sort((a, b) => a - b);
}

async function invokeStructuredScheduleExtractor(sourceText: string) {
  const trimmed = String(sourceText || "").trim();
  if (!trimmed) return null;
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You extract Schedule of Activities / Schedule of Events tables from clinical trial protocols.
Return only JSON with:
{
  "visits":[{"name":"Screening","day":"Day -14 to -1"}],
  "procedures":[{"name":"Informed consent","category":"consent"}],
  "entries":[{"procedure":"Informed consent","visit":"Screening","required":true,"footnoteRef":null}],
  "footnotes":[{"number":"1","text":"Only first visit each cycle"}]
}
Rules:
- Parse table headers and rows exactly when possible.
- Preserve cycle/day distinctions in visit names.
- For each row/visit cell with X (or equivalent required marker), emit required=true.
- Keep required as boolean and footnoteRef as string|null.
- Do not invent visits/procedures not present in text.`,
      },
      { role: "user", content: `Extract structured SOA JSON from this protocol content:\n\n${trimmed}` },
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
  return JSON.parse(content) as Omit<StructuredSchedule, "sourcePages">;
}

function maxScheduleTableColumnCount(table: StructuredScheduleTable) {
  const headerWidth = table.column_headers.reduce((max, row) => Math.max(max, row.length), 0);
  const rowWidth = table.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  return Math.max(headerWidth, rowWidth);
}

function normalizeScheduleTableRow(row: StructuredScheduleTableRow, columnCount: number): StructuredScheduleTableRow {
  const categoryRaw = row?.category == null ? null : normalizeWhitespace(String(row.category || ""));
  const procedure = normalizeWhitespace(String(row?.procedure || ""));
  const cellsRaw = Array.isArray(row?.cells) ? row.cells : [];
  const cells = Array.from({ length: columnCount }, (_, index) =>
    normalizeWhitespace(String(cellsRaw[index] || ""))
  );
  return {
    category: categoryRaw || null,
    procedure,
    cells,
  };
}

function normalizeScheduleTable(input: StructuredScheduleTable, pageNumber: number): StructuredScheduleTable {
  const pageNumbers = new Set<number>();
  for (const value of input.page_numbers || []) {
    if (Number.isFinite(value)) pageNumbers.add(value);
  }
  pageNumbers.add(pageNumber);

  const rows = Array.isArray(input.rows) ? input.rows : [];
  const headers = Array.isArray(input.column_headers) ? input.column_headers : [];
  const provisional: StructuredScheduleTable = {
    table_title: normalizeWhitespace(String(input.table_title || "")),
    section: normalizeWhitespace(String(input.section || "")),
    column_headers: headers.map((row) => (Array.isArray(row) ? row.map((cell) => normalizeWhitespace(String(cell || ""))) : [])),
    rows: rows.map((row) => ({
      category: row?.category == null ? null : normalizeWhitespace(String(row.category || "")),
      procedure: normalizeWhitespace(String(row?.procedure || "")),
      cells: Array.isArray(row?.cells) ? row.cells.map((cell) => normalizeWhitespace(String(cell || ""))) : [],
    })),
    footnotes: Array.isArray(input.footnotes)
      ? input.footnotes
          .map((note) => ({
            marker: normalizeWhitespace(String(note?.marker || "")),
            text: normalizeWhitespace(String(note?.text || "")),
          }))
          .filter((note) => note.marker && note.text)
      : [],
    page_numbers: Array.from(pageNumbers).sort((a, b) => a - b),
  };

  const columnCount = Math.max(1, maxScheduleTableColumnCount(provisional));
  const normalizedHeaders = provisional.column_headers.map((row) =>
    Array.from({ length: columnCount }, (_, index) => normalizeWhitespace(String(row[index] || "")))
  );
  const normalizedRows = provisional.rows
    .map((row) => normalizeScheduleTableRow(row, columnCount))
    .filter((row) => row.procedure.length > 0);

  return {
    ...provisional,
    column_headers: normalizedHeaders,
    rows: normalizedRows,
  };
}

function mergeColumnHeaders(base: string[][], incoming: string[][], columnCount: number) {
  const normalizedBase = base.map((row) =>
    Array.from({ length: columnCount }, (_, index) => normalizeWhitespace(String(row[index] || "")))
  );
  const normalizedIncoming = incoming.map((row) =>
    Array.from({ length: columnCount }, (_, index) => normalizeWhitespace(String(row[index] || "")))
  );

  if (normalizedBase.length === 0) return normalizedIncoming;
  if (normalizedIncoming.length === 0) return normalizedBase;

  const levelCount = Math.max(normalizedBase.length, normalizedIncoming.length);
  const merged: string[][] = [];
  for (let level = 0; level < levelCount; level += 1) {
    const baseRow = normalizedBase[level] || Array.from({ length: columnCount }, () => "");
    const incomingRow = normalizedIncoming[level] || Array.from({ length: columnCount }, () => "");
    merged.push(
      Array.from({ length: columnCount }, (_, index) => {
        const left = normalizeWhitespace(baseRow[index] || "");
        const right = normalizeWhitespace(incomingRow[index] || "");
        if (left && right && left === right) return left;
        if (left && !right) return left;
        if (!left && right) return right;
        if (!left && !right) return "";
        return left.length >= right.length ? left : right;
      })
    );
  }
  return merged;
}

function mergeStructuredScheduleTables(tables: StructuredScheduleTable[]) {
  const ordered = tables
    .filter((table) => table.rows.length > 0 || table.column_headers.length > 0)
    .sort((a, b) => {
      const ap = a.page_numbers[0] ?? Number.MAX_SAFE_INTEGER;
      const bp = b.page_numbers[0] ?? Number.MAX_SAFE_INTEGER;
      return ap - bp;
    });
  if (ordered.length === 0) return null;

  const columnCount = Math.max(...ordered.map((table) => maxScheduleTableColumnCount(table)), 1);
  let title = "";
  let section = "";
  const pageNumbers = new Set<number>();
  const footnoteMap = new Map<string, StructuredScheduleTableFootnote>();
  const mergedRows: StructuredScheduleTableRow[] = [];
  let mergedHeaders: string[][] = [];
  const rowKeys = new Set<string>();

  for (const table of ordered) {
    if (!title && table.table_title) title = table.table_title;
    if (!section && table.section) section = table.section;
    for (const page of table.page_numbers) {
      if (Number.isFinite(page)) pageNumbers.add(page);
    }
    mergedHeaders = mergeColumnHeaders(mergedHeaders, table.column_headers, columnCount);

    for (const note of table.footnotes) {
      const marker = normalizeWhitespace(note.marker);
      const text = normalizeWhitespace(note.text);
      if (!marker || !text) continue;
      const key = `${normalizeLite(marker)}|${normalizeLite(text)}`;
      if (!footnoteMap.has(key)) {
        footnoteMap.set(key, { marker, text });
      }
    }

    for (const row of table.rows.map((item) => normalizeScheduleTableRow(item, columnCount))) {
      if (!row.procedure) continue;
      const key = `${normalizeLite(row.category || "")}|${normalizeLite(row.procedure)}|${row.cells
        .map((cell) => normalizeLite(cell))
        .join("|")}`;
      if (rowKeys.has(key)) continue;
      rowKeys.add(key);
      mergedRows.push(row);
    }
  }

  return {
    table_title: title || "Schedule of Assessments",
    section: section || "Schedule of Assessments",
    column_headers: mergedHeaders,
    rows: mergedRows,
    footnotes: Array.from(footnoteMap.values()),
    page_numbers: Array.from(pageNumbers).sort((a, b) => a - b),
  } satisfies StructuredScheduleTable;
}

function extractFootnoteMarkerFromCell(cell: string) {
  const raw = normalizeWhitespace(cell);
  if (!raw) return null;
  const caret = raw.match(/\^([a-z0-9*†‡]+)/i);
  if (caret?.[1]) return caret[1];
  const suffix = raw.match(/(?:X|✓|✔|☑)\s*([a-z]|[0-9]+|\*|†|‡)\s*$/i);
  if (suffix?.[1]) return suffix[1];
  return null;
}

function cellIndicatesRequired(value: string) {
  const raw = normalizeWhitespace(value);
  if (!raw) return false;
  return /(^|[^a-z0-9])(x|✓|✔|☑)([^a-z0-9]|$)/i.test(raw);
}

function parseVisitLabelToScheduleVisit(label: string): ScheduleVisit {
  const normalized = normalizeWhitespace(label).replace(/\s+[-–]\s*$/, "").trim();
  const parentheticalDay = normalized.match(/\((day[^)]*)\)/i)?.[1] || null;
  if (parentheticalDay) {
    const name = normalizeWhitespace(normalized.replace(/\((day[^)]*)\)/i, "").trim()) || normalized;
    return {
      name,
      day: normalizeWhitespace(parentheticalDay),
    };
  }
  const inlineDay = normalized.match(/\b(day\s*-?\d+(?:\s*(?:to|-)\s*-?\d+)?(?:\s*(?:\+\/-|\+|-)\s*\d+\s*days?)?)\b/i)?.[1] || null;
  if (!inlineDay) {
    return { name: normalized, day: null };
  }
  const name = normalizeWhitespace(normalized.replace(new RegExp(inlineDay, "i"), "").trim()) || normalized;
  return {
    name,
    day: normalizeWhitespace(inlineDay),
  };
}

type ScheduleVisitColumn = {
  columnIndex: number;
  visit: ScheduleVisit;
  label: string;
};

function buildVisitColumnsFromTableHeaders(table: StructuredScheduleTable): ScheduleVisitColumn[] {
  const columnCount = maxScheduleTableColumnCount(table);
  const columns: ScheduleVisitColumn[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    const fragments = table.column_headers
      .map((row) => normalizeWhitespace(String(row[index] || "")))
      .filter(Boolean);
    if (fragments.length === 0) continue;
    const compactFragments = fragments.filter((value, position) => position === 0 || value !== fragments[position - 1]);
    const label = normalizeWhitespace(compactFragments.join(" ")) || `Column ${index + 1}`;
    const normalizedLabel = normalizeLite(label);
    const hasVisitSignals =
      /\bscreening\b|\bcycle\b|\bfollow[\s-]?up\b|\bend of treatment\b|\beot\b|\bend of study\b|\bday\b|\bsafety\b|\bdisease progression\b|\bf\/?u\b|\bc\d+\b/.test(
        normalizedLabel
      );
    const isNonVisitHeader = /\bstudy procedure\b|\bstudy days\b|\bvisit window\b/.test(normalizedLabel);
    if (isNonVisitHeader && !hasVisitSignals) continue;
    if (!hasVisitSignals && index === 0) continue;
    const visit = parseVisitLabelToScheduleVisit(label);
    if (!visit.name || /\bstudy procedure\b|\bstudy days\b|\bvisit window\b/i.test(visit.name)) continue;
    columns.push({
      columnIndex: index,
      visit,
      label,
    });
  }
  if (columns.length > 0) return columns;
  return Array.from({ length: columnCount }, (_, index) => {
    const fragments = table.column_headers
      .map((row) => normalizeWhitespace(String(row[index] || "")))
      .filter(Boolean);
    const compactFragments = fragments.filter((value, position) => position === 0 || value !== fragments[position - 1]);
    const label = normalizeWhitespace(compactFragments.join(" ")) || `Column ${index + 1}`;
    return {
      columnIndex: index,
      visit: parseVisitLabelToScheduleVisit(label),
      label,
    };
  });
}

function buildStructuredScheduleFromRichTable(table: StructuredScheduleTable): Omit<StructuredSchedule, "sourcePages"> {
  const visitColumns = buildVisitColumnsFromTableHeaders(table);
  const visits = visitColumns.map((column) => column.visit);
  const proceduresMap = new Map<string, ScheduleProcedure>();
  const entries: ScheduleEntry[] = [];
  const columnCount = maxScheduleTableColumnCount(table);
  const hasProcedureHeaderInFirstColumn = table.column_headers.some((row) =>
    normalizeLite(String(row[0] || "")).includes("study procedure")
  );

  for (const row of table.rows) {
    const procedure = normalizeWhitespace(row.procedure);
    if (!procedure) continue;
    const category = row.category ? normalizeWhitespace(row.category) : null;
    const procedureKey = normalizeProcedureKey(procedure);
    if (procedureKey && !proceduresMap.has(procedureKey)) {
      proceduresMap.set(procedureKey, { name: procedure, category });
    }

    const rowCells = Array.from({ length: row.cells.length }, (_, index) => normalizeWhitespace(String(row.cells[index] || "")));
    const cellsExcludeProcedureColumn = hasProcedureHeaderInFirstColumn && rowCells.length === Math.max(0, columnCount - 1);
    for (let visitIndex = 0; visitIndex < visitColumns.length; visitIndex += 1) {
      const column = visitColumns[visitIndex];
      const cellIndex = cellsExcludeProcedureColumn ? Math.max(0, column.columnIndex - 1) : column.columnIndex;
      const cell = rowCells[cellIndex] || "";
      const visit = visits[visitIndex];
      const visitLabel = `${visit.name}${visit.day ? ` (${visit.day})` : ""}`;
      entries.push({
        procedure,
        visit: visitLabel,
        required: cellIndicatesRequired(cell),
        footnoteRef: extractFootnoteMarkerFromCell(cell),
      });
    }
  }

  return {
    visits,
    procedures: Array.from(proceduresMap.values()),
    entries,
    footnotes: table.footnotes.map((note) => ({
      number: note.marker,
      text: note.text,
    })),
    table,
  };
}

async function renderPdfPagesToPngDataUrls(options: {
  fileUrl: string;
  pages: number[];
  dpi?: number;
}) {
  const fileUrl = String(options.fileUrl || "").trim();
  if (!fileUrl) return [];
  const pages = Array.from(new Set(options.pages.filter((page) => Number.isFinite(page)))).sort((a, b) => a - b);
  if (pages.length === 0) return [];

  let tempDir: string | null = null;
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF (${response.status} ${response.statusText})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) return [];

    tempDir = await fs.mkdtemp(path.join(tmpdir(), "soa-vision-"));
    const pdfPath = path.join(tempDir, "source.pdf");
    await fs.writeFile(pdfPath, bytes);

    const output: Array<{ pageNumber: number; dataUrl: string }> = [];
    for (const pageNumber of pages) {
      const outputBase = path.join(tempDir, `page-${pageNumber}`);
      await execFile(
        "pdftoppm",
        ["-f", String(pageNumber), "-singlefile", "-png", "-r", String(options.dpi ?? 300), pdfPath, outputBase],
        { maxBuffer: 8 * 1024 * 1024 }
      );
      const imagePath = `${outputBase}.png`;
      const imageBuffer = await fs.readFile(imagePath);
      output.push({
        pageNumber,
        dataUrl: `data:image/png;base64,${imageBuffer.toString("base64")}`,
      });
    }
    return output;
  } catch (error) {
    console.warn("[protocolContext] Unable to render PDF pages to PNG for vision extraction", error);
    return [];
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
    }
  }
}

async function invokeStructuredScheduleExtractorVisionPage(options: {
  pageNumber: number;
  imageDataUrl: string;
}) {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are extracting a clinical trial table from a protocol document.
Extract this page into precise JSON.
Rules:
1. Preserve every row and every column exactly as shown.
2. For merged or spanning cells, repeat the value in every spanned column position.
3. Empty cells must be "".
4. Cells with X, checkmark, or required markers must be "X".
5. Cells with footnote markers (a, b, *, †, ‡) must include marker on the X value (example: "X^a").
6. Preserve exact cell text without paraphrasing.
7. If this page is a continuation, include continuation rows visible on this page and keep header rows as shown.
Return only valid JSON.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract Schedule table JSON for protocol PDF page ${options.pageNumber}.`,
            },
            {
              type: "image_url",
              image_url: {
                url: options.imageDataUrl,
                detail: "high",
              },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_schedule_table_page",
          strict: true,
          schema: {
            type: "object",
            properties: {
              table_title: { type: "string" },
              section: { type: "string" },
              column_headers: {
                type: "array",
                items: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              rows: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { type: ["string", "null"] },
                    procedure: { type: "string" },
                    cells: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["category", "procedure", "cells"],
                  additionalProperties: false,
                },
              },
              footnotes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    marker: { type: "string" },
                    text: { type: "string" },
                  },
                  required: ["marker", "text"],
                  additionalProperties: false,
                },
              },
              page_numbers: {
                type: "array",
                items: { type: "number" },
              },
            },
            required: ["table_title", "section", "column_headers", "rows", "footnotes", "page_numbers"],
            additionalProperties: false,
          },
        },
      },
      max_tokens: 2800,
    });
    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== "string") return null;
    const parsed = JSON.parse(content) as StructuredScheduleTable;
    return normalizeScheduleTable(parsed, options.pageNumber);
  } catch (error) {
    console.warn(`[protocolContext] Vision SOA page extraction failed for page ${options.pageNumber}`, error);
    return null;
  }
}

async function invokeStructuredScheduleExtractorVisionPdfFallback(options: {
  fileUrl: string;
  sourcePages: number[];
}) {
  const fileUrl = String(options.fileUrl || "").trim();
  if (!fileUrl) return null;
  const pageHints = Array.from(new Set((options.sourcePages || []).filter((n) => Number.isFinite(n)))).sort(
    (a, b) => a - b
  );
  const pageHintText =
    pageHints.length > 0
      ? `Focus extraction on Schedule table pages: ${pageHints.join(", ")}.`
      : "Extract the full Schedule of Assessments / Schedule of Events table from the protocol PDF.";

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You extract clinical trial Schedule of Events / Schedule of Assessments tables from protocol PDFs.
Return only JSON with this shape:
{
  "visits":[{"name":"Screening","day":"Day -14 to -1"}],
  "procedures":[{"name":"Informed consent","category":"consent"}],
  "entries":[{"procedure":"Informed consent","visit":"Screening","required":true,"footnoteRef":null}],
  "footnotes":[{"number":"1","text":"Only first visit each cycle"}]
}
Rules:
- Preserve exact procedure and visit labels from the table.
- Keep required as boolean and footnoteRef as string|null.
- Capture continuation rows across page breaks.
- Do not include non-table prose or table-of-contents data.
- Do not invent procedures or visits.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${pageHintText}
If the schedule spans multiple pages, merge all continuation rows into one table output.
Return only valid JSON.`,
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
          name: "structured_schedule_vision",
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
    return JSON.parse(content) as Omit<StructuredSchedule, "sourcePages">;
  } catch (error) {
    console.warn("[protocolContext] Vision SOE PDF fallback extraction failed", error);
    return null;
  }
}

async function invokeStructuredScheduleExtractorVision(options: {
  fileUrl: string;
  sourcePages: number[];
  availablePages?: number[];
}) {
  const fileUrl = String(options.fileUrl || "").trim();
  if (!fileUrl) return null;
  const availablePages = Array.from(
    new Set((options.availablePages || []).filter((page) => Number.isFinite(page)))
  ).sort((a, b) => a - b);
  const hintedPages = Array.from(new Set((options.sourcePages || []).filter((page) => Number.isFinite(page)))).sort(
    (a, b) => a - b
  );
  const pagesToProcess = (hintedPages.length > 0 ? hintedPages : availablePages).slice(0, 8);

  if (pagesToProcess.length > 0) {
    const pageImages = await renderPdfPagesToPngDataUrls({
      fileUrl,
      pages: pagesToProcess,
      dpi: 300,
    });
    if (pageImages.length > 0) {
      const extractedPages: StructuredScheduleTable[] = [];
      for (const page of pageImages) {
        const extracted = await invokeStructuredScheduleExtractorVisionPage({
          pageNumber: page.pageNumber,
          imageDataUrl: page.dataUrl,
        });
        if (extracted) extractedPages.push(extracted);
      }
      const mergedTable = mergeStructuredScheduleTables(extractedPages);
      if (mergedTable) {
        const schedule = buildStructuredScheduleFromRichTable(mergedTable);
        console.log(
          `[protocolContext] SOE per-page vision extracted pages=${mergedTable.page_numbers.join(",")} rows=${mergedTable.rows.length} columns=${maxScheduleTableColumnCount(
            mergedTable
          )}`
        );
        return schedule;
      }
    }
  }

  return invokeStructuredScheduleExtractorVisionPdfFallback({
    fileUrl,
    sourcePages: hintedPages,
  });
}

function normalizeProcedureKey(value: string) {
  return normalizeLite(value)
    .replace(/\btests?\b/g, "test")
    .replace(/\bprocedures?\b/g, "procedure")
    .trim();
}

function parseVisitSignature(signature: string) {
  const range = signature.match(/^cycle_(\d+)_to_(\d+)_day_(-?\d+)$/);
  if (range) {
    return {
      kind: "cycle" as const,
      cycleStart: Number.parseInt(range[1], 10),
      cycleEnd: Number.parseInt(range[2], 10),
      day: Number.parseInt(range[3], 10),
    };
  }
  const single = signature.match(/^cycle_(\d+)_day_(-?\d+)$/);
  if (single) {
    const cycle = Number.parseInt(single[1], 10);
    return {
      kind: "cycle" as const,
      cycleStart: cycle,
      cycleEnd: cycle,
      day: Number.parseInt(single[2], 10),
    };
  }
  const dayOnly = signature.match(/^day_(-?\d+)$/);
  if (dayOnly) {
    return {
      kind: "day" as const,
      day: Number.parseInt(dayOnly[1], 10),
    };
  }
  return null;
}

function deriveVisitSignature(name: string, day?: string | null) {
  const combined = normalizeLite(`${name || ""} ${day || ""}`);
  if (!combined) return null;

  if (/screening/.test(combined)) return "screening";
  if (/(end of treatment|eot|end of study)/.test(combined)) return "end_of_treatment";

  const hasFollowUp = /(follow up|follow-up|f u|f\/u)/.test(combined);
  const hasSafety = /\bsafety\b/.test(combined);
  const hasProgression = /\b(disease progression|progression)\b/.test(combined);
  if (/30\s+and\s+90/.test(combined) && (hasFollowUp || hasSafety)) {
    return "follow_up_30_90_safety";
  }
  if (/90\s+and\s+180/.test(combined) && (hasFollowUp || hasProgression)) {
    return "follow_up_90_180_progression";
  }

  const rangeWithDay = combined.match(/cycle\s*(\d+)\s*(?:-|to)\s*cycle\s*(\d+).*?day\s*(-?\d+)/);
  if (rangeWithDay) {
    return `cycle_${rangeWithDay[1]}_to_${rangeWithDay[2]}_day_${rangeWithDay[3]}`;
  }

  const singleCycleWithDay =
    combined.match(/cycle\s*(\d+).*?day\s*(-?\d+)/) || combined.match(/\bc(\d+)\s*d(-?\d+)\b/);
  if (singleCycleWithDay) {
    return `cycle_${singleCycleWithDay[1]}_day_${singleCycleWithDay[2]}`;
  }

  const explicitDay = combined.match(/(?:^|\s)(?:day\s*)?(-?\d{1,3})(?:\s|$)/)?.[1] || null;
  if (explicitDay) return `day_${explicitDay}`;

  return combined;
}

function visitCanonicalScore(name: string, day?: string | null) {
  const normalizedName = normalizeLite(name || "");
  const normalizedDay = normalizeLite(day || "");
  let score = 0;
  if (normalizedDay) score += 2;
  if (/\bcycle\b/.test(normalizedName)) score += 4;
  if (/(follow up|follow-up|f u|f\/u)/.test(normalizedName)) score += 4;
  if (/(end of treatment|eot|screening)/.test(normalizedName)) score += 3;
  if (/( to | - )/.test(normalizedName)) score += 2;
  score += Math.min(4, Math.floor((name || "").length / 16));
  return score;
}

function collectExpectedScheduleRowMarks(sourceText: string) {
  const lines = String(sourceText || "")
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const ignoredNeedles = [
    "study procedure",
    "study days",
    "visit window",
    "clinical assessments",
    "clinical laboratory assessments",
    "study drug administration",
    "tumor assessments",
    "pk pharmacodynamic assessments",
    "safety f u",
    "protocol version",
    "amendment version",
    "confidential page",
    "table of contents",
  ];
  const marksByProcedure = new Map<string, number>();

  for (const line of lines) {
    if (!/\bX\b/.test(line)) continue;
    const normalized = normalizeLite(line);
    if (!normalized) continue;
    if (ignoredNeedles.some((needle) => normalized.includes(needle))) continue;
    if (isScheduleHeadingText(normalized)) continue;
    if (/^page\s+\d+/.test(normalized)) continue;

    const firstX = line.search(/\bX\b/);
    if (firstX <= 0) continue;
    let procedure = line.slice(0, firstX).trim();
    procedure = procedure.replace(/\s{2,}.*/g, "").trim();
    procedure = procedure.replace(/\s+\d+(?:,\d+)*\s*$/g, "").trim();
    if (!procedure || procedure.length < 3) continue;

    const key = normalizeProcedureKey(procedure);
    if (!key) continue;
    const markCount = (line.match(/\bX\b/g) || []).length;
    if (markCount <= 0) continue;
    const existing = marksByProcedure.get(key) ?? 0;
    if (markCount > existing) marksByProcedure.set(key, markCount);
  }

  return marksByProcedure;
}

function canonicalizeStructuredSchedule(schedule: Omit<StructuredSchedule, "sourcePages">) {
  const visitsInput = Array.isArray(schedule.visits) ? schedule.visits : [];
  const proceduresInput = Array.isArray(schedule.procedures) ? schedule.procedures : [];
  const entriesInput = Array.isArray(schedule.entries) ? schedule.entries : [];
  const footnotesInput = Array.isArray(schedule.footnotes) ? schedule.footnotes : [];
  const tableInput = schedule.table ?? null;

  const visitKeyToValue = new Map<string, ScheduleVisit>();
  const visitAliasToKey = new Map<string, string>();
  const visitDayIndex = new Map<string, string[]>();
  const visitCandidates = visitsInput
    .map((visit) => {
      const name = normalizeWhitespace(String(visit.name || ""));
      const day = visit.day == null ? null : normalizeWhitespace(String(visit.day || ""));
      if (!name) return null;
      const label = `${name}${day ? ` (${day})` : ""}`;
      const signature = deriveVisitSignature(name, day) || normalizeLite(label);
      if (!signature) return null;
      return {
        name,
        day,
        label,
        signature,
        score: visitCanonicalScore(name, day),
      };
    })
    .filter((visit): visit is NonNullable<typeof visit> => Boolean(visit));

  const cycleRangeByDay = new Map<number, string>();
  for (const visit of visitCandidates) {
    const parsed = parseVisitSignature(visit.signature);
    if (!parsed || parsed.kind !== "cycle") continue;
    if (parsed.cycleStart >= 2 && parsed.cycleEnd > parsed.cycleStart) {
      cycleRangeByDay.set(parsed.day, visit.signature);
    }
  }

  for (const visit of visitCandidates) {
    const parsed = parseVisitSignature(visit.signature);
    if (!parsed || parsed.kind !== "cycle") continue;
    if (parsed.cycleStart >= 2 && parsed.cycleStart === parsed.cycleEnd) {
      const rangeSignature = cycleRangeByDay.get(parsed.day);
      if (rangeSignature) {
        visit.signature = rangeSignature;
      }
    }
  }

  const bestVisitBySignature = new Map<
    string,
    { name: string; day: string | null; score: number; aliases: string[] }
  >();
  for (const visit of visitCandidates) {
    const existing = bestVisitBySignature.get(visit.signature);
    if (!existing || visit.score > existing.score) {
      bestVisitBySignature.set(visit.signature, {
        name: visit.name,
        day: visit.day,
        score: visit.score,
        aliases: existing?.aliases || [],
      });
    }
    const target = bestVisitBySignature.get(visit.signature)!;
    const aliases = [
      normalizeLite(visit.label),
      normalizeLite(visit.name),
      normalizeLite(`${visit.name} ${visit.day || ""}`),
    ].filter(Boolean);
    for (const alias of aliases) {
      if (!target.aliases.includes(alias)) target.aliases.push(alias);
    }
  }

  for (const [signature, visit] of Array.from(bestVisitBySignature.entries())) {
    const key = normalizeLite(`${visit.name}${visit.day ? ` (${visit.day})` : ""}`);
    if (!key) continue;
    visitKeyToValue.set(key, { name: visit.name, day: visit.day });
    for (const alias of visit.aliases) {
      visitAliasToKey.set(alias, key);
    }
    const dayKey = normalizeLite(String(visit.day || ""));
    if (dayKey) {
      const list = visitDayIndex.get(dayKey) || [];
      if (!list.includes(key)) list.push(key);
      visitDayIndex.set(dayKey, list);
      const dayNumber = dayKey.match(/(^|\s)(-?\d{1,3})(\s|$)/)?.[2];
      if (dayNumber) {
        const numberList = visitDayIndex.get(dayNumber) || [];
        if (!numberList.includes(key)) numberList.push(key);
        visitDayIndex.set(dayNumber, numberList);
      }
    }
    const signatureParsed = parseVisitSignature(signature);
    if (signatureParsed && "day" in signatureParsed && Number.isFinite(signatureParsed.day)) {
      const numericDay = String(signatureParsed.day);
      const dayList = visitDayIndex.get(numericDay) || [];
      if (!dayList.includes(key)) dayList.push(key);
      visitDayIndex.set(numericDay, dayList);
    }
  }

  const procedureKeyToValue = new Map<string, ScheduleProcedure>();
  for (const procedure of proceduresInput) {
    const name = normalizeWhitespace(String(procedure.name || ""));
    if (!name) continue;
    const key = normalizeProcedureKey(name);
    if (!key) continue;
    if (!procedureKeyToValue.has(key)) {
      procedureKeyToValue.set(key, {
        name,
        category: procedure.category == null ? null : normalizeWhitespace(String(procedure.category || "")),
      });
    }
  }

  const resolveVisit = (rawVisit: string) => {
    const visit = normalizeWhitespace(String(rawVisit || ""));
    if (!visit) return null;
    const key = normalizeLite(visit);
    if (!key) return null;
    const aliasResolved = visitAliasToKey.get(key);
    if (aliasResolved && visitKeyToValue.has(aliasResolved)) {
      const canonical = visitKeyToValue.get(aliasResolved)!;
      return `${canonical.name}${canonical.day ? ` (${canonical.day})` : ""}`;
    }
    if (visitKeyToValue.has(key)) {
      const canonical = visitKeyToValue.get(key)!;
      return `${canonical.name}${canonical.day ? ` (${canonical.day})` : ""}`;
    }

    const compact = key
      .replace(/\(\s*/g, " ")
      .replace(/\s*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (visitKeyToValue.has(compact)) {
      const canonical = visitKeyToValue.get(compact)!;
      return `${canonical.name}${canonical.day ? ` (${canonical.day})` : ""}`;
    }

    const derivedSignature = deriveVisitSignature(visit);
    if (derivedSignature) {
      const directBySignature = bestVisitBySignature.get(derivedSignature);
      if (directBySignature) {
        return `${directBySignature.name}${directBySignature.day ? ` (${directBySignature.day})` : ""}`;
      }
    }

    // Resolve plain day token (e.g. "2") only when unique.
    const dayToken = compact.match(/^(?:day\s*)?(-?\d{1,3})$/)?.[1] || null;
    if (dayToken) {
      const matches = visitDayIndex.get(dayToken) || [];
      if (matches.length === 1) {
        const canonical = visitKeyToValue.get(matches[0]!);
        if (canonical) return `${canonical.name}${canonical.day ? ` (${canonical.day})` : ""}`;
      }
    }

    return visit;
  };

  const entriesMap = new Map<string, ScheduleEntry>();
  for (const entry of entriesInput) {
    const procedureRaw = normalizeWhitespace(String(entry.procedure || ""));
    const visitRaw = normalizeWhitespace(String(entry.visit || ""));
    if (!procedureRaw || !visitRaw) continue;
    const procedureKey = normalizeProcedureKey(procedureRaw);
    const procedureCanonical = procedureKeyToValue.get(procedureKey)?.name || procedureRaw;
    const resolvedVisit = resolveVisit(visitRaw);
    if (!resolvedVisit) continue;
    const visitKey = normalizeLite(resolvedVisit);
    if (visitKeyToValue.size > 0 && !visitKeyToValue.has(visitKey)) {
      continue;
    }
    const required = Boolean(entry.required);
    const footnoteRef =
      entry.footnoteRef == null ? null : normalizeWhitespace(String(entry.footnoteRef || ""));
    const dedupeKey = `${normalizeProcedureKey(procedureCanonical)}|${visitKey}|${required ? "1" : "0"}`;
    const existing = entriesMap.get(dedupeKey);
    if (!existing) {
      entriesMap.set(dedupeKey, {
        procedure: procedureCanonical,
        visit: resolvedVisit,
        required,
        footnoteRef,
      });
      continue;
    }
    if (!existing.footnoteRef && footnoteRef) {
      entriesMap.set(dedupeKey, {
        ...existing,
        footnoteRef,
      });
    }
  }

  const footnotesMap = new Map<string, ScheduleFootnote>();
  for (const note of footnotesInput) {
    const number = normalizeWhitespace(String(note.number || ""));
    const text = normalizeWhitespace(String(note.text || ""));
    if (!number || !text) continue;
    const key = `${normalizeLite(number)}|${normalizeLite(text)}`;
    if (!footnotesMap.has(key)) {
      footnotesMap.set(key, { number, text });
    }
  }

  return {
    visits: Array.from(visitKeyToValue.values()),
    procedures: Array.from(procedureKeyToValue.values()),
    entries: Array.from(entriesMap.values()),
    footnotes: Array.from(footnotesMap.values()),
    table: tableInput,
  } satisfies Omit<StructuredSchedule, "sourcePages">;
}

function scoreScheduleVariant(
  candidate: ScheduleVariantCandidate,
  rowMarkHints: Map<string, number>
) {
  const schedule = canonicalizeStructuredSchedule(candidate.schedule);
  const entries = schedule.entries.filter((entry) => entry.required);
  const visitCount = schedule.visits.length;
  const entryCount = entries.length;
  const totalExpectedRows = rowMarkHints.size;
  const expectedTotalMarks = Array.from(rowMarkHints.values()).reduce((sum, value) => sum + value, 0);

  let markDiffPenalty = 0;
  let comparedRows = 0;
  let expectedMarkTotalCompared = 0;
  let foundMarkTotalCompared = 0;
  if (rowMarkHints.size > 0) {
    const byProcedure = new Map<string, number>();
    for (const entry of entries) {
      const key = normalizeProcedureKey(entry.procedure);
      if (!key) continue;
      byProcedure.set(key, (byProcedure.get(key) || 0) + 1);
    }

    for (const [key, expected] of Array.from(rowMarkHints.entries())) {
      const found = byProcedure.get(key);
      if (found == null) continue;
      comparedRows += 1;
      markDiffPenalty += Math.abs(found - expected);
      expectedMarkTotalCompared += expected;
      foundMarkTotalCompared += found;
    }
  }

  const coverageRatio = totalExpectedRows > 0 ? comparedRows / totalExpectedRows : 0;
  const avgDiff = comparedRows > 0 ? markDiffPenalty / comparedRows : Number.MAX_SAFE_INTEGER;
  const comparedTotalDiff = comparedRows > 0 ? Math.abs(foundMarkTotalCompared - expectedMarkTotalCompared) : 0;
  const grossOverflowPenalty =
    expectedTotalMarks > 0 && foundMarkTotalCompared > expectedTotalMarks * 1.35
      ? (foundMarkTotalCompared - expectedTotalMarks * 1.35) * 4
      : 0;
  const missingCoveragePenalty =
    totalExpectedRows > 0 && coverageRatio < 0.2 && candidate.source !== "vision" ? 80 : 0;
  const highDiffPenalty = comparedRows > 0 ? Math.max(0, avgDiff - 1.1) * 48 : 0;
  const comparedTotalPenalty = comparedTotalDiff * 1.4;
  const extremeMismatchPenalty = comparedRows >= 8 && avgDiff > 2.1 ? 180 : 0;

  const sourceBonus =
    candidate.source === "vision" ? 70 : candidate.source === "text_full" ? 52 : 26;
  const completenessScore = Math.min(120, entryCount) + Math.min(36, visitCount * 3);
  const hintScore = coverageRatio * 90 + comparedRows * 2 - markDiffPenalty * 10;
  const total =
    sourceBonus +
    completenessScore +
    hintScore -
    missingCoveragePenalty -
    highDiffPenalty -
    comparedTotalPenalty -
    grossOverflowPenalty -
    extremeMismatchPenalty;

  return {
    schedule,
    total,
    entryCount,
    visitCount,
    comparedRows,
    totalExpectedRows,
    coverageRatio,
    avgDiff,
    markDiffPenalty,
    expectedMarkTotalCompared,
    foundMarkTotalCompared,
    comparedTotalDiff,
    expectedTotalMarks,
    source: candidate.source,
  };
}

function mergeStructuredSchedules(
  variants: ScheduleVariantCandidate[],
  sourceText: string
): Omit<StructuredSchedule, "sourcePages"> | null {
  const usable = variants.filter(
    (candidate) =>
      candidate &&
      candidate.schedule &&
      (candidate.schedule.entries.length > 0 || candidate.schedule.visits.length > 0)
  );
  if (usable.length === 0) return null;

  const visionVariants = usable.filter((candidate) => candidate.source === "vision");
  const preferred = visionVariants.length > 0 ? visionVariants : usable;
  const rowMarkHints = collectExpectedScheduleRowMarks(sourceText);

  const scored = preferred
    .map((candidate) => scoreScheduleVariant(candidate, rowMarkHints))
    .sort((a, b) => b.total - a.total || b.entryCount - a.entryCount || b.visitCount - a.visitCount);
  const winner = scored[0];
  if (!winner) return null;

  const scoreSummary = scored
    .slice(0, 4)
    .map(
      (item) =>
        `${item.source}:score=${item.total.toFixed(1)} entries=${item.entryCount} visits=${item.visitCount} coverage=${(
          item.coverageRatio * 100
        ).toFixed(0)}% avgDiff=${Number.isFinite(item.avgDiff) ? item.avgDiff.toFixed(2) : "n/a"} marks=${item.foundMarkTotalCompared}/${item.expectedMarkTotalCompared || item.expectedTotalMarks}`
    )
    .join(" | ");
  console.log(
    `[protocolContext] SOE variant selected source=${winner.source} entries=${winner.entryCount} visits=${winner.visitCount} comparedRows=${winner.comparedRows}/${winner.totalExpectedRows} markDiffPenalty=${winner.markDiffPenalty} avgDiff=${Number.isFinite(
      winner.avgDiff
    ) ? winner.avgDiff.toFixed(2) : "n/a"} candidates=${scoreSummary}`
  );

  if (winner.entryCount === 0 && winner.visitCount === 0) return null;
  return winner.schedule;
}

async function extractStructuredScheduleFromChunks(
  chunks: ParsedProtocolChunk[],
  pages: PdfPageText[] = [],
  protocolFileUrl?: string | null
): Promise<StructuredSchedule | null> {
  let sourcePages = collectScheduleSourcePages(pages);
  let sourceText = "";

  if (sourcePages.length > 0) {
    const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
    sourceText = sourcePages
      .map((pageNumber) => {
        const page = pageByNumber.get(pageNumber);
        if (!page) return "";
        return `Page ${pageNumber}\n${preserveTableWhitespace(page.text)}`;
      })
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 42000);
  }

  if (!sourceText.trim()) {
    const scheduleChunks = chunks.filter((chunk) => {
      if (isAmendmentLikeParsedChunk(chunk)) return false;
      const title = normalizeText(chunk.sectionTitle ?? "");
      const body = normalizeText(chunk.chunkText);
      const isScheduleLike =
        isScheduleHeadingText(title) ||
        isScheduleHeadingText(body) ||
        body.includes("visit window") ||
        body.includes("study days");
      if (!isScheduleLike) return false;
      const head = chunk.chunkText.slice(0, 2000);
      if (/\.{3,}\s*\d{1,4}\s*$/m.test(head) || /\blist of tables\b|\btable of contents\b/i.test(head)) {
        return false;
      }
      return true;
    });
    if (scheduleChunks.length === 0) return null;
    sourcePages = extractScheduleSourcePagesFromChunks(scheduleChunks);
    sourceText = scheduleChunks
      .slice(0, 10)
      .map((chunk) => chunk.chunkText)
      .join("\n\n")
      .slice(0, 36000);
  }

  if (!sourceText.trim()) return null;
  console.log(
    `[protocolContext] SOE extraction source pages=${sourcePages.length > 0 ? sourcePages.join(",") : "n/a"} chars=${sourceText.length}`
  );

  const variants: ScheduleVariantCandidate[] = [];
  const fullTextVariant = await invokeStructuredScheduleExtractor(sourceText);
  if (fullTextVariant) {
    variants.push({
      source: "text_full",
      schedule: fullTextVariant,
    });
  }

  if (sourcePages.length > 1 && sourcePages.length <= 8 && pages.length > 0) {
    const pageByNumber = new Map(pages.map((page) => [page.pageNumber, page]));
    for (const pageNumber of sourcePages) {
      const page = pageByNumber.get(pageNumber);
      if (!page) continue;
      const perPage = `Page ${pageNumber}\n${preserveTableWhitespace(page.text)}`.slice(0, 18000);
      const pageVariant = await invokeStructuredScheduleExtractor(perPage);
      if (pageVariant) {
        variants.push({
          source: "text_page",
          schedule: pageVariant,
        });
      }
    }
  }

  if (protocolFileUrl) {
    const visionVariant = await invokeStructuredScheduleExtractorVision({
      fileUrl: protocolFileUrl,
      sourcePages,
      availablePages: pages.map((page) => page.pageNumber),
    });
    if (visionVariant) {
      variants.push({
        source: "vision",
        schedule: visionVariant,
      });
      console.log(
        `[protocolContext] SOE vision variant merged visits=${visionVariant.visits.length} entries=${visionVariant.entries.length}`
      );
    }
  }

  const merged = mergeStructuredSchedules(variants, sourceText);
  if (!merged) return null;
  console.log(
    `[protocolContext] SOE extraction variants=${variants.length} mergedVisits=${merged.visits.length} mergedEntries=${merged.entries.length}`
  );
  return {
    ...merged,
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
          source: PROTOCOL_CONTEXT_PARSER_VERSION,
          parserVersion: PROTOCOL_CONTEXT_PARSER_VERSION,
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
    .select({ id: protocolChunks.id, metadata: protocolChunks.metadata })
    .from(protocolChunks)
    .where(eq(protocolChunks.protocolId, options.protocolId))
    .limit(1);
  if (existingChunkRows.length > 0 && !options.forceRefresh) {
    const metadata = (existingChunkRows[0].metadata as Record<string, unknown> | null) ?? null;
    const parserVersion = String(metadata?.parserVersion || metadata?.source || "");
    if (parserVersion === PROTOCOL_CONTEXT_PARSER_VERSION) {
      return {
        protocol,
        created: 0,
        reused: true,
        pageCount: null,
        wordCount: null,
        hasStructuredSchedule: null,
        hasStructuredCriteria: null,
        embeddingCount: null,
      };
    }
    console.log(
      `[protocolContext] Refreshing protocol ${options.protocolId} chunks (parser ${parserVersion || "unknown"} -> ${PROTOCOL_CONTEXT_PARSER_VERSION})`
    );
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
  const structuredSchedule = await extractStructuredScheduleFromChunks(parsedChunks, pages, protocol.fileUrl).catch((error) => {
    console.warn("[protocolContext] Failed to extract structured schedule", error);
    return null;
  });
  const structuredCriteria = await extractStructuredCriteriaFromChunks(parsedChunks, pages).catch((error) => {
    console.warn("[protocolContext] Failed to extract structured criteria", error);
    return null;
  });
  if (structuredCriteria) {
    const inclusionTail = structuredCriteria.inclusion.slice(-3).map((entry) => entry.index).join(",");
    const exclusionTail = structuredCriteria.exclusion.slice(-3).map((entry) => entry.index).join(",");
    const inclusionVerbatimChars = structuredCriteria.inclusionVerbatim?.length ?? 0;
    const exclusionVerbatimChars = structuredCriteria.exclusionVerbatim?.length ?? 0;
    console.log(
      `[protocolContext] Structured criteria extracted inclusion=${structuredCriteria.inclusion.length} exclusion=${structuredCriteria.exclusion.length} pages=${structuredCriteria.sourcePages.join(",")} inclusion_tail=${inclusionTail || "-"} exclusion_tail=${exclusionTail || "-"} inclusion_verbatim_chars=${inclusionVerbatimChars} exclusion_verbatim_chars=${exclusionVerbatimChars}`
    );
  } else {
    console.warn("[protocolContext] Structured criteria extraction returned null");
  }

  if (structuredSchedule) {
    console.log(
      `[protocolContext] Structured schedule extracted visits=${structuredSchedule.visits.length} procedures=${structuredSchedule.procedures.length} entries=${structuredSchedule.entries.length} pages=${structuredSchedule.sourcePages.join(",")}`
    );
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
        parserVersion: PROTOCOL_CONTEXT_PARSER_VERSION,
        structuredSchedule,
      },
    });

    const visitSummaries = buildStructuredScheduleVisitSummaries(structuredSchedule);
    for (const visitSummary of visitSummaries) {
      parsedChunks.push({
        chunkIndex: parsedChunks.length,
        sectionType: "schedule",
        sectionTitle: `Schedule of Activities - ${visitSummary.visitLabel} (structured visit)`,
        pageStart: structuredSchedule.sourcePages[0] ?? null,
        pageEnd:
          structuredSchedule.sourcePages.length > 0
            ? structuredSchedule.sourcePages[structuredSchedule.sourcePages.length - 1]
            : null,
        tokenEstimate: estimateTokens(visitSummary.text),
        contentHash: createHash("sha256").update(visitSummary.text).digest("hex"),
        chunkText: visitSummary.text,
        metadata: {
          sectionType: "schedule",
          sectionTitle: `Schedule of Activities - ${visitSummary.visitLabel} (structured visit)`,
          chunkType: "soa_visit",
          source: "soa-extractor-v2",
          parserVersion: PROTOCOL_CONTEXT_PARSER_VERSION,
          visit: {
            name: visitSummary.visit.name,
            day: visitSummary.visit.day ?? null,
            label: visitSummary.visitLabel,
            order: visitSummary.visitOrder,
          },
          procedureCount: visitSummary.procedureCount,
          sourcePages: structuredSchedule.sourcePages,
        },
      });
    }

    const procedureSummaries = buildStructuredScheduleProcedureSummaries(structuredSchedule);
    for (const procedureSummary of procedureSummaries) {
      parsedChunks.push({
        chunkIndex: parsedChunks.length,
        sectionType: "schedule",
        sectionTitle: `Schedule of Activities - ${procedureSummary.procedureName} (structured procedure)`,
        pageStart: structuredSchedule.sourcePages[0] ?? null,
        pageEnd:
          structuredSchedule.sourcePages.length > 0
            ? structuredSchedule.sourcePages[structuredSchedule.sourcePages.length - 1]
            : null,
        tokenEstimate: estimateTokens(procedureSummary.text),
        contentHash: createHash("sha256").update(procedureSummary.text).digest("hex"),
        chunkText: procedureSummary.text,
        metadata: {
          sectionType: "schedule",
          sectionTitle: `Schedule of Activities - ${procedureSummary.procedureName} (structured procedure)`,
          chunkType: "soa_procedure",
          source: "soa-extractor-v2",
          parserVersion: PROTOCOL_CONTEXT_PARSER_VERSION,
          procedure: {
            name: procedureSummary.procedureName,
            category: procedureSummary.procedureCategory,
          },
          visitCount: procedureSummary.visitCount,
          sourcePages: structuredSchedule.sourcePages,
        },
      });
    }
    console.log(
      `[protocolContext] Structured schedule chunking visit_chunks=${visitSummaries.length} procedure_chunks=${procedureSummaries.length}`
    );
  }

  if (structuredCriteria && (structuredCriteria.inclusion.length > 0 || structuredCriteria.exclusion.length > 0)) {
    const summaryText = criteriaStructuredText(structuredCriteria);
    parsedChunks.push({
      chunkIndex: parsedChunks.length,
      sectionType: "eligibility",
      sectionTitle: "Eligibility criteria (structured)",
      pageStart: structuredCriteria.sourcePages[0] ?? null,
      pageEnd:
        structuredCriteria.sourcePages.length > 0
          ? structuredCriteria.sourcePages[structuredCriteria.sourcePages.length - 1]
          : null,
      tokenEstimate: estimateTokens(summaryText),
      contentHash: createHash("sha256").update(summaryText).digest("hex"),
      chunkText: summaryText,
      metadata: {
        sectionType: "eligibility",
        sectionTitle: "Eligibility criteria (structured)",
        chunkType: "criteria_structured",
        source: `criteria-extractor-${structuredCriteria.source}`,
        parserVersion: PROTOCOL_CONTEXT_PARSER_VERSION,
        structuredCriteria,
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
            parserVersion: PROTOCOL_CONTEXT_PARSER_VERSION,
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
    hasStructuredCriteria: Boolean(structuredCriteria),
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
  if (/\bcycle\s*\d+\b|\bday\s*-?\d+\b|\bc\d+\s*d\d+\b|\bc\d+d\d+\b/.test(normalized)) return "schedule";
  if (
    /\b(when\s+.*\brequired|required\s+.*\bwhen|pregnancy test|12 lead electrocardiogram|ecg|cbc|urinalysis|thyroid function|vital signs|concomitant medications?|adverse events?)\b/.test(
      normalized
    )
  ) {
    return "schedule";
  }
  if (/\bschedule(d)?\b|\btable\b|\bmatrix\b|\bvisit\b|\bassessments?\b|\bevents?\b|\bsoa\b|\bsoe\b/.test(normalized))
    return "schedule";
  if (/\bendpoint\b|\bendpoints\b|\bobjective\b|\bobjectives\b/.test(normalized)) return "endpoints";
  if (/\bprocedure\b|\bprocedures\b|\bdosing\b|\bdrug administration\b|\blab\b/.test(normalized)) {
    return "procedures";
  }
  return "general";
}

function isAmendmentRow(row: ProtocolChunkRow) {
  return isAmendmentLikeRow(row);
}

function matchesFocus(row: ProtocolChunkRow, focus: QueryFocus) {
  const title = normalizeText(row.sectionTitle || "");
  const type = normalizeText(row.sectionType || "");
  const body = normalizeText(row.chunkText.slice(0, 2200));
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  const chunkType = normalizeText(String(metadata?.chunkType || ""));

  if (focus === "inclusion") {
    return (
      (type === "eligibility" && (title.includes("inclusion") || body.includes("inclusion criteria"))) ||
      chunkType.includes("criteria structured") ||
      chunkType.includes("inclusion")
    );
  }
  if (focus === "exclusion") {
    return (
      (type === "eligibility" && (title.includes("exclusion") || body.includes("exclusion criteria"))) ||
      chunkType.includes("criteria structured") ||
      chunkType.includes("exclusion")
    );
  }
  if (focus === "eligibility") {
    return (
      type === "eligibility" ||
      chunkType.includes("eligibility") ||
      chunkType.includes("criteria structured") ||
      title.includes("eligibility")
    );
  }
  if (focus === "schedule") {
    return (
      type === "schedule" ||
      type === "visits" ||
      isScheduleHeadingText(title) ||
      isScheduleHeadingText(body) ||
      chunkType.includes("table") ||
      chunkType.includes("soa visit") ||
      chunkType.includes("soa procedure")
    );
  }
  if (focus === "endpoints") {
    return type === "endpoints" || type === "objectives" || title.includes("endpoint") || title.includes("objective");
  }
  if (focus === "procedures") {
    return (
      type === "visits" ||
      type === "dosing" ||
      type === "laboratory" ||
      chunkType.includes("procedure") ||
      chunkType.includes("visit")
    );
  }
  return true;
}

function collectFocusedCoverageRows(
  rows: ProtocolChunkRow[],
  focus: QueryFocus,
  includeAmendmentRows: boolean
) {
  if (focus !== "inclusion" && focus !== "exclusion") return new Set<number>();

  const ordered = [...rows].sort((a, b) => {
    const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
    const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.chunkIndex - b.chunkIndex;
  });

  const headingNeedle = focus === "inclusion" ? /\binclusion criteria\b/ : /\bexclusion criteria\b/;
  const stopNeedle =
    focus === "inclusion"
      ? /\bexclusion criteria\b/
      : /\b(study treatment|objectives|endpoints|study procedures|schedule of activities|schedule of assessments|schedule of events)\b/;

  let anchor = -1;
  let bestAnchorScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < ordered.length; i += 1) {
    const hay = normalizeText(`${ordered[i].sectionTitle || ""} ${ordered[i].chunkText.slice(0, 900)}`);
    if (headingNeedle.test(hay) && (includeAmendmentRows || !isAmendmentRow(ordered[i]))) {
      let score = 0;
      for (let j = i + 1; j < Math.min(ordered.length, i + 40); j += 1) {
        const nextRow = ordered[j];
        const nextHay = normalizeText(`${nextRow.sectionTitle || ""} ${nextRow.chunkText.slice(0, 320)}`);
        if (stopNeedle.test(nextHay)) break;
        if (/^\d{1,2}[\).\s-]+/.test(nextRow.chunkText.trim())) score += 2;
        if (/^[a-z][\).\s-]+/i.test(nextRow.chunkText.trim())) score += 1;
        if (!includeAmendmentRows && isAmendmentRow(nextRow)) score -= 3;
      }
      if (score > bestAnchorScore) {
        bestAnchorScore = score;
        anchor = i;
      }
    }
  }
  if (anchor < 0) return new Set<number>();

  const included = new Set<number>();
  const start = Math.max(0, anchor - 1);
  for (let i = start; i < ordered.length; i += 1) {
    const row = ordered[i];
    const hay = normalizeText(`${row.sectionTitle || ""} ${row.chunkText.slice(0, 900)}`);
    if (i > anchor && stopNeedle.test(hay)) break;
    if (!includeAmendmentRows && isAmendmentRow(row)) continue;
    included.add(row.id);
    if (included.size >= 72) break;
  }
  return included;
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

export async function getStructuredEligibilityCriteria(protocolId: number): Promise<StructuredCriteria | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const chunkRows = await db
    .select({ metadata: protocolChunks.metadata, sectionType: protocolChunks.sectionType })
    .from(protocolChunks)
    .where(eq(protocolChunks.protocolId, protocolId));

  for (const row of chunkRows) {
    if (row.sectionType !== "eligibility") continue;
    const metadata = row.metadata as Record<string, unknown> | null;
    const structured = metadata?.structuredCriteria;
    if (structured && typeof structured === "object") {
      return structured as StructuredCriteria;
    }
  }

  return null;
}

function scoreChunk(
  query: string,
  row: ProtocolChunkRow,
  options?: {
    expandedQuery?: string;
    preferredChunkTypes?: string[];
    boostSections?: string[];
  }
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedChunk = row.chunkText.toLowerCase();
  const normalizedTitle = (row.sectionTitle || "").toLowerCase();
  const normalizedSectionType = (row.sectionType || "").toLowerCase();
  const metadata = (row.metadata as Record<string, unknown> | null) ?? null;
  const chunkType = String(metadata?.chunkType || "").toLowerCase();
  const focus = detectQueryFocus(query);
  const expandedQuery = normalizeWhitespace(String(options?.expandedQuery || ""));
  const lexicalQuery = expandedQuery || query;
  const terms = tokenizeQuery(lexicalQuery);

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
    if (chunkType.includes("criteria_structured")) score += 24;
    if (chunkType.includes("eligibility")) score += 10;
    if (normalizedTitle.includes("exclusion")) score -= 12;
    if (normalizedChunk.includes("amendment")) score -= 18;
  } else if (focus === "exclusion") {
    if (normalizedSectionType === "eligibility") score += 16;
    if (normalizedTitle.includes("exclusion")) score += 18;
    if (chunkType.includes("exclusion")) score += 18;
    if (chunkType.includes("criteria_structured")) score += 24;
    if (chunkType.includes("eligibility")) score += 10;
    if (normalizedTitle.includes("inclusion")) score -= 12;
    if (normalizedChunk.includes("amendment")) score -= 18;
  } else if (focus === "eligibility") {
    if (normalizedSectionType === "eligibility") score += 14;
    if (chunkType.includes("criterion") || chunkType.includes("eligibility")) score += 12;
    if (chunkType.includes("criteria_structured")) score += 22;
    if (normalizedChunk.includes("amendment")) score -= 12;
  } else if (focus === "schedule") {
    if (normalizedSectionType === "schedule") score += 16;
    if (
      normalizedTitle.includes("schedule of activities") ||
      normalizedTitle.includes("schedule of assessments") ||
      normalizedTitle.includes("schedule of events")
    ) {
      score += 18;
    }
    if (normalizedChunk.includes("visit window") || normalizedChunk.includes("study days")) score += 14;
    if (normalizedChunk.includes("study procedure")) score += 8;
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
    score -= 9;
  }

  if (normalizedChunk.includes(normalizedQuery)) score += 6;
  const normalizedExpanded = lexicalQuery.trim().toLowerCase();
  if (normalizedExpanded && normalizedExpanded !== normalizedQuery && normalizedChunk.includes(normalizedExpanded)) {
    score += 5;
  }

  const preferredChunkTypes = Array.isArray(options?.preferredChunkTypes) ? options?.preferredChunkTypes || [] : [];
  const normalizedChunkType = normalizeText(chunkType);
  if (preferredChunkTypes.length > 0) {
    for (const preferred of preferredChunkTypes) {
      const needle = normalizeText(preferred);
      if (!needle) continue;
      if (normalizedChunkType.includes(needle)) {
        score += 16;
        break;
      }
    }
  }

  const boostSections = Array.isArray(options?.boostSections) ? options?.boostSections || [] : [];
  if (boostSections.length > 0) {
    const sectionHay = normalizeText(`${row.sectionTitle || ""} ${row.sectionType}`);
    for (const section of boostSections) {
      const needle = normalizeText(section);
      if (!needle) continue;
      if (sectionHay.includes(needle)) {
        score = score * 1.25 + 3;
        break;
      }
    }
  }
  return score;
}

export async function getProtocolContextChunks(options: {
  protocolId: number;
  query?: string;
  expandedQuery?: string;
  preferredChunkTypes?: string[];
  boostSections?: string[];
  sectionTypes?: string[];
  limit?: number;
  comprehensive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const {
    protocolId,
    query,
    expandedQuery,
    preferredChunkTypes = [],
    boostSections = [],
    sectionTypes,
    limit = 6,
    comprehensive = false,
  } = options;
  try {
    // Self-heal stale chunk sets (older parser versions) before retrieval.
    await ingestProtocolContextChunks({ protocolId });
  } catch (error) {
    console.warn(`[protocolContext] Pre-retrieval ingest check failed for protocol ${protocolId}`, error);
  }

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

  const embeddingQuery = normalizeWhitespace(String(expandedQuery || query || ""));
  let queryEmbedding: number[] | null = null;
  if (embeddingQuery && embeddingQuery.trim().length > 0) {
    try {
      const vectors = await invokeEmbeddings([embeddingQuery], "text-embedding-3-small");
      queryEmbedding = vectors[0] ?? null;
    } catch (error) {
      console.warn("[protocolContext] Failed to embed context query", error);
      queryEmbedding = null;
    }
  }

  const scoredItems = query
    ? chunkRows.map((row) => {
        const lexicalScore = scoreChunk(query, row, {
          expandedQuery,
          preferredChunkTypes,
          boostSections,
        });
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

  const focus = query ? detectQueryFocus(query) : "general";
  const includeAmendmentsForQuery = query ? /\bamendment|revision|change(s)?\b/i.test(query) : false;
  const suppressAmendments =
    !includeAmendmentsForQuery && (focus === "inclusion" || focus === "exclusion" || focus === "eligibility");

  const queryNeedsCoverage =
    !!query &&
    /(all|list|criteria|criterion|requirements?|what are|what is|which|table|schedule|matrix|rows?|columns?|assessments?|endpoints?|procedures?|eligibility|inclusion|exclusion|visit window|footnote|cohort|arm\b)/i.test(
      query
    );

  let selected = query
    ? byScoreDesc.filter((item) => item.score > 0)
    : [...scoredItems].sort((a, b) => a.row.chunkIndex - b.row.chunkIndex);

  if (query && focus !== "general") {
    const focused = byScoreDesc.filter((item) => matchesFocus(item.row, focus));
    const focusedFiltered = includeAmendmentsForQuery
      ? focused
      : focused.filter((item) => !isAmendmentRow(item.row));
    const preferred = focusedFiltered.length > 0 ? focusedFiltered : focused;
    if (preferred.length >= Math.max(4, Math.ceil(limit / 2))) {
      selected = preferred;
    }
  }

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
    const maxDistance = queryNeedsCoverage ? 6 : 2;

    for (const item of scoredItems) {
      if (selectedIds.has(item.row.id)) continue;
      if (suppressAmendments && isAmendmentRow(item.row)) continue;
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
      const preferredTypeMatch = preferredChunkTypes.some((preferred) =>
        normalizeText(chunkType).includes(normalizeText(preferred))
      );
      const sectionBoostMatch = boostSections.some((section) =>
        normalizeText(`${item.row.sectionTitle || ""} ${item.row.sectionType}`).includes(normalizeText(section))
      );
      if (
        isSameSection ||
        isNearby ||
        isNearbyPage ||
        preferredTypeMatch ||
        sectionBoostMatch ||
        (queryNeedsCoverage && (tableLike || listLike))
      ) {
        selectedIds.add(item.row.id);
      }
    }

    const focusedCoverage = collectFocusedCoverageRows(chunkRows, focus, includeAmendmentsForQuery);
    focusedCoverage.forEach((rowId) => selectedIds.add(rowId));

    const cap = Math.min(72, Math.max(limit * 4, queryNeedsCoverage ? 36 : 22));
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

  if (query && suppressAmendments) {
    const canonical = selected.filter((item) => !isAmendmentRow(item.row));
    if (canonical.length > 0) {
      selected = canonical;
    }
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
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      retrievalScores: {
        lexical: lexicalScore,
        semantic: semanticScore,
      },
    };
  });
}
