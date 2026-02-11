import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  executionMaps,
  phases as legacyPhases,
  phaseTransitions as legacyPhaseTransitions,
  protocols,
  protocolSections as legacyProtocolSections,
  mapPhases,
  mapPhaseTransitions,
  taskDependencies as legacyTaskDependencies,
  taskScaffolds,
  tasks as legacyTasks,
  mapTaskDependencies,
  mapTasks,
  mapTelemetryEvents,
  protocolChunks,
  protocolMapSections,
  trials,
} from "../drizzle/schema";
import { getDb } from "./db";
import { logTelemetryEvent } from "./_core/telemetry";
import { protectedProcedure, router } from "./_core/trpc";
import { ingestProtocolContextChunks } from "./_core/protocolContext";

const MAP_STATUSES = ["draft", "active", "revised", "archived"] as const;
const TASK_STATUSES = [
  "suggested",
  "confirmed",
  "todo",
  "in_progress",
  "blocked",
  "waiting",
  "done",
  "skipped",
  "cancelled",
] as const;

const VALID_STATUS_TRANSITIONS: Record<(typeof TASK_STATUSES)[number], Array<(typeof TASK_STATUSES)[number]>> = {
  suggested: ["confirmed", "cancelled"],
  confirmed: ["todo", "cancelled"],
  todo: ["in_progress", "blocked", "waiting", "done", "skipped", "cancelled"],
  in_progress: ["todo", "done", "blocked", "waiting", "skipped", "cancelled"],
  blocked: ["todo", "in_progress", "waiting", "done", "cancelled"],
  waiting: ["todo", "in_progress", "blocked", "done", "cancelled"],
  done: ["todo", "in_progress", "blocked", "waiting"],
  skipped: ["todo", "in_progress", "cancelled"],
  cancelled: ["todo", "in_progress"],
};

function pickPreferredExecutionMap(
  rows: Array<typeof executionMaps.$inferSelect>,
  includeArchived: boolean
): typeof executionMaps.$inferSelect | null {
  const filtered = includeArchived ? rows : rows.filter((row) => row.status !== "archived");
  if (!filtered.length) return null;

  const rank: Record<(typeof MAP_STATUSES)[number], number> = {
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

  return sorted[0];
}

function sanitizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function ensureArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function ensureProtocolRefs(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const flattened = value.flatMap((item) => (Array.isArray(item) ? item : [item]));
  return flattened.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type MapTaskInsertRow = typeof mapTasks.$inferInsert;
let mapTaskConditionalNoteColumnSupport: boolean | null = null;
let mapTaskSchemaPatched = false;
let mapTaskColumnCache: Set<string> | null = null;

function truncateString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength);
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sanitizeProtocolRefs(value: unknown): Array<Record<string, unknown>> {
  const refs = ensureProtocolRefs(value);
  const normalized = refs
    .slice(0, 12)
    .map((ref) => {
      const documentId = ref.documentId ?? ref.document ?? ref.protocolId ?? null;
      const section =
        truncateString(ref.section ?? ref.sectionTitle ?? ref.sourceSection ?? null, 255) ?? "Protocol";
      const extractedText = truncateString(ref.extractedText ?? ref.text ?? ref.sourceText ?? null, 800);
      const pageRaw = ref.page ?? ref.pageNumber;
      const pageNumber =
        typeof pageRaw === "number"
          ? pageRaw
          : typeof pageRaw === "string" && pageRaw.trim()
          ? Number(pageRaw)
          : null;
      const page = Number.isFinite(pageNumber) ? Math.max(1, Math.min(9999, Math.round(pageNumber as number))) : null;

      const out: Record<string, unknown> = {
        section,
      };
      if (documentId !== null && documentId !== undefined && String(documentId).trim().length > 0) {
        out.documentId = String(documentId).slice(0, 64);
      }
      if (page !== null) out.page = page;
      if (extractedText) out.extractedText = extractedText;
      return out;
    })
    .filter((ref) => typeof ref.section === "string" && String(ref.section).trim().length > 0);

  if (normalized.length > 0) return normalized;
  return [{ section: "Protocol" }];
}

function simplifyProtocolRefs(value: unknown): Array<Record<string, unknown>> {
  return sanitizeProtocolRefs(value).slice(0, 6).map((ref) => {
    const simple: Record<string, unknown> = {
      section: ref.section ?? "Protocol",
    };
    if (ref.documentId) simple.documentId = ref.documentId;
    if (ref.page) simple.page = ref.page;
    return simple;
  });
}

function extractUnknownColumnName(message: string): string | null {
  const match = message.match(/unknown column ['`"]?([^'"`]+)['`"]?/i);
  return match?.[1] ?? null;
}

function mapDbColumnToTaskInsertProperty(columnName: string): keyof MapTaskInsertRow | null {
  const map: Record<string, keyof MapTaskInsertRow> = {
    id: "id",
    phaseId: "phaseId",
    mapId: "mapId",
    name: "name",
    description: "description",
    task_category: "category",
    task_priority: "priority",
    task_status: "status",
    blockedReason: "blockedReason",
    blockedSince: "blockedSince",
    task_role: "assignedRole",
    assignedUserId: "assignedUserId",
    suggestedAssignee: "suggestedAssignee",
    suggestedDate: "suggestedDate",
    dueDate: "dueDate",
    estimatedDuration: "estimatedDuration",
    startDate: "startDate",
    completedDate: "completedDate",
    orderInPhase: "orderInPhase",
    canvasX: "canvasX",
    canvasY: "canvasY",
    map_task_created_by: "createdBy",
    aiConfidence: "aiConfidence",
    conditionalNote: "conditionalNote",
    isCustom: "isCustom",
    tags: "tags",
    protocolRefs: "protocolRefs",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  };
  return map[columnName] ?? null;
}

function pickExistingColumn(columns: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (columns.has(candidate)) return candidate;
  }
  return null;
}

async function getMapTaskColumns(db: DbClient): Promise<Set<string>> {
  if (mapTaskColumnCache) return mapTaskColumnCache;
  const result = (await db.execute(sql.raw("SHOW COLUMNS FROM `map_tasks`"))) as unknown;
  const rows = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result && typeof result === "object" && "rows" in result
    ? ((result as { rows?: unknown }).rows ?? [])
    : [];

  const columns = new Set<string>();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const field =
        (row as { Field?: unknown }).Field ??
        (row as { field?: unknown }).field ??
        (row as Record<string, unknown>)["COLUMN_NAME"];
      if (typeof field === "string" && field.length > 0) {
        columns.add(field);
      }
    }
  }
  mapTaskColumnCache = columns;
  mapTaskConditionalNoteColumnSupport = columns.has("conditionalNote");
  return columns;
}

async function adaptiveInsertMapTask(db: DbClient, row: MapTaskInsertRow) {
  const columns = await getMapTaskColumns(db);
  const entries: Array<{ column: string; value: unknown }> = [];

  const required: Array<[string, unknown]> = [
    ["id", row.id],
    ["phaseId", row.phaseId],
    ["mapId", row.mapId],
    ["name", row.name],
    ["orderInPhase", row.orderInPhase],
    ["isCustom", row.isCustom],
  ];
  for (const [column, value] of required) {
    if (!columns.has(column)) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `map_tasks schema missing required column '${column}'`,
      });
    }
    entries.push({ column, value });
  }

  const categoryColumn = pickExistingColumn(columns, ["task_category", "category"]);
  const priorityColumn = pickExistingColumn(columns, ["task_priority", "priority"]);
  const statusColumn = pickExistingColumn(columns, ["task_status", "status"]);
  const roleColumn = pickExistingColumn(columns, ["task_role", "assignedRole"]);
  const createdByColumn = pickExistingColumn(columns, ["map_task_created_by", "createdBy"]);

  if (categoryColumn) entries.push({ column: categoryColumn, value: row.category });
  if (priorityColumn) entries.push({ column: priorityColumn, value: row.priority });
  if (statusColumn) entries.push({ column: statusColumn, value: row.status });
  if (roleColumn) entries.push({ column: roleColumn, value: row.assignedRole ?? null });
  if (createdByColumn) entries.push({ column: createdByColumn, value: row.createdBy });

  const optionalColumnValues: Array<[string, unknown]> = [
    ["description", row.description ?? null],
    ["blockedReason", row.blockedReason ?? null],
    ["blockedSince", row.blockedSince ?? null],
    ["assignedUserId", row.assignedUserId ?? null],
    ["suggestedAssignee", row.suggestedAssignee ?? null],
    ["suggestedDate", row.suggestedDate ?? null],
    ["dueDate", row.dueDate ?? null],
    ["estimatedDuration", row.estimatedDuration ?? null],
    ["startDate", row.startDate ?? null],
    ["completedDate", row.completedDate ?? null],
    ["canvasX", row.canvasX ?? null],
    ["canvasY", row.canvasY ?? null],
    ["aiConfidence", row.aiConfidence ?? null],
    ["conditionalNote", row.conditionalNote ?? null],
    ["tags", JSON.stringify(ensureArrayOfStrings(row.tags))],
    ["protocolRefs", JSON.stringify(sanitizeProtocolRefs(row.protocolRefs))],
    ["createdAt", row.createdAt ?? new Date()],
    ["updatedAt", row.updatedAt ?? new Date()],
  ];
  for (const [column, value] of optionalColumnValues) {
    if (!columns.has(column)) continue;
    entries.push({ column, value });
  }

  if (entries.length === 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No map task columns available to insert." });
  }

  const columnSql = sql.join(entries.map((entry) => sql.raw(`\`${entry.column}\``)), sql.raw(", "));
  const valueSql = sql.join(entries.map((entry) => sql`${entry.value}`), sql.raw(", "));
  await db.execute(sql`INSERT INTO \`map_tasks\` (${columnSql}) VALUES (${valueSql})`);
}

function sanitizeMapTaskInsertRow(row: MapTaskInsertRow): MapTaskInsertRow {
  const sanitized: MapTaskInsertRow = {
    ...row,
    name: truncateString(row.name, 500) ?? "Complete task",
    description: truncateString(row.description ?? null, 8000),
    blockedReason: truncateString(row.blockedReason ?? null, 4000),
    suggestedAssignee: truncateString(row.suggestedAssignee ?? null, 255),
    conditionalNote: truncateString(row.conditionalNote ?? null, 500),
    estimatedDuration:
      clampNumber(row.estimatedDuration ?? null, 1, 24 * 60) ??
      (row.estimatedDuration === null ? null : row.estimatedDuration),
    aiConfidence:
      clampNumber(row.aiConfidence ?? null, 0, 1) ??
      (row.aiConfidence === null ? null : row.aiConfidence),
    tags: ensureArrayOfStrings(row.tags).map((tag) => tag.slice(0, 64)).slice(0, 24),
    protocolRefs: sanitizeProtocolRefs(row.protocolRefs),
  };
  return sanitized;
}

async function supportsMapTaskConditionalNote(db: DbClient) {
  if (mapTaskConditionalNoteColumnSupport !== null) return mapTaskConditionalNoteColumnSupport;
  try {
    const result = (await db.execute(sql.raw("SHOW COLUMNS FROM `map_tasks` LIKE 'conditionalNote'"))) as unknown;
    const rows = Array.isArray(result)
      ? Array.isArray(result[0])
        ? result[0]
        : result
      : result && typeof result === "object" && "rows" in result
      ? ((result as { rows?: unknown }).rows ?? [])
      : [];
    mapTaskConditionalNoteColumnSupport = Array.isArray(rows) && rows.length > 0;
  } catch {
    // Conservative fallback for drifted local DBs: omit optional column writes.
    mapTaskConditionalNoteColumnSupport = false;
  }
  return mapTaskConditionalNoteColumnSupport;
}

async function patchMapTasksSchemaIfNeeded(db: DbClient, missingColumn: string) {
  if (mapTaskSchemaPatched) return;
  if (missingColumn !== "conditionalNote") return;
  try {
    await db.execute(sql.raw("ALTER TABLE `map_tasks` ADD COLUMN `conditionalNote` text"));
    mapTaskConditionalNoteColumnSupport = true;
    mapTaskColumnCache = null;
    mapTaskSchemaPatched = true;
    console.warn("[map.schema] added missing `conditionalNote` column to map_tasks");
  } catch (error) {
    const message = String(
      (error as { cause?: { sqlMessage?: string } })?.cause?.sqlMessage ??
        (error as Error)?.message ??
        "unknown error"
    );
    // Safe to ignore if already exists due race / concurrent worker.
    if (/duplicate column|already exists/i.test(message)) {
      mapTaskConditionalNoteColumnSupport = true;
      mapTaskColumnCache = null;
      mapTaskSchemaPatched = true;
      return;
    }
    console.warn("[map.schema] failed to patch map_tasks schema", message);
  }
}

async function insertMapTaskWithFallback(db: DbClient, row: MapTaskInsertRow, contextLabel: string) {
  const sanitized = sanitizeMapTaskInsertRow(row);
  const canWriteConditionalNote = await supportsMapTaskConditionalNote(db);
  const baseRow: Record<string, unknown> = {
    ...sanitized,
  };
  if (!canWriteConditionalNote) {
    delete baseRow.conditionalNote;
  }
  const retryRow: Record<string, unknown> = {
    ...baseRow,
  };
  let simplified = false;
  let attempts = 0;
  let lastError: unknown = null;

  while (attempts < 6) {
    attempts += 1;
    try {
      await adaptiveInsertMapTask(db, retryRow as MapTaskInsertRow);
      return;
    } catch (error) {
      lastError = error;
      const message = String(
        (error as { cause?: { sqlMessage?: string } })?.cause?.sqlMessage ??
          (error as Error)?.message ??
          "unknown error"
      );

      const unknownColumn = extractUnknownColumnName(message);
      if (unknownColumn) {
        await patchMapTasksSchemaIfNeeded(db, unknownColumn);
        const property = mapDbColumnToTaskInsertProperty(unknownColumn);
        if (property && property in retryRow) {
          delete retryRow[property];
          continue;
        }
      }

      if (!simplified && /data too long|incorrect string value|json/i.test(message)) {
        retryRow.protocolRefs = simplifyProtocolRefs(retryRow.protocolRefs);
        retryRow.description = truncateString(retryRow.description, 2000);
        retryRow.tags = [];
        retryRow.suggestedAssignee = truncateString(retryRow.suggestedAssignee, 120);
        retryRow.name = truncateString(retryRow.name, 255) ?? "Complete task";
        simplified = true;
        continue;
      }

      break;
    }
  }

  const finalMessage = String(
    (lastError as { cause?: { sqlMessage?: string } })?.cause?.sqlMessage ??
      (lastError as Error)?.message ??
      "unknown error"
  );
  console.error("[map.insertTask] failed", {
    context: contextLabel,
    mapId: row.mapId,
    phaseId: row.phaseId,
    name: row.name,
    protocolRefsBytes: JSON.stringify(row.protocolRefs ?? []).length,
    reason: finalMessage,
  });
  throw lastError;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferPhaseTypeFromName(
  name: string
):
  | "screening"
  | "baseline"
  | "treatment_visit"
  | "follow_up"
  | "end_of_study"
  | "unscheduled"
  | "screen_fail"
  | "early_termination"
  | "custom" {
  const normalized = normalizeText(name);
  if (normalized.includes("screen fail")) return "screen_fail";
  if (normalized.includes("screen")) return "screening";
  if (normalized.includes("baseline")) return "baseline";
  if (normalized.includes("follow up") || normalized.includes("followup")) return "follow_up";
  if (normalized.includes("end of study")) return "end_of_study";
  if (normalized.includes("early termination")) return "early_termination";
  if (normalized.includes("visit")) return "treatment_visit";
  return "custom";
}

function inferSectionTypeFromName(
  name: string
): "schedule" | "eligibility" | "procedure" | "safety" | "medication" | "randomization" | "lab" | "custom" {
  const normalized = normalizeText(name);
  if (normalized.includes("schedule")) return "schedule";
  if (normalized.includes("eligibility") || normalized.includes("inclusion") || normalized.includes("exclusion")) {
    return "eligibility";
  }
  if (normalized.includes("safety") || normalized.includes("ae")) return "safety";
  if (normalized.includes("medication") || normalized.includes("drug")) return "medication";
  if (normalized.includes("random")) return "randomization";
  if (normalized.includes("lab")) return "lab";
  if (normalized.includes("procedure") || normalized.includes("visit")) return "procedure";
  return "custom";
}

function colorToHex(value: string | null | undefined): string {
  const normalized = normalizeText(value);
  const map: Record<string, string> = {
    blue: "#3B82F6",
    green: "#10B981",
    yellow: "#F59E0B",
    red: "#EF4444",
    purple: "#8B5CF6",
    orange: "#F97316",
    teal: "#14B8A6",
  };
  if (!normalized) return "#3B82F6";
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  return map[normalized] ?? "#3B82F6";
}

function extractPageStart(reference: string | null | undefined): number | null {
  if (!reference) return null;
  const match = reference.match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateFromReference(reference: string | null | undefined): Date | null {
  if (!reference) return null;
  const parsed = new Date(reference);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, offset: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + offset);
  return next;
}

function parseMaybeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfDay(parsed);
}

function inferPhaseOffsetDays(phaseName: string, phaseIndex: number): number {
  const text = String(phaseName || "").toLowerCase();

  const cXdY = text.match(/c(?:ycle)?\s*(\d+)\s*d(?:ay)?\s*(\d+)/i);
  if (cXdY) {
    const cycle = Math.max(1, Number(cXdY[1]));
    const day = Math.max(1, Number(cXdY[2]));
    return (cycle - 1) * 28 + (day - 1);
  }

  const cycleDay = text.match(/cycle\s*(\d+).*day\s*(-?\d+)/i);
  if (cycleDay) {
    const cycle = Math.max(1, Number(cycleDay[1]));
    const day = Number(cycleDay[2]);
    return (cycle - 1) * 28 + (day >= 1 ? day - 1 : day);
  }

  const dayOnly = text.match(/day\s*(-?\d+)/i);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    return day >= 1 ? day - 1 : day;
  }

  const week = text.match(/week\s*(\d+)/i);
  if (week) {
    return (Math.max(1, Number(week[1])) - 1) * 7;
  }

  if (text.includes("screen")) return -14;
  if (text.includes("baseline")) return 0;
  if (text.includes("end of treatment") || text.includes("eot")) return 56;
  if (text.includes("follow")) {
    const followDay = text.match(/(\d+)\s*day/i);
    if (followDay) return Number(followDay[1]) - 1;
    return 90 + phaseIndex * 7;
  }

  const cycle = text.match(/cycle\s*(\d+)/i);
  if (cycle) return (Math.max(1, Number(cycle[1])) - 1) * 28;

  return phaseIndex * 7;
}

function inferTimingWindow(phaseName: string, phaseIndex: number, contextText: string) {
  const phaseText = String(phaseName || "").toLowerCase();
  const text = `${phaseText} ${String(contextText || "").toLowerCase()}`;
  const isFollowPhase = /(follow|end of treatment|eot|termination)/.test(phaseText);
  const isScreenPhase = /(screen)/.test(phaseText);
  const anchorOffset = inferPhaseOffsetDays(phaseName, phaseIndex);

  const anchorDayToken = text.match(/\bday\s*(-?\d{1,3})\b/i);
  const anchorDay = anchorDayToken ? Number(anchorDayToken[1]) : null;
  const anchorFromText =
    anchorDay !== null && Number.isFinite(anchorDay) ? (anchorDay >= 1 ? anchorDay - 1 : anchorDay) : null;
  const resolvedAnchor = anchorFromText ?? anchorOffset;

  const rangeMatch =
    text.match(/(?:window[^a-z0-9-+]{0,12})?(?:day\s*)?(-?\d{1,3})\s*(?:to|[-–])\s*(?:day\s*)?(-?\d{1,3})\b/i) ||
    text.match(/day\s*(-?\d{1,3})\s*(?:to|[-–])\s*day?\s*(-?\d{1,3})\b/i);
  if (rangeMatch) {
    const rawA = Number(rangeMatch[1]);
    const rawB = Number(rangeMatch[2]);
    const minRaw = Math.min(rawA, rawB);
    const maxRaw = Math.max(rawA, rawB);
    const startOffset = minRaw >= 1 ? minRaw - 1 : minRaw;
    const endOffset = maxRaw >= 1 ? maxRaw - 1 : maxRaw;
    return { anchorOffset: resolvedAnchor, startOffset, endOffset };
  }

  if (isFollowPhase) {
    const followRange = text.match(/(\d{1,3})\s*(?:and|&)\s*(\d{1,3})\s*day/i);
    if (followRange) {
      const rawA = Number(followRange[1]);
      const rawB = Number(followRange[2]);
      const startOffset = Math.min(rawA, rawB) - 1;
      const endOffset = Math.max(rawA, rawB) - 1;
      return { anchorOffset: resolvedAnchor, startOffset, endOffset };
    }
  }

  const plusMinus = text.match(/[±\u00b1]\s*(\d+)\s*day/i);
  if (plusMinus) {
    let delta = Math.max(0, Number(plusMinus[1]));
    if (isScreenPhase) delta = Math.min(delta, 3);
    else if (!isFollowPhase) delta = Math.min(delta, 7);
    return {
      anchorOffset: resolvedAnchor,
      startOffset: resolvedAnchor - delta,
      endOffset: resolvedAnchor + delta,
    };
  }

  const plusOnly = text.match(/\+\s*(\d+)\s*day/i);
  if (plusOnly) {
    let delta = Math.max(0, Number(plusOnly[1]));
    if (isScreenPhase) delta = Math.min(delta, 3);
    else if (!isFollowPhase) delta = Math.min(delta, 7);
    return {
      anchorOffset: resolvedAnchor,
      startOffset: resolvedAnchor,
      endOffset: resolvedAnchor + delta,
    };
  }

  const minusOnly = text.match(/-\s*(\d+)\s*day/i);
  if (minusOnly) {
    let delta = Math.max(0, Number(minusOnly[1]));
    if (isScreenPhase) delta = Math.min(delta, 3);
    else if (!isFollowPhase) delta = Math.min(delta, 7);
    return {
      anchorOffset: resolvedAnchor,
      startOffset: resolvedAnchor - delta,
      endOffset: resolvedAnchor,
    };
  }

  return { anchorOffset: resolvedAnchor, startOffset: resolvedAnchor, endOffset: resolvedAnchor };
}

function deriveTaskSchedule(
  trialStartDate: Date,
  phaseName: string,
  phaseIndex: number,
  contextText: string,
  explicitSuggestedDate: Date | string | null | undefined
) {
  const timing = inferTimingWindow(phaseName, phaseIndex, contextText);
  const explicitAnchor = parseMaybeDate(explicitSuggestedDate);
  const suggestedDate = explicitAnchor ?? addDays(trialStartDate, timing.anchorOffset);
  const startDate = explicitAnchor
    ? addDays(suggestedDate, timing.startOffset - timing.anchorOffset)
    : addDays(trialStartDate, timing.startOffset);
  const dueCandidate = explicitAnchor
    ? addDays(suggestedDate, timing.endOffset - timing.anchorOffset)
    : addDays(trialStartDate, timing.endOffset);
  const dueDate = dueCandidate < startDate ? startDate : dueCandidate;
  return { suggestedDate, startDate, dueDate };
}

const ACTION_VERBS = [
  "obtain",
  "verify",
  "review",
  "draw",
  "collect",
  "record",
  "perform",
  "administer",
  "assess",
  "complete",
  "submit",
  "schedule",
  "notify",
  "document",
  "enter",
  "monitor",
  "prepare",
  "randomize",
] as const;

function startsWithActionVerb(name: string) {
  const normalized = normalizeText(name);
  return ACTION_VERBS.some((verb) => normalized.startsWith(`${verb} `));
}

function inferTaskCategory(taskName: string, protocolSection?: string | null) {
  const text = `${taskName} ${protocolSection ?? ""}`.toLowerCase();
  if (/(consent|re-consent|informed consent)/.test(text)) return "consent" as const;
  if (/(eligib|inclusion|exclusion|screen fail|randomization eligibility)/.test(text)) {
    return "eligibility" as const;
  }
  if (/(blood|sample|lab|cbc|chemistry|biomarker|urine|pk|pharmacokinetic|tube)/.test(text)) {
    return "lab_sample" as const;
  }
  if (/(vital|blood pressure|temperature|heart rate|pulse|weight)/.test(text)) return "vital_signs" as const;
  if (/(ct|mri|x-ray|pet|recist|imaging|scan|biopsy imaging)/.test(text)) return "imaging" as const;
  if (/(dose|dosing|drug|infusion|injection|administer|dispense|ip|irt)/.test(text)) {
    return "drug_administration" as const;
  }
  if (/(exam|ecg|eeg|assessment|eCOG|performance status|physical)/.test(text)) return "assessment" as const;
  if (/(questionnaire|qol|pro|patient-reported)/.test(text)) return "questionnaire" as const;
  if (/(edc|crf|data entry|source doc|query|ctms)/.test(text)) return "data_entry" as const;
  if (/(schedule|coordination|randomization|irt|notify|handoff|appointment)/.test(text)) {
    return "coordination" as const;
  }
  if (/(safety|ae|sae|adverse event|observation|monitor)/.test(text)) return "safety_reporting" as const;
  if (/(irb|ethics|regulatory|submission)/.test(text)) return "regulatory" as const;
  if (/(follow up|follow-up|eot|end of study|termination call)/.test(text)) return "follow_up" as const;
  if (/(document|filing|archive|binder)/.test(text)) return "documentation" as const;
  return "custom" as const;
}

function inferAssignedRole(
  category:
    | "consent"
    | "eligibility"
    | "lab_sample"
    | "vital_signs"
    | "imaging"
    | "drug_administration"
    | "assessment"
    | "questionnaire"
    | "data_entry"
    | "coordination"
    | "documentation"
    | "follow_up"
    | "safety_reporting"
    | "regulatory"
    | "custom",
  taskName: string
) {
  const text = taskName.toLowerCase();
  if (category === "consent") return "pi" as const;
  if (category === "eligibility") return "crc" as const;
  if (category === "lab_sample") return text.includes("process") || text.includes("ship") ? ("lab_tech" as const) : ("nurse" as const);
  if (category === "vital_signs") return "nurse" as const;
  if (category === "imaging") return "nurse" as const;
  if (category === "drug_administration") {
    if (/(prepare|dispense|accountability)/.test(text)) return "pharmacist" as const;
    return "nurse" as const;
  }
  if (category === "assessment") return /(physical|medical|ae|sae|exam)/.test(text) ? ("pi" as const) : ("sub_i" as const);
  if (category === "questionnaire") return "crc" as const;
  if (category === "data_entry") return "crc" as const;
  if (category === "coordination") return "crc" as const;
  if (category === "documentation") return "crc" as const;
  if (category === "follow_up") return "crc" as const;
  if (category === "safety_reporting") return "pi" as const;
  if (category === "regulatory") return "regulatory_coordinator" as const;
  return "custom" as const;
}

function inferPriority(
  category:
    | "consent"
    | "eligibility"
    | "lab_sample"
    | "vital_signs"
    | "imaging"
    | "drug_administration"
    | "assessment"
    | "questionnaire"
    | "data_entry"
    | "coordination"
    | "documentation"
    | "follow_up"
    | "safety_reporting"
    | "regulatory"
    | "custom",
  taskName: string
) {
  const text = taskName.toLowerCase();
  if (/(sae|serious adverse|informed consent|drug administration|dlt|critical safety)/.test(text)) {
    return "critical" as const;
  }
  if (["consent", "eligibility", "drug_administration", "safety_reporting", "lab_sample"].includes(category)) {
    return "high" as const;
  }
  if (category === "documentation" || category === "coordination" || category === "data_entry") return "medium" as const;
  return "medium" as const;
}

function inferEstimatedDuration(
  category:
    | "consent"
    | "eligibility"
    | "lab_sample"
    | "vital_signs"
    | "imaging"
    | "drug_administration"
    | "assessment"
    | "questionnaire"
    | "data_entry"
    | "coordination"
    | "documentation"
    | "follow_up"
    | "safety_reporting"
    | "regulatory"
    | "custom",
  taskName: string,
  legacyDuration?: number | null
) {
  if (legacyDuration && Number.isFinite(legacyDuration)) {
    if (legacyDuration > 45) return Math.round(legacyDuration);
    if (legacyDuration >= 1 && legacyDuration <= 8) return Math.round(legacyDuration * 15);
  }

  const text = taskName.toLowerCase();
  if (text.includes("informed consent")) return 45;
  if (/(iv infusion|infusion)/.test(text)) return 120;
  if (/(observation|post-dose)/.test(text)) return 60;
  if (/(physical exam|medical assessment)/.test(text)) return 30;
  if (/(ecg|eeg)/.test(text)) return 12;
  if (/(blood|sample|cbc|chemistry|biomarker)/.test(text)) return 12;
  if (/(edc|crf|data entry)/.test(text)) return 20;
  if (/(randomization|irt)/.test(text)) return 12;

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

function inferConditionalNote(taskName: string) {
  const lower = taskName.toLowerCase();
  if (lower.includes("arm b")) return "Arm B only";
  if (lower.includes("arm a")) return "Arm A only";
  if (/(female|pregnancy|childbearing)/.test(lower)) return "Females of childbearing potential only";
  if (/(if|only when|only if)/.test(lower)) return taskName;
  return null;
}

function ensureActionVerbName(taskName: string, category: string) {
  const trimmed = taskName.trim();
  if (!trimmed) return "Complete task";
  if (startsWithActionVerb(trimmed)) return trimmed;

  const fallbackVerbByCategory: Record<string, string> = {
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
  const verb = fallbackVerbByCategory[category] ?? "Complete";
  return `${verb} ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function overlapScore(a: string, b: string) {
  const aTerms = new Set(a.split(" ").filter((term) => term.length > 2));
  const bTerms = new Set(b.split(" ").filter((term) => term.length > 2));
  let score = 0;
  for (const term of Array.from(aTerms)) {
    if (bTerms.has(term)) score += 1;
  }
  return score;
}

function assertAiTaskTraceability(input: {
  createdBy?: "ai" | "user";
  isCustom?: boolean;
  protocolRefs?: unknown;
}) {
  const createdBy = input.createdBy ?? "ai";
  const isCustom = input.isCustom ?? false;
  if (createdBy === "ai" && !isCustom) {
    const refs = ensureProtocolRefs(input.protocolRefs);
    if (refs.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "AI-generated non-custom tasks must include at least one protocol reference.",
      });
    }
  }
}

async function trackMapEvent(input: {
  mapId: string;
  trialId: string;
  eventType: string;
  userId?: number | null;
  targetId?: string | null;
  targetType?: "task" | "phase" | "dependency" | "map" | null;
  payload?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(mapTelemetryEvents).values({
      id: randomUUID(),
      mapId: input.mapId,
      trialId: input.trialId,
      eventType: input.eventType,
      userId: input.userId ?? null,
      targetId: input.targetId ?? null,
      targetType: input.targetType ?? null,
      payload: input.payload ?? {},
      createdAt: new Date(),
    });
  } catch (error) {
    console.warn("[map.telemetry] failed to persist map telemetry event", error);
  }

  try {
    await logTelemetryEvent({
      eventType: input.eventType,
      action: "map_event",
      userId: input.userId ? String(input.userId) : null,
      entityType: input.targetType ?? "map",
      entityId: input.targetId ?? input.mapId,
      payload: {
        mapId: input.mapId,
        trialId: input.trialId,
        ...(input.payload || {}),
      },
      aiInvolved: /ai|suggested|map\.generated|map\.launched/i.test(input.eventType),
    });
  } catch (error) {
    console.warn("[map.telemetry] failed to mirror event into global telemetry", error);
  }
}

async function getMapByIdOrThrow(mapId: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

  const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, mapId)).limit(1);
  if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });
  return { db, map };
}

async function normalizeTaskOrder(db: Awaited<ReturnType<typeof getDb>>, phaseId: string) {
  if (!db) return;
  const rows = await db
    .select({ id: mapTasks.id })
    .from(mapTasks)
    .where(eq(mapTasks.phaseId, phaseId))
    .orderBy(asc(mapTasks.orderInPhase), asc(mapTasks.createdAt));
  for (let i = 0; i < rows.length; i += 1) {
    await db.update(mapTasks).set({ orderInPhase: i }).where(eq(mapTasks.id, rows[i].id));
  }
}

async function wouldCreateDependencyCycle(input: { sourceTaskId: string; targetTaskId: string }) {
  if (input.sourceTaskId === input.targetTaskId) return true;
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

  const [sourceTask] = await db
    .select({ id: mapTasks.id, mapId: mapTasks.mapId })
    .from(mapTasks)
    .where(eq(mapTasks.id, input.sourceTaskId))
    .limit(1);
  const [targetTask] = await db
    .select({ id: mapTasks.id, mapId: mapTasks.mapId })
    .from(mapTasks)
    .where(eq(mapTasks.id, input.targetTaskId))
    .limit(1);

  if (!sourceTask || !targetTask) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Dependency tasks not found" });
  }
  if (sourceTask.mapId !== targetTask.mapId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cross-map dependencies are not allowed" });
  }

  const mapTaskRows = await db
    .select({ id: mapTasks.id })
    .from(mapTasks)
    .where(eq(mapTasks.mapId, sourceTask.mapId));
  const taskIds = mapTaskRows.map((row) => row.id);
  if (taskIds.length === 0) return false;

  const depRows = await db
    .select({ sourceTaskId: mapTaskDependencies.sourceTaskId, targetTaskId: mapTaskDependencies.targetTaskId })
    .from(mapTaskDependencies)
    .where(
      or(
        inArray(mapTaskDependencies.sourceTaskId, taskIds),
        inArray(mapTaskDependencies.targetTaskId, taskIds)
      )
    );

  const adjacency = new Map<string, string[]>();
  for (const row of depRows) {
    const current = adjacency.get(row.sourceTaskId) ?? [];
    current.push(row.targetTaskId);
    adjacency.set(row.sourceTaskId, current);
  }
  const pending = adjacency.get(input.sourceTaskId) ?? [];
  pending.push(input.targetTaskId);
  adjacency.set(input.sourceTaskId, pending);

  const seen = new Set<string>();
  const stack = [input.targetTaskId];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === input.sourceTaskId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    const next = adjacency.get(node) ?? [];
    for (const child of next) stack.push(child);
  }
  return false;
}

const mapMetadataSchema = z
  .object({
    protocolTitle: z.string().optional(),
    sponsor: z.string().optional(),
    indication: z.string().optional(),
    totalTasks: z.number().optional(),
    totalPhases: z.number().optional(),
    estimatedDurationDays: z.number().optional(),
    generatedBy: z.enum(["ai", "manual", "hybrid"]).optional(),
    aiConfidenceScore: z.number().min(0).max(1).optional(),
    lastAmendmentId: z.string().nullable().optional(),
  })
  .catchall(z.unknown());

const taskPatchSchema = z
  .object({
    name: z.string().max(500).optional(),
    description: z.string().optional(),
    category: z
      .enum([
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
      ])
      .optional(),
    priority: z.enum(["critical", "high", "medium", "low"]).optional(),
    assignedRole: z
      .enum([
        "pi",
        "sub_i",
        "crc",
        "nurse",
        "pharmacist",
        "lab_tech",
        "data_manager",
        "regulatory_coordinator",
        "study_coordinator",
        "custom",
      ])
      .nullable()
      .optional(),
    assignedUserId: z.number().nullable().optional(),
    suggestedAssignee: z.string().nullable().optional(),
    suggestedDate: z.string().datetime().nullable().optional(),
    dueDate: z.string().datetime().nullable().optional(),
    estimatedDuration: z.number().nullable().optional(),
    conditionalNote: z.string().nullable().optional(),
    canvasX: z.number().nullable().optional(),
    canvasY: z.number().nullable().optional(),
    tags: z.array(z.string()).optional(),
    protocolRefs: z.array(z.record(z.string(), z.unknown())).optional(),
    isCustom: z.boolean().optional(),
    createdBy: z.enum(["ai", "user"]).optional(),
  })
  .refine(
    (input) => {
      if (input.createdBy === "ai" && input.isCustom !== true && input.protocolRefs) {
        return input.protocolRefs.length > 0;
      }
      return true;
    },
    { message: "AI-generated tasks must include protocolRefs" }
  );

export const mapRouter = router({
  getByTrial: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        includeArchived: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const rows = await db
        .select()
        .from(executionMaps)
        .where(eq(executionMaps.trialId, input.trialId))
        .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));

      return pickPreferredExecutionMap(rows, Boolean(input.includeArchived));
    }),

  loadWorkspace: protectedProcedure
    .input(
      z.object({
        trialIds: z.array(z.string()).default([]),
        includeArchived: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const uniqueTrialIds = Array.from(
        new Set(input.trialIds.map((trialId) => trialId.trim()).filter((trialId) => trialId.length > 0))
      );
      if (!uniqueTrialIds.length) return [];

      const rows = await db
        .select()
        .from(executionMaps)
        .where(inArray(executionMaps.trialId, uniqueTrialIds))
        .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version));

      const selectedMaps = uniqueTrialIds
        .map((trialId) => {
          const perTrial = rows.filter((row) => row.trialId === trialId);
          return pickPreferredExecutionMap(perTrial, Boolean(input.includeArchived));
        })
        .filter(Boolean) as Array<typeof executionMaps.$inferSelect>;

      if (!selectedMaps.length) return [];

      const mapIds = selectedMaps.map((map) => map.id);

      const phases = await db
        .select()
        .from(mapPhases)
        .where(inArray(mapPhases.mapId, mapIds))
        .orderBy(asc(mapPhases.mapId), asc(mapPhases.displayOrder));

      const tasks = await db
        .select()
        .from(mapTasks)
        .where(inArray(mapTasks.mapId, mapIds))
        .orderBy(asc(mapTasks.mapId), asc(mapTasks.phaseId), asc(mapTasks.orderInPhase));

      const taskIds = tasks.map((task) => task.id);
      const phaseIds = phases.map((phase) => phase.id);

      const dependencies =
        taskIds.length > 0
          ? await db
              .select()
              .from(mapTaskDependencies)
              .where(
                or(
                  inArray(mapTaskDependencies.sourceTaskId, taskIds),
                  inArray(mapTaskDependencies.targetTaskId, taskIds)
                )
              )
          : [];

      const transitions =
        phaseIds.length > 0
          ? await db
              .select()
              .from(mapPhaseTransitions)
              .where(
                or(
                  inArray(mapPhaseTransitions.fromPhaseId, phaseIds),
                  inArray(mapPhaseTransitions.toPhaseId, phaseIds)
                )
              )
          : [];

      const protocolSections = await db
        .select()
        .from(protocolMapSections)
        .where(inArray(protocolMapSections.mapId, mapIds))
        .orderBy(asc(protocolMapSections.mapId), asc(protocolMapSections.displayOrder));

      const mapIdByTaskId = new Map(tasks.map((task) => [task.id, task.mapId]));
      const mapIdByPhaseId = new Map(phases.map((phase) => [phase.id, phase.mapId]));

      return selectedMaps.map((map) => ({
        map,
        phases: phases.filter((phase) => phase.mapId === map.id),
        tasks: tasks.filter((task) => task.mapId === map.id),
        dependencies: dependencies.filter(
          (dep) =>
            mapIdByTaskId.get(dep.sourceTaskId) === map.id && mapIdByTaskId.get(dep.targetTaskId) === map.id
        ),
        transitions: transitions.filter(
          (transition) =>
            mapIdByPhaseId.get(transition.fromPhaseId) === map.id &&
            mapIdByPhaseId.get(transition.toPhaseId) === map.id
        ),
        protocolMapSections: protocolSections.filter((section) => section.mapId === map.id),
      }));
    }),

  importLegacyScaffold: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        protocolId: z.number(),
        mapId: z.string().optional(),
        clearExisting: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [legacyScaffold] = await db
        .select()
        .from(taskScaffolds)
        .where(eq(taskScaffolds.protocolId, input.protocolId))
        .orderBy(desc(taskScaffolds.createdAt))
        .limit(1);

      if (!legacyScaffold) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No legacy scaffold found for this protocol. Generate the scaffold first.",
        });
      }

      const [trial] = await db.select().from(trials).where(eq(trials.id, input.trialId)).limit(1);
      const [protocol] = await db.select().from(protocols).where(eq(protocols.id, input.protocolId)).limit(1);

      let targetMap: typeof executionMaps.$inferSelect | undefined;
      if (input.mapId) {
        const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, input.mapId)).limit(1);
        if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Execution map not found" });
        if (map.trialId !== input.trialId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Map does not belong to this trial" });
        }
        targetMap = map;
      } else {
        const [map] = await db
          .select()
          .from(executionMaps)
          .where(
            and(
              eq(executionMaps.trialId, input.trialId),
              eq(executionMaps.protocolId, input.protocolId),
              or(eq(executionMaps.status, "draft"), eq(executionMaps.status, "revised"))
            )
          )
          .orderBy(desc(executionMaps.updatedAt), desc(executionMaps.version))
          .limit(1);
        targetMap = map;
      }

      if (!targetMap) {
        const mapId = randomUUID();
        const metadata = {
          protocolTitle: trial?.title ?? protocol?.filename ?? "",
          sponsor: trial?.sponsor ?? "",
          indication: trial?.indication ?? "",
          generatedBy: "hybrid",
          totalTasks: 0,
          totalPhases: 0,
        };
        await db.insert(executionMaps).values({
          id: mapId,
          trialId: input.trialId,
          protocolId: input.protocolId,
          status: "draft",
          version: 1,
          metadata,
          createdBy: ctx.user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const [created] = await db.select().from(executionMaps).where(eq(executionMaps.id, mapId)).limit(1);
        targetMap = created;
      }

      if (!targetMap) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create map" });
      }

      const trialTimelineAnchor =
        parseMaybeDate(trial?.startDate) ?? parseMaybeDate(targetMap.createdAt) ?? startOfDay(new Date());

      const clearExisting = input.clearExisting ?? true;
      if (clearExisting) {
        const mapPhaseRows = await db
          .select({ id: mapPhases.id })
          .from(mapPhases)
          .where(eq(mapPhases.mapId, targetMap.id));
        const mapTaskRows = await db
          .select({ id: mapTasks.id })
          .from(mapTasks)
          .where(eq(mapTasks.mapId, targetMap.id));

        const mapTaskIds = mapTaskRows.map((row) => row.id);
        const mapPhaseIds = mapPhaseRows.map((row) => row.id);

        if (mapTaskIds.length > 0) {
          await db
            .delete(mapTaskDependencies)
            .where(
              or(
                inArray(mapTaskDependencies.sourceTaskId, mapTaskIds),
                inArray(mapTaskDependencies.targetTaskId, mapTaskIds)
              )
            );
          await db.delete(mapTasks).where(eq(mapTasks.mapId, targetMap.id));
        }

        if (mapPhaseIds.length > 0) {
          await db
            .delete(mapPhaseTransitions)
            .where(
              or(
                inArray(mapPhaseTransitions.fromPhaseId, mapPhaseIds),
                inArray(mapPhaseTransitions.toPhaseId, mapPhaseIds)
              )
            );
          await db.delete(mapPhases).where(eq(mapPhases.mapId, targetMap.id));
        }

        await db.delete(protocolMapSections).where(eq(protocolMapSections.mapId, targetMap.id));
      }

      const legacyPhaseRows = await db
        .select()
        .from(legacyPhases)
        .where(eq(legacyPhases.scaffoldId, legacyScaffold.id))
        .orderBy(asc(legacyPhases.orderIndex), asc(legacyPhases.createdAt));

      await ingestProtocolContextChunks({
        protocolId: input.protocolId,
        forceRefresh: false,
      }).catch((error) => {
        console.warn("[map.importLegacyScaffold] failed to refresh protocol chunks", error);
      });

      const contextChunkRows = await db
        .select()
        .from(protocolChunks)
        .where(eq(protocolChunks.protocolId, input.protocolId))
        .orderBy(asc(protocolChunks.chunkIndex));

      const findBestContextRef = (taskName: string, protocolSection: string | null, protocolPage: number | null) => {
        const normalizedTask = normalizeText(taskName);
        const normalizedSection = normalizeText(protocolSection || "");
        let best:
          | {
              section: string;
              page: number | undefined;
              extractedText: string | undefined;
              confidence: number;
            }
          | null = null;

        for (const row of contextChunkRows) {
          const rowSection = normalizeText(row.sectionTitle ?? "");
          const rowText = normalizeText(row.chunkText);
          let score = 0;
          if (normalizedSection && (rowSection.includes(normalizedSection) || normalizedSection.includes(rowSection))) {
            score += 6;
          }
          score += Math.min(overlapScore(normalizedTask, rowText), 5);
          if (protocolPage && row.pageStart && Math.abs(row.pageStart - protocolPage) <= 2) {
            score += 4;
          }
          if (score <= 0) continue;
          const confidence = Math.min(0.98, 0.72 + score * 0.03);
          if (!best || confidence > best.confidence) {
            best = {
              section: row.sectionTitle || protocolSection || "Protocol",
              page: row.pageStart ?? protocolPage ?? undefined,
              extractedText: row.chunkText.slice(0, 300),
              confidence,
            };
          }
        }
        return best;
      };

      const legacyPhaseIdToMapPhaseId = new Map<number, string>();
      const legacyTaskIdToMapTaskId = new Map<number, string>();
      const legacyTaskToLegacyPhase = new Map<number, number>();
      const createdMapTasks: Array<{
        id: string;
        phaseId: string;
        protocolRefs: Array<Record<string, unknown>>;
        category:
          | "consent"
          | "eligibility"
          | "lab_sample"
          | "vital_signs"
          | "imaging"
          | "drug_administration"
          | "assessment"
          | "questionnaire"
          | "data_entry"
          | "coordination"
          | "documentation"
          | "follow_up"
          | "safety_reporting"
          | "regulatory"
          | "custom";
        name: string;
      }> = [];

      for (let legacyPhaseIndex = 0; legacyPhaseIndex < legacyPhaseRows.length; legacyPhaseIndex += 1) {
        const legacyPhase = legacyPhaseRows[legacyPhaseIndex];
        const newPhaseId = randomUUID();
        legacyPhaseIdToMapPhaseId.set(legacyPhase.id, newPhaseId);
        await db.insert(mapPhases).values({
          id: newPhaseId,
          mapId: targetMap.id,
          name: legacyPhase.name,
          phaseType: inferPhaseTypeFromName(legacyPhase.name),
          displayOrder: legacyPhase.orderIndex,
          color: colorToHex(legacyPhase.color),
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        const legacyPhaseTasks = await db
          .select()
          .from(legacyTasks)
          .where(eq(legacyTasks.phaseId, legacyPhase.id))
          .orderBy(asc(legacyTasks.orderIndex), asc(legacyTasks.createdAt));

        for (const legacyTask of legacyPhaseTasks) {
          const newTaskId = randomUUID();
          legacyTaskIdToMapTaskId.set(legacyTask.id, newTaskId);
          legacyTaskToLegacyPhase.set(legacyTask.id, legacyPhase.id);
          const category = inferTaskCategory(legacyTask.name, legacyTask.protocolSection);
          const assignedRole = inferAssignedRole(category, legacyTask.name);
          const priority = inferPriority(category, legacyTask.name);
          const normalizedName = ensureActionVerbName(legacyTask.name, category);
          const protocolContextRef = findBestContextRef(
            normalizedName,
            legacyTask.protocolSection,
            legacyTask.protocolPage
          );
          const protocolRefs = protocolContextRef
            ? [
                {
                  documentId: input.protocolId,
                  section: protocolContextRef.section,
                  page: protocolContextRef.page,
                  extractedText: protocolContextRef.extractedText,
                },
              ]
            : legacyTask.protocolSection || legacyTask.protocolPage
            ? [
                {
                  documentId: input.protocolId,
                  section: legacyTask.protocolSection ?? legacyPhase.name,
                  page: legacyTask.protocolPage ?? undefined,
                },
              ]
            : [
                {
                  documentId: input.protocolId,
                  section: legacyPhase.name,
                },
              ];
          const aiConfidence = protocolContextRef
            ? protocolContextRef.confidence
            : legacyTask.protocolSection || legacyTask.protocolPage
            ? 0.9
            : 0.8;
          const conditionalNote = inferConditionalNote(normalizedName);
          const schedulingContext = [
            legacyPhase.name,
            normalizedName,
            legacyTask.protocolSection ?? "",
            protocolContextRef?.section ?? "",
            protocolContextRef?.extractedText ?? "",
          ]
            .filter(Boolean)
            .join(" ");
          const schedule = deriveTaskSchedule(
            trialTimelineAnchor,
            legacyPhase.name,
            legacyPhaseIndex,
            schedulingContext,
            legacyTask.suggestedDate
          );

          await insertMapTaskWithFallback(
            db,
            {
              id: newTaskId,
              phaseId: newPhaseId,
              mapId: targetMap.id,
              name: normalizedName,
              description: null,
            category,
            priority,
            status: legacyTask.status === "completed" ? "confirmed" : "suggested",
            blockedReason: null,
            blockedSince: null,
            assignedRole,
            assignedUserId: legacyTask.suggestedAssigneeId ?? null,
            suggestedAssignee: null,
            suggestedDate: schedule.suggestedDate,
            dueDate: schedule.dueDate,
            estimatedDuration: inferEstimatedDuration(category, normalizedName, legacyTask.duration),
            startDate: schedule.startDate,
            completedDate: null,
            orderInPhase: legacyTask.orderIndex,
            canvasX: null,
            canvasY: null,
            createdBy: "ai",
            aiConfidence,
            conditionalNote,
            isCustom: false,
              tags: [],
              protocolRefs,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            "importLegacyScaffold:legacyTask"
          );

          createdMapTasks.push({
            id: newTaskId,
            phaseId: newPhaseId,
            protocolRefs,
            category,
            name: normalizedName,
          });
        }
      }

      const phaseRowsAfterImport = await db
        .select()
        .from(mapPhases)
        .where(eq(mapPhases.mapId, targetMap.id))
        .orderBy(asc(mapPhases.displayOrder));

      const phaseIdByNormalizedName = new Map<string, string>();
      for (const phase of phaseRowsAfterImport) {
        phaseIdByNormalizedName.set(normalizeText(phase.name), phase.id);
      }

      const existingTaskRows = await db
        .select()
        .from(mapTasks)
        .where(eq(mapTasks.mapId, targetMap.id));
      const taskNameSetByPhase = new Map<string, Set<string>>();
      for (const task of existingTaskRows) {
        const set = taskNameSetByPhase.get(task.phaseId) ?? new Set<string>();
        set.add(normalizeText(task.name));
        taskNameSetByPhase.set(task.phaseId, set);
      }

      const ensurePhase = async (
        phaseName: string,
        phaseType:
          | "screening"
          | "baseline"
          | "treatment_visit"
          | "follow_up"
          | "end_of_study"
          | "unscheduled"
          | "screen_fail"
          | "early_termination"
          | "custom",
        color: string
      ) => {
        const key = normalizeText(phaseName);
        const existing = phaseIdByNormalizedName.get(key);
        if (existing) return existing;
        const id = randomUUID();
        const maxOrder =
          phaseRowsAfterImport.length > 0
            ? Math.max(...phaseRowsAfterImport.map((row) => row.displayOrder))
            : -1;
        const displayOrder = maxOrder + 1;
        await db.insert(mapPhases).values({
          id,
          mapId: targetMap.id,
          name: phaseName,
          phaseType,
          displayOrder,
          color,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        phaseRowsAfterImport.push({
          id,
          mapId: targetMap.id,
          name: phaseName,
          phaseType,
          displayOrder,
          color,
          estimatedDate: null,
          windowStart: null,
          windowEnd: null,
          protocolRef: null,
          canvasX: null,
          canvasY: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        phaseIdByNormalizedName.set(key, id);
        return id;
      };

      const addAutoTaskIfMissing = async (inputTask: {
        phaseId: string;
        name: string;
        category:
          | "consent"
          | "eligibility"
          | "lab_sample"
          | "vital_signs"
          | "imaging"
          | "drug_administration"
          | "assessment"
          | "questionnaire"
          | "data_entry"
          | "coordination"
          | "documentation"
          | "follow_up"
          | "safety_reporting"
          | "regulatory"
          | "custom";
        priority?: "critical" | "high" | "medium" | "low";
        section?: string;
        conditionalNote?: string | null;
        aiConfidence?: number;
      }) => {
        const normalizedTaskName = normalizeText(inputTask.name);
        const set = taskNameSetByPhase.get(inputTask.phaseId) ?? new Set<string>();
        if (set.has(normalizedTaskName)) return;
        set.add(normalizedTaskName);
        taskNameSetByPhase.set(inputTask.phaseId, set);

        const phaseTasksCount = createdMapTasks.filter((task) => task.phaseId === inputTask.phaseId).length;
        const protocolSection = inputTask.section || "Schedule of Activities";
        const contextRef = findBestContextRef(inputTask.name, protocolSection, null);
        const protocolRefs = [
          {
            documentId: input.protocolId,
            section: contextRef?.section ?? protocolSection,
            page: contextRef?.page,
            extractedText: contextRef?.extractedText,
          },
        ];
        const id = randomUUID();
        const phaseForTask = phaseRowsAfterImport.find((phase) => phase.id === inputTask.phaseId);
        const shouldLeaveUnscheduled =
          phaseForTask?.phaseType === "screen_fail" || phaseForTask?.phaseType === "early_termination";
        const autoSchedule = shouldLeaveUnscheduled
          ? { suggestedDate: null, startDate: null, dueDate: null }
          : deriveTaskSchedule(
              trialTimelineAnchor,
              phaseForTask?.name ?? inputTask.section ?? "Visit",
              phaseForTask?.displayOrder ?? 0,
              `${phaseForTask?.name ?? ""} ${inputTask.section ?? ""} ${inputTask.name}`,
              null
            );
        await insertMapTaskWithFallback(
          db,
          {
            id,
            phaseId: inputTask.phaseId,
            mapId: targetMap.id,
            name: ensureActionVerbName(inputTask.name, inputTask.category),
            description: null,
          category: inputTask.category,
          priority: inputTask.priority ?? inferPriority(inputTask.category, inputTask.name),
          status: "suggested",
          blockedReason: null,
          blockedSince: null,
          assignedRole: inferAssignedRole(inputTask.category, inputTask.name),
          assignedUserId: null,
          suggestedAssignee: null,
          suggestedDate: autoSchedule.suggestedDate,
          dueDate: autoSchedule.dueDate,
          estimatedDuration: inferEstimatedDuration(inputTask.category, inputTask.name, null),
          startDate: autoSchedule.startDate,
          completedDate: null,
          orderInPhase: phaseTasksCount,
          canvasX: null,
          canvasY: null,
          createdBy: "ai",
          aiConfidence: inputTask.aiConfidence ?? 0.88,
          conditionalNote: inputTask.conditionalNote ?? null,
          isCustom: false,
            tags: [],
            protocolRefs,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          "importLegacyScaffold:autoTask"
        );
        createdMapTasks.push({
          id,
          phaseId: inputTask.phaseId,
          protocolRefs,
          category: inputTask.category,
          name: inputTask.name,
        });
      };

      for (const phase of phaseRowsAfterImport) {
        const normalizedPhase = normalizeText(phase.name);
        const phaseTasks = createdMapTasks.filter((task) => task.phaseId === phase.id);
        const hasDrugAdministration = phaseTasks.some((task) => task.category === "drug_administration");
        const isScreening = phase.phaseType === "screening" || normalizedPhase.includes("screen");
        const isTreatmentVisit =
          phase.phaseType === "treatment_visit" ||
          phase.phaseType === "baseline" ||
          normalizedPhase.includes("visit") ||
          normalizedPhase.includes("cycle");

        if (isScreening) {
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: "Obtain written informed consent",
            category: "consent",
            priority: "critical",
            section: "Inclusion / Exclusion",
            aiConfidence: 0.95,
          });
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: "Verify inclusion criteria",
            category: "eligibility",
            priority: "critical",
            section: "Inclusion / Exclusion",
            aiConfidence: 0.93,
          });
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: "Verify exclusion criteria",
            category: "eligibility",
            priority: "critical",
            section: "Inclusion / Exclusion",
            aiConfidence: 0.93,
          });
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: "Enter screening data in EDC",
            category: "data_entry",
            priority: "medium",
            section: "Schedule of Activities",
            aiConfidence: 0.9,
          });
        }

        if (isTreatmentVisit) {
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: "Assess adverse events since last visit",
            category: "safety_reporting",
            priority: "critical",
            section: "Adverse Events & Safety",
            aiConfidence: 0.9,
          });
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: "Review concomitant medications",
            category: "assessment",
            priority: "medium",
            section: "Concomitant Medications",
            aiConfidence: 0.88,
          });
          await addAutoTaskIfMissing({
            phaseId: phase.id,
            name: `Complete ${phase.name} data entry in EDC`,
            category: "data_entry",
            priority: "medium",
            section: "Schedule of Activities",
            aiConfidence: 0.9,
          });
          if (hasDrugAdministration) {
            await addAutoTaskIfMissing({
              phaseId: phase.id,
              name: "Record pre-dose vital signs",
              category: "vital_signs",
              priority: "high",
              section: "Dosing & Administration",
              aiConfidence: 0.9,
            });
            await addAutoTaskIfMissing({
              phaseId: phase.id,
              name: "Monitor patient during post-dose observation",
              category: "safety_reporting",
              priority: "high",
              section: "Adverse Events & Safety",
              aiConfidence: 0.89,
            });
          }
        }
      }

      const screenFailPhaseId = await ensurePhase("Screen Fail", "screen_fail", "#EF4444");
      await addAutoTaskIfMissing({
        phaseId: screenFailPhaseId,
        name: "Document screen failure reason",
        category: "documentation",
        priority: "high",
        section: "Inclusion / Exclusion",
        aiConfidence: 0.9,
      });
      await addAutoTaskIfMissing({
        phaseId: screenFailPhaseId,
        name: "Notify sponsor of screen failure",
        category: "coordination",
        priority: "high",
        section: "Study Design & Patient Population",
        aiConfidence: 0.88,
      });
      await addAutoTaskIfMissing({
        phaseId: screenFailPhaseId,
        name: "Close participant in CTMS and EDC",
        category: "data_entry",
        priority: "medium",
        section: "Documentation",
        aiConfidence: 0.86,
      });

      const earlyTerminationPhaseId = await ensurePhase("Early Termination", "early_termination", "#6366F1");
      await addAutoTaskIfMissing({
        phaseId: earlyTerminationPhaseId,
        name: "Document reason for early termination",
        category: "documentation",
        priority: "high",
        section: "Study Design & Patient Population",
        aiConfidence: 0.89,
      });
      await addAutoTaskIfMissing({
        phaseId: earlyTerminationPhaseId,
        name: "Perform end-of-study assessments",
        category: "assessment",
        priority: "high",
        section: "Procedures & Assessments",
        aiConfidence: 0.88,
      });
      await addAutoTaskIfMissing({
        phaseId: earlyTerminationPhaseId,
        name: "Draw final safety laboratory samples",
        category: "lab_sample",
        priority: "high",
        section: "Lab & Samples",
        aiConfidence: 0.88,
      });
      await addAutoTaskIfMissing({
        phaseId: earlyTerminationPhaseId,
        name: "Complete early termination CRF pages",
        category: "data_entry",
        priority: "medium",
        section: "Documentation",
        aiConfidence: 0.86,
      });
      await addAutoTaskIfMissing({
        phaseId: earlyTerminationPhaseId,
        name: "Notify IRB and sponsor of early termination",
        category: "regulatory",
        priority: "high",
        section: "Regulatory",
        aiConfidence: 0.85,
      });

      const phaseTaskDateRows = await db
        .select({
          phaseId: mapTasks.phaseId,
          startDate: mapTasks.startDate,
          suggestedDate: mapTasks.suggestedDate,
          dueDate: mapTasks.dueDate,
        })
        .from(mapTasks)
        .where(eq(mapTasks.mapId, targetMap.id));

      const phaseDateBounds = new Map<string, { start: Date; end: Date }>();
      for (const row of phaseTaskDateRows) {
        const startCandidate = parseMaybeDate(row.startDate) ?? parseMaybeDate(row.suggestedDate);
        const endCandidate = parseMaybeDate(row.dueDate) ?? startCandidate;
        if (!startCandidate || !endCandidate) continue;
        const existing = phaseDateBounds.get(row.phaseId);
        if (!existing) {
          phaseDateBounds.set(row.phaseId, { start: startCandidate, end: endCandidate });
          continue;
        }
        if (startCandidate < existing.start) existing.start = startCandidate;
        if (endCandidate > existing.end) existing.end = endCandidate;
      }

      for (const [phaseId, bounds] of Array.from(phaseDateBounds.entries())) {
        await db
          .update(mapPhases)
          .set({
            estimatedDate: bounds.start,
            windowStart: bounds.start,
            windowEnd: bounds.end,
            updatedAt: new Date(),
          })
          .where(eq(mapPhases.id, phaseId));
      }

      const legacyTaskIds = Array.from(legacyTaskIdToMapTaskId.keys());
      if (legacyTaskIds.length > 0) {
        const legacyDepRows = await db
          .select()
          .from(legacyTaskDependencies)
          .where(
            or(
              inArray(legacyTaskDependencies.taskId, legacyTaskIds),
              inArray(legacyTaskDependencies.dependsOnTaskId, legacyTaskIds)
            )
          );

        for (const dep of legacyDepRows) {
          const sourceLegacyId = dep.type === "before" ? dep.taskId : dep.dependsOnTaskId;
          const targetLegacyId = dep.type === "before" ? dep.dependsOnTaskId : dep.taskId;

          const sourceTaskId = legacyTaskIdToMapTaskId.get(sourceLegacyId);
          const targetTaskId = legacyTaskIdToMapTaskId.get(targetLegacyId);
          if (!sourceTaskId || !targetTaskId || sourceTaskId === targetTaskId) continue;

          await db.insert(mapTaskDependencies).values({
            id: randomUUID(),
            sourceTaskId,
            targetTaskId,
            dependencyType: dep.type === "concurrent" ? "concurrent" : "finish_to_start",
            conditionLabel: null,
            isCrossPhase:
              legacyTaskToLegacyPhase.get(sourceLegacyId) !== legacyTaskToLegacyPhase.get(targetLegacyId),
            createdAt: new Date(),
          });
        }
      }

      const legacyPhaseIds = legacyPhaseRows.map((row) => row.id);
      if (legacyPhaseIds.length > 0) {
        const legacyTransitionRows = await db
          .select()
          .from(legacyPhaseTransitions)
          .where(
            or(
              inArray(legacyPhaseTransitions.fromPhaseId, legacyPhaseIds),
              inArray(legacyPhaseTransitions.toPhaseId, legacyPhaseIds)
            )
          );

        for (const transition of legacyTransitionRows) {
          const fromPhaseId = legacyPhaseIdToMapPhaseId.get(transition.fromPhaseId);
          const toPhaseId = legacyPhaseIdToMapPhaseId.get(transition.toPhaseId);
          if (!fromPhaseId || !toPhaseId) continue;
          await db.insert(mapPhaseTransitions).values({
            id: randomUUID(),
            fromPhaseId,
            toPhaseId,
            conditionLabel: transition.condition ?? null,
            isDefault: !transition.condition || transition.condition.toLowerCase().includes("eligible"),
            createdAt: new Date(),
          });
        }
      }

      const legacySectionRows = await db
        .select()
        .from(legacyProtocolSections)
        .where(eq(legacyProtocolSections.protocolId, input.protocolId))
        .orderBy(asc(legacyProtocolSections.orderIndex), asc(legacyProtocolSections.createdAt));

      const rawSectionsForMap =
        legacySectionRows.length > 0
          ? [...legacySectionRows]
          : [
              {
                id: -1,
                protocolId: input.protocolId,
                name: "Schedule of Events",
                pageReference: null,
                dateReference: null,
                orderIndex: 0,
                parentSectionId: null,
                createdAt: new Date(),
              },
            ];
      const sectionsForMap: typeof rawSectionsForMap = [];
      const seenSectionKeys = new Set<string>();
      for (const section of rawSectionsForMap) {
        const normalizedName = normalizeText(section.name);
        if (!normalizedName) continue;
        const sectionType = inferSectionTypeFromName(section.name);
        const key = sectionType === "custom" ? normalizedName : `type:${sectionType}`;
        if (seenSectionKeys.has(key)) continue;
        seenSectionKeys.add(key);
        sectionsForMap.push(section);
      }

      const defaultSectionNames = [
        "Schedule of Events",
        "Inclusion / Exclusion",
        "Dosing & Administration",
        "Procedures & Assessments",
        "Lab & Samples",
        "Adverse Events & Safety",
        "Concomitant Medications",
      ];

      const existingSectionKeys = new Set(
        sectionsForMap.map((section) => {
          const sectionType = inferSectionTypeFromName(section.name);
          return sectionType === "custom" ? normalizeText(section.name) : `type:${sectionType}`;
        })
      );
      let maxSectionOrder =
        sectionsForMap.length > 0 ? Math.max(...sectionsForMap.map((section) => section.orderIndex)) : -1;
      for (const defaultName of defaultSectionNames) {
        const sectionType = inferSectionTypeFromName(defaultName);
        const sectionKey = sectionType === "custom" ? normalizeText(defaultName) : `type:${sectionType}`;
        if (existingSectionKeys.has(sectionKey)) continue;
        maxSectionOrder += 1;
        sectionsForMap.push({
          id: -(maxSectionOrder + 1),
          protocolId: input.protocolId,
          name: defaultName,
          pageReference: null,
          dateReference: null,
          orderIndex: maxSectionOrder,
          parentSectionId: null,
          createdAt: new Date(),
        });
        existingSectionKeys.add(sectionKey);
      }

      const sectionIdMap = new Map<number, string>();
      for (const section of sectionsForMap) {
        sectionIdMap.set(section.id, randomUUID());
      }

      for (const section of sectionsForMap) {
        const sectionId = sectionIdMap.get(section.id) as string;
        const normalizedSectionName = normalizeText(section.name);
        const sectionType = inferSectionTypeFromName(section.name);
        const linkedTaskIds = createdMapTasks
          .filter((task) => {
            const refs = task.protocolRefs;
            const refMatch = refs.some((ref) => {
              const refSection = normalizeText(String(ref.section || ""));
              return (
                refSection.includes(normalizedSectionName) ||
                normalizedSectionName.includes(refSection)
              );
            });
            if (refMatch) return true;

            if (sectionType === "schedule") return true;
            if (sectionType === "eligibility") return task.category === "eligibility";
            if (sectionType === "lab") return task.category === "lab_sample";
            if (sectionType === "safety") return task.category === "safety_reporting";
            if (sectionType === "randomization") {
              return (
                task.category === "coordination" &&
                /(random|irt)/.test(normalizeText(task.name))
              );
            }
            if (sectionType === "medication") {
              return (
                task.category === "drug_administration" ||
                /(concomitant|medication)/.test(normalizeText(task.name))
              );
            }
            if (sectionType === "procedure") {
              return ["assessment", "vital_signs", "questionnaire", "imaging"].includes(task.category);
            }
            return (
              normalizeText(task.name).includes(normalizedSectionName) ||
              normalizedSectionName.includes(normalizeText(task.name))
            );
          })
          .map((task) => task.id);
        const linkedPhaseIds = Array.from(
          new Set(
            createdMapTasks
              .filter((task) => linkedTaskIds.includes(task.id))
              .map((task) => task.phaseId)
          )
        );

        await db.insert(protocolMapSections).values({
          id: sectionId,
          protocolId: input.protocolId,
          mapId: targetMap.id,
          name: section.name,
          sectionType,
          pageStart: extractPageStart(section.pageReference),
          pageEnd: null,
          dateReference: parseDateFromReference(section.dateReference),
          parentSectionId: section.parentSectionId ? sectionIdMap.get(section.parentSectionId) ?? null : null,
          linkedPhaseIds,
          linkedTaskIds,
          displayOrder: section.orderIndex,
          isChecked: true,
          createdAt: new Date(),
        });
      }

      const nextMetadata = {
        ...sanitizeObject(targetMap.metadata),
        protocolTitle: trial?.title ?? protocol?.filename ?? "",
        sponsor: trial?.sponsor ?? "",
        indication: trial?.indication ?? "",
        totalTasks: createdMapTasks.length,
        totalPhases: phaseRowsAfterImport.length,
        generatedBy: "hybrid",
      };

      await db
        .update(executionMaps)
        .set({
          metadata: nextMetadata,
          updatedAt: new Date(),
        })
        .where(eq(executionMaps.id, targetMap.id));

      await trackMapEvent({
        mapId: targetMap.id,
        trialId: input.trialId,
        eventType: "map.generated",
        userId: ctx.user.id,
        targetId: targetMap.id,
        targetType: "map",
        payload: {
          importedFromLegacyScaffold: true,
          scaffoldId: legacyScaffold.id,
          importedTasks: createdMapTasks.length,
          importedPhases: phaseRowsAfterImport.length,
        },
      });

      return {
        success: true,
        mapId: targetMap.id,
        importedTasks: createdMapTasks.length,
        importedPhases: phaseRowsAfterImport.length,
      };
    }),

  load: protectedProcedure
    .input(z.object({ mapId: z.string() }))
    .query(async ({ input }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      const phases = await db
        .select()
        .from(mapPhases)
        .where(eq(mapPhases.mapId, input.mapId))
        .orderBy(asc(mapPhases.displayOrder));
      const tasks = await db
        .select()
        .from(mapTasks)
        .where(eq(mapTasks.mapId, input.mapId))
        .orderBy(asc(mapTasks.phaseId), asc(mapTasks.orderInPhase));
      const taskIds = tasks.map((task) => task.id);
      const phaseIds = phases.map((phase) => phase.id);
      const dependencies =
        taskIds.length > 0
          ? await db
              .select()
              .from(mapTaskDependencies)
              .where(
                or(
                  inArray(mapTaskDependencies.sourceTaskId, taskIds),
                  inArray(mapTaskDependencies.targetTaskId, taskIds)
                )
              )
          : [];
      const transitions =
        phaseIds.length > 0
          ? await db
              .select()
              .from(mapPhaseTransitions)
              .where(
                or(
                  inArray(mapPhaseTransitions.fromPhaseId, phaseIds),
                  inArray(mapPhaseTransitions.toPhaseId, phaseIds)
                )
              )
          : [];
      const protocolSections = await db
        .select()
        .from(protocolMapSections)
        .where(eq(protocolMapSections.mapId, input.mapId))
        .orderBy(asc(protocolMapSections.displayOrder));

      return {
        map,
        phases,
        tasks,
        dependencies,
        transitions,
        protocolMapSections: protocolSections,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        protocolId: z.number(),
        status: z.enum(MAP_STATUSES).default("draft"),
        version: z.number().optional(),
        metadata: mapMetadataSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      if (input.status === "active") {
        const [activeMap] = await db
          .select({ id: executionMaps.id })
          .from(executionMaps)
          .where(and(eq(executionMaps.trialId, input.trialId), eq(executionMaps.status, "active")))
          .limit(1);
        if (activeMap) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This trial already has an active map. Archive it before activating another map.",
          });
        }
      }

      const id = randomUUID();
      await db.insert(executionMaps).values({
        id,
        trialId: input.trialId,
        protocolId: input.protocolId,
        status: input.status,
        version: input.version ?? 1,
        metadata: sanitizeObject(input.metadata),
        createdBy: ctx.user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await trackMapEvent({
        mapId: id,
        trialId: input.trialId,
        eventType: "map.generated",
        userId: ctx.user.id,
        targetId: id,
        targetType: "map",
        payload: { status: input.status, version: input.version ?? 1 },
      });

      const [created] = await db.select().from(executionMaps).where(eq(executionMaps.id, id)).limit(1);
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        status: z.enum(MAP_STATUSES).optional(),
        metadata: mapMetadataSchema.optional(),
        version: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);

      if (input.status === "active") {
        const [otherActive] = await db
          .select({ id: executionMaps.id })
          .from(executionMaps)
          .where(
            and(
              eq(executionMaps.trialId, map.trialId),
              eq(executionMaps.status, "active")
            )
          )
          .limit(1);
        if (otherActive && otherActive.id !== map.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Another active map exists for this trial.",
          });
        }
      }

      await db
        .update(executionMaps)
        .set({
          status: input.status ?? map.status,
          version: input.version ?? map.version,
          metadata: input.metadata ? sanitizeObject(input.metadata) : map.metadata,
          updatedAt: new Date(),
        })
        .where(eq(executionMaps.id, input.mapId));

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetId: map.id,
        targetType: "map",
        payload: {
          status: input.status ?? null,
          version: input.version ?? null,
          metadataChanged: Boolean(input.metadata),
        },
      });

      const [updated] = await db.select().from(executionMaps).where(eq(executionMaps.id, input.mapId)).limit(1);
      return updated;
    }),

  launch: protectedProcedure
    .input(z.object({ mapId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);

      if (map.status !== "draft" && map.status !== "revised") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft/revised maps can be launched.",
        });
      }

      const [otherActive] = await db
        .select({ id: executionMaps.id })
        .from(executionMaps)
        .where(and(eq(executionMaps.trialId, map.trialId), eq(executionMaps.status, "active")))
        .limit(1);
      if (otherActive && otherActive.id !== map.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This trial already has an active map.",
        });
      }

      const tasks = await db.select().from(mapTasks).where(eq(mapTasks.mapId, map.id));
      const invalidTasks = tasks.filter((task) => !["confirmed", "cancelled"].includes(task.status));
      if (invalidTasks.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Launch blocked: ${invalidTasks.length} tasks are still not reviewed.`,
        });
      }

      await db
        .update(mapTasks)
        .set({ status: "todo", updatedAt: new Date() })
        .where(and(eq(mapTasks.mapId, map.id), eq(mapTasks.status, "confirmed")));

      await db
        .update(executionMaps)
        .set({
          status: "active",
          launchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(executionMaps.id, map.id));

      const accepted = tasks.filter((task) => task.status === "confirmed").length;
      const modified = tasks.filter((task) => task.isCustom).length;
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "map.launched",
        userId: ctx.user.id,
        targetId: map.id,
        targetType: "map",
        payload: {
          totalTasks: tasks.length,
          acceptedPct: tasks.length ? Number((accepted / tasks.length).toFixed(3)) : 0,
          modifiedPct: tasks.length ? Number((modified / tasks.length).toFixed(3)) : 0,
        },
      });

      const [updated] = await db.select().from(executionMaps).where(eq(executionMaps.id, map.id)).limit(1);
      return updated;
    }),

  confirmSuggested: protectedProcedure
    .input(z.object({ mapId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      if (map.status === "archived") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Archived maps cannot be modified.",
        });
      }

      const suggestedRows = await db
        .select({ id: mapTasks.id })
        .from(mapTasks)
        .where(and(eq(mapTasks.mapId, map.id), eq(mapTasks.status, "suggested")));

      if (suggestedRows.length > 0) {
        await db
          .update(mapTasks)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(and(eq(mapTasks.mapId, map.id), eq(mapTasks.status, "suggested")));

        await trackMapEvent({
          mapId: map.id,
          trialId: map.trialId,
          eventType: "task.accepted",
          userId: ctx.user.id,
          targetId: map.id,
          targetType: "map",
          payload: { bulk: true, updated: suggestedRows.length },
        });
      }

      return { success: true, updated: suggestedRows.length } as const;
    }),

  archive: protectedProcedure
    .input(z.object({ mapId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      await db
        .update(executionMaps)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(executionMaps.id, map.id));
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "amendment.reviewed",
        userId: ctx.user.id,
        targetId: map.id,
        targetType: "map",
        payload: { archived: true },
      });
      return { success: true } as const;
    }),

  createPhase: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        name: z.string().min(1).max(255),
        phaseType: z
          .enum([
            "screening",
            "baseline",
            "treatment_visit",
            "follow_up",
            "end_of_study",
            "unscheduled",
            "screen_fail",
            "early_termination",
            "custom",
          ])
          .optional(),
        color: z.string().max(7).optional(),
        displayOrder: z.number().optional(),
        estimatedDate: z.string().datetime().nullable().optional(),
        windowStart: z.string().datetime().nullable().optional(),
        windowEnd: z.string().datetime().nullable().optional(),
        protocolRef: z.record(z.string(), z.unknown()).nullable().optional(),
        canvasX: z.number().nullable().optional(),
        canvasY: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      const id = randomUUID();
      let nextOrder = input.displayOrder;
      if (nextOrder === undefined) {
        const rows = await db
          .select({ displayOrder: mapPhases.displayOrder })
          .from(mapPhases)
          .where(eq(mapPhases.mapId, map.id))
          .orderBy(desc(mapPhases.displayOrder))
          .limit(1);
        nextOrder = rows[0] ? rows[0].displayOrder + 1 : 0;
      }
      await db.insert(mapPhases).values({
        id,
        mapId: map.id,
        name: input.name,
        phaseType: input.phaseType ?? "custom",
        displayOrder: nextOrder,
        color: input.color ?? "#3B82F6",
        estimatedDate: input.estimatedDate ? new Date(input.estimatedDate) : null,
        windowStart: input.windowStart ? new Date(input.windowStart) : null,
        windowEnd: input.windowEnd ? new Date(input.windowEnd) : null,
        protocolRef: input.protocolRef ?? null,
        canvasX: input.canvasX ?? null,
        canvasY: input.canvasY ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.added_manual",
        userId: ctx.user.id,
        targetId: id,
        targetType: "phase",
        payload: { name: input.name },
      });
      const [created] = await db.select().from(mapPhases).where(eq(mapPhases.id, id)).limit(1);
      return created;
    }),

  updatePhase: protectedProcedure
    .input(
      z.object({
        phaseId: z.string(),
        updates: z
          .object({
            name: z.string().max(255).optional(),
            phaseType: z
              .enum([
                "screening",
                "baseline",
                "treatment_visit",
                "follow_up",
                "end_of_study",
                "unscheduled",
                "screen_fail",
                "early_termination",
                "custom",
              ])
              .optional(),
            displayOrder: z.number().optional(),
            color: z.string().max(7).optional(),
            estimatedDate: z.string().datetime().nullable().optional(),
            windowStart: z.string().datetime().nullable().optional(),
            windowEnd: z.string().datetime().nullable().optional(),
            protocolRef: z.record(z.string(), z.unknown()).nullable().optional(),
            canvasX: z.number().nullable().optional(),
            canvasY: z.number().nullable().optional(),
          })
          .partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const [phase] = await db.select().from(mapPhases).where(eq(mapPhases.id, input.phaseId)).limit(1);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });

      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, phase.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found for phase" });

      const updates = input.updates;
      await db
        .update(mapPhases)
        .set({
          name: updates.name ?? phase.name,
          phaseType: updates.phaseType ?? phase.phaseType,
          displayOrder: updates.displayOrder ?? phase.displayOrder,
          color: updates.color ?? phase.color,
          estimatedDate:
            updates.estimatedDate === undefined
              ? phase.estimatedDate
              : updates.estimatedDate
              ? new Date(updates.estimatedDate)
              : null,
          windowStart:
            updates.windowStart === undefined
              ? phase.windowStart
              : updates.windowStart
              ? new Date(updates.windowStart)
              : null,
          windowEnd:
            updates.windowEnd === undefined
              ? phase.windowEnd
              : updates.windowEnd
              ? new Date(updates.windowEnd)
              : null,
          protocolRef: updates.protocolRef === undefined ? phase.protocolRef : updates.protocolRef,
          canvasX: updates.canvasX === undefined ? phase.canvasX : updates.canvasX,
          canvasY: updates.canvasY === undefined ? phase.canvasY : updates.canvasY,
          updatedAt: new Date(),
        })
        .where(eq(mapPhases.id, input.phaseId));

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetId: input.phaseId,
        targetType: "phase",
        payload: { fieldsChanged: Object.keys(updates) },
      });
      return { success: true } as const;
    }),

  removePhase: protectedProcedure
    .input(z.object({ phaseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [phase] = await db.select().from(mapPhases).where(eq(mapPhases.id, input.phaseId)).limit(1);
      if (!phase) throw new TRPCError({ code: "NOT_FOUND", message: "Phase not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, phase.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      const phaseTasks = await db
        .select({ id: mapTasks.id })
        .from(mapTasks)
        .where(eq(mapTasks.phaseId, phase.id));
      const taskIds = phaseTasks.map((row) => row.id);
      if (taskIds.length > 0) {
        await db
          .delete(mapTaskDependencies)
          .where(
            or(
              inArray(mapTaskDependencies.sourceTaskId, taskIds),
              inArray(mapTaskDependencies.targetTaskId, taskIds)
            )
          );
        await db.delete(mapTasks).where(inArray(mapTasks.id, taskIds));
      }
      await db
        .delete(mapPhaseTransitions)
        .where(or(eq(mapPhaseTransitions.fromPhaseId, phase.id), eq(mapPhaseTransitions.toPhaseId, phase.id)));
      await db.delete(mapPhases).where(eq(mapPhases.id, phase.id));
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.rejected",
        userId: ctx.user.id,
        targetId: phase.id,
        targetType: "phase",
        payload: { removed: true, removedTaskCount: taskIds.length },
      });
      return { success: true } as const;
    }),

  reorderPhases: protectedProcedure
    .input(z.object({ mapId: z.string(), orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      for (let i = 0; i < input.orderedIds.length; i += 1) {
        await db
          .update(mapPhases)
          .set({ displayOrder: i, updatedAt: new Date() })
          .where(and(eq(mapPhases.id, input.orderedIds[i]), eq(mapPhases.mapId, map.id)));
      }
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetType: "map",
        payload: { reorderedPhaseIds: input.orderedIds },
      });
      return { success: true } as const;
    }),

  createTask: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        phaseId: z.string(),
        task: z.object({
          name: z.string().min(1).max(500),
          description: z.string().optional(),
          category: z
            .enum([
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
            ])
            .default("custom"),
          priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
          status: z.enum(TASK_STATUSES).default("suggested"),
          assignedRole: z
            .enum([
              "pi",
              "sub_i",
              "crc",
              "nurse",
              "pharmacist",
              "lab_tech",
              "data_manager",
              "regulatory_coordinator",
              "study_coordinator",
              "custom",
            ])
            .nullable()
            .optional(),
          assignedUserId: z.number().nullable().optional(),
          suggestedAssignee: z.string().nullable().optional(),
          suggestedDate: z.string().datetime().nullable().optional(),
          dueDate: z.string().datetime().nullable().optional(),
          estimatedDuration: z.number().nullable().optional(),
          conditionalNote: z.string().nullable().optional(),
          canvasX: z.number().nullable().optional(),
          canvasY: z.number().nullable().optional(),
          createdBy: z.enum(["ai", "user"]).default("user"),
          aiConfidence: z.number().min(0).max(1).nullable().optional(),
          isCustom: z.boolean().default(true),
          tags: z.array(z.string()).default([]),
          protocolRefs: z.array(z.record(z.string(), z.unknown())).default([]),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      assertAiTaskTraceability({
        createdBy: input.task.createdBy,
        isCustom: input.task.isCustom,
        protocolRefs: input.task.protocolRefs,
      });

      const [phase] = await db
        .select({ id: mapPhases.id })
        .from(mapPhases)
        .where(and(eq(mapPhases.id, input.phaseId), eq(mapPhases.mapId, map.id)))
        .limit(1);
      if (!phase) throw new TRPCError({ code: "BAD_REQUEST", message: "Phase does not belong to this map" });

      const [last] = await db
        .select({ orderInPhase: mapTasks.orderInPhase })
        .from(mapTasks)
        .where(eq(mapTasks.phaseId, input.phaseId))
        .orderBy(desc(mapTasks.orderInPhase))
        .limit(1);
      const id = randomUUID();

      await insertMapTaskWithFallback(
        db,
        {
          id,
          phaseId: input.phaseId,
          mapId: map.id,
          name: input.task.name,
        description: input.task.description ?? null,
        category: input.task.category,
        priority: input.task.priority,
        status: input.task.status,
        assignedRole: input.task.assignedRole ?? null,
        assignedUserId: input.task.assignedUserId ?? null,
        suggestedAssignee: input.task.suggestedAssignee ?? null,
        suggestedDate: input.task.suggestedDate ? new Date(input.task.suggestedDate) : null,
        dueDate: input.task.dueDate ? new Date(input.task.dueDate) : null,
        estimatedDuration: input.task.estimatedDuration ?? null,
        conditionalNote: input.task.conditionalNote ?? null,
        orderInPhase: (last?.orderInPhase ?? -1) + 1,
        canvasX: input.task.canvasX ?? null,
        canvasY: input.task.canvasY ?? null,
        createdBy: input.task.createdBy,
        aiConfidence: input.task.aiConfidence ?? null,
        isCustom: input.task.isCustom,
          tags: input.task.tags,
          protocolRefs: input.task.protocolRefs,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        "createTask"
      );

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: input.task.createdBy === "ai" ? "task.accepted" : "task.added_manual",
        userId: ctx.user.id,
        targetId: id,
        targetType: "task",
        payload: { status: input.task.status, category: input.task.category },
      });

      const [created] = await db.select().from(mapTasks).where(eq(mapTasks.id, id)).limit(1);
      return created;
    }),

  updateTask: protectedProcedure
    .input(z.object({ taskId: z.string(), updates: taskPatchSchema }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [task] = await db.select().from(mapTasks).where(eq(mapTasks.id, input.taskId)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, task.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      const nextCreatedBy = input.updates.createdBy ?? task.createdBy;
      const nextIsCustom = input.updates.isCustom ?? task.isCustom;
      const nextProtocolRefs = input.updates.protocolRefs ?? (task.protocolRefs as unknown);
      assertAiTaskTraceability({
        createdBy: nextCreatedBy,
        isCustom: nextIsCustom,
        protocolRefs: nextProtocolRefs,
      });

      const canWriteConditionalNote = await supportsMapTaskConditionalNote(db);
      const updateValues: Record<string, unknown> = {
        name: truncateString(input.updates.name ?? task.name, 500) ?? task.name,
        description: truncateString(input.updates.description ?? task.description, 8000),
        category: input.updates.category ?? task.category,
        priority: input.updates.priority ?? task.priority,
        assignedRole:
          input.updates.assignedRole === undefined ? task.assignedRole : input.updates.assignedRole,
        assignedUserId:
          input.updates.assignedUserId === undefined
            ? task.assignedUserId
            : input.updates.assignedUserId,
        suggestedAssignee:
          input.updates.suggestedAssignee === undefined
            ? task.suggestedAssignee
            : truncateString(input.updates.suggestedAssignee, 255),
        suggestedDate:
          input.updates.suggestedDate === undefined
            ? task.suggestedDate
            : input.updates.suggestedDate
            ? new Date(input.updates.suggestedDate)
            : null,
        dueDate:
          input.updates.dueDate === undefined
            ? task.dueDate
            : input.updates.dueDate
            ? new Date(input.updates.dueDate)
            : null,
        estimatedDuration:
          input.updates.estimatedDuration === undefined
            ? task.estimatedDuration
            : clampNumber(input.updates.estimatedDuration, 1, 24 * 60),
        canvasX: input.updates.canvasX === undefined ? task.canvasX : input.updates.canvasX,
        canvasY: input.updates.canvasY === undefined ? task.canvasY : input.updates.canvasY,
        tags: input.updates.tags ? ensureArrayOfStrings(input.updates.tags) : task.tags,
        protocolRefs:
          input.updates.protocolRefs === undefined
            ? sanitizeProtocolRefs(task.protocolRefs)
            : sanitizeProtocolRefs(input.updates.protocolRefs),
        isCustom: input.updates.isCustom ?? task.isCustom,
        createdBy: nextCreatedBy,
        updatedAt: new Date(),
      };
      if (canWriteConditionalNote) {
        updateValues.conditionalNote =
          input.updates.conditionalNote === undefined
            ? task.conditionalNote
            : truncateString(input.updates.conditionalNote, 500);
      }

      const mutableUpdateValues: Record<string, unknown> = { ...updateValues };
      let updateAttempts = 0;
      // Some local environments can have drifted columns. Retry by removing unknown columns.
      while (updateAttempts < 5) {
        updateAttempts += 1;
        try {
          await db.update(mapTasks).set(mutableUpdateValues).where(eq(mapTasks.id, task.id));
          break;
        } catch (error) {
          const message = String(
            (error as { cause?: { sqlMessage?: string } })?.cause?.sqlMessage ??
              (error as Error)?.message ??
              "unknown error"
          );
          const unknownColumn = extractUnknownColumnName(message);
          if (unknownColumn) {
            await patchMapTasksSchemaIfNeeded(db, unknownColumn);
            const property = mapDbColumnToTaskInsertProperty(unknownColumn);
            if (property && property in mutableUpdateValues) {
              delete mutableUpdateValues[property];
              continue;
            }
          }
          throw error;
        }
      }

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetId: task.id,
        targetType: "task",
        payload: {
          fieldsChanged: Object.keys(input.updates),
          oldValues: task,
        },
      });
      return { success: true } as const;
    }),

  removeTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [task] = await db.select().from(mapTasks).where(eq(mapTasks.id, input.taskId)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, task.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      await db
        .delete(mapTaskDependencies)
        .where(
          or(eq(mapTaskDependencies.sourceTaskId, task.id), eq(mapTaskDependencies.targetTaskId, task.id))
        );
      await db.delete(mapTasks).where(eq(mapTasks.id, task.id));

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.rejected",
        userId: ctx.user.id,
        targetId: task.id,
        targetType: "task",
        payload: { removed: true },
      });

      return { success: true } as const;
    }),

  changeTaskStatus: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        status: z.enum(TASK_STATUSES),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [task] = await db.select().from(mapTasks).where(eq(mapTasks.id, input.taskId)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, task.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      const allowed = VALID_STATUS_TRANSITIONS[task.status];
      if (!allowed.includes(input.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid task status transition: ${task.status} -> ${input.status}`,
        });
      }

      const updates: Record<string, unknown> = {
        status: input.status,
        updatedAt: new Date(),
      };
      if (task.status === "todo" && input.status === "in_progress" && !task.startDate) {
        updates.startDate = new Date();
      }
      if (input.status === "done") {
        updates.completedDate = new Date();
      }
      if (input.status === "blocked") {
        if (!input.reason?.trim()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Blocked status requires a reason",
          });
        }
        updates.blockedReason = input.reason.trim();
        updates.blockedSince = new Date();
      }
      if (task.status === "blocked" && input.status === "in_progress") {
        updates.blockedReason = null;
        updates.blockedSince = null;
      }

      await db.update(mapTasks).set(updates).where(eq(mapTasks.id, task.id));

      const eventType =
        input.status === "in_progress"
          ? task.status === "blocked"
            ? "task.unblocked"
            : "task.started"
          : input.status === "done"
          ? "task.completed"
          : input.status === "blocked"
          ? "task.blocked"
          : "kanban.card_moved";

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType,
        userId: ctx.user.id,
        targetId: task.id,
        targetType: "task",
        payload: {
          fromStatus: task.status,
          toStatus: input.status,
          reason: input.reason ?? null,
        },
      });
      return { success: true } as const;
    }),

  moveTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        phaseId: z.string(),
        orderInPhase: z.number().min(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [task] = await db.select().from(mapTasks).where(eq(mapTasks.id, input.taskId)).limit(1);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      const [targetPhase] = await db.select().from(mapPhases).where(eq(mapPhases.id, input.phaseId)).limit(1);
      if (!targetPhase) throw new TRPCError({ code: "BAD_REQUEST", message: "Target phase not found" });
      if (targetPhase.mapId !== task.mapId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot move task across different maps" });
      }

      await db
        .update(mapTasks)
        .set({
          phaseId: input.phaseId,
          orderInPhase: input.orderInPhase,
          updatedAt: new Date(),
        })
        .where(eq(mapTasks.id, task.id));

      await normalizeTaskOrder(db, task.phaseId);
      await normalizeTaskOrder(db, input.phaseId);

      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, task.mapId)).limit(1);
      if (map) {
        await trackMapEvent({
          mapId: map.id,
          trialId: map.trialId,
          eventType: "task.modified",
          userId: ctx.user.id,
          targetId: task.id,
          targetType: "task",
          payload: {
            fromPhaseId: task.phaseId,
            toPhaseId: input.phaseId,
            orderInPhase: input.orderInPhase,
          },
        });
      }
      return { success: true } as const;
    }),

  reorderTasks: protectedProcedure
    .input(z.object({ mapId: z.string(), phaseId: z.string(), orderedIds: z.array(z.string()).min(1) }))
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      for (let i = 0; i < input.orderedIds.length; i += 1) {
        await db
          .update(mapTasks)
          .set({ orderInPhase: i, updatedAt: new Date() })
          .where(
            and(
              eq(mapTasks.id, input.orderedIds[i]),
              eq(mapTasks.phaseId, input.phaseId),
              eq(mapTasks.mapId, map.id)
            )
          );
      }
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetType: "map",
        payload: { phaseId: input.phaseId, orderedIds: input.orderedIds },
      });
      return { success: true } as const;
    }),

  addDependency: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        sourceTaskId: z.string(),
        targetTaskId: z.string(),
        dependencyType: z
          .enum(["finish_to_start", "start_to_start", "finish_to_finish", "concurrent", "blocked_by"])
          .default("finish_to_start"),
        conditionLabel: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      const hasCycle = await wouldCreateDependencyCycle({
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
      });
      if (hasCycle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Dependency would create a cycle. The map must remain acyclic.",
        });
      }

      const [sourceTask] = await db
        .select({ phaseId: mapTasks.phaseId, mapId: mapTasks.mapId })
        .from(mapTasks)
        .where(eq(mapTasks.id, input.sourceTaskId))
        .limit(1);
      const [targetTask] = await db
        .select({ phaseId: mapTasks.phaseId, mapId: mapTasks.mapId })
        .from(mapTasks)
        .where(eq(mapTasks.id, input.targetTaskId))
        .limit(1);
      if (!sourceTask || !targetTask || sourceTask.mapId !== map.id || targetTask.mapId !== map.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Dependency tasks must belong to this map" });
      }

      const id = randomUUID();
      await db.insert(mapTaskDependencies).values({
        id,
        sourceTaskId: input.sourceTaskId,
        targetTaskId: input.targetTaskId,
        dependencyType: input.dependencyType,
        conditionLabel: input.conditionLabel ?? null,
        isCrossPhase: sourceTask.phaseId !== targetTask.phaseId,
        createdAt: new Date(),
      });

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "dependency.added",
        userId: ctx.user.id,
        targetId: id,
        targetType: "dependency",
        payload: {
          sourceTaskId: input.sourceTaskId,
          targetTaskId: input.targetTaskId,
          dependencyType: input.dependencyType,
        },
      });

      const [created] = await db
        .select()
        .from(mapTaskDependencies)
        .where(eq(mapTaskDependencies.id, id))
        .limit(1);
      return created;
    }),

  removeDependency: protectedProcedure
    .input(z.object({ dependencyId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [dep] = await db
        .select()
        .from(mapTaskDependencies)
        .where(eq(mapTaskDependencies.id, input.dependencyId))
        .limit(1);
      if (!dep) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
      const [sourceTask] = await db
        .select({ mapId: mapTasks.mapId })
        .from(mapTasks)
        .where(eq(mapTasks.id, dep.sourceTaskId))
        .limit(1);
      if (!sourceTask) throw new TRPCError({ code: "NOT_FOUND", message: "Source task not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, sourceTask.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      await db.delete(mapTaskDependencies).where(eq(mapTaskDependencies.id, dep.id));
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "dependency.removed",
        userId: ctx.user.id,
        targetId: dep.id,
        targetType: "dependency",
        payload: { sourceTaskId: dep.sourceTaskId, targetTaskId: dep.targetTaskId },
      });
      return { success: true } as const;
    }),

  addTransition: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        fromPhaseId: z.string(),
        toPhaseId: z.string(),
        conditionLabel: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { db, map } = await getMapByIdOrThrow(input.mapId);
      const [fromPhase] = await db
        .select({ mapId: mapPhases.mapId })
        .from(mapPhases)
        .where(eq(mapPhases.id, input.fromPhaseId))
        .limit(1);
      const [toPhase] = await db
        .select({ mapId: mapPhases.mapId })
        .from(mapPhases)
        .where(eq(mapPhases.id, input.toPhaseId))
        .limit(1);
      if (!fromPhase || !toPhase || fromPhase.mapId !== map.id || toPhase.mapId !== map.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Phase transition must stay within a map" });
      }
      const id = randomUUID();
      await db.insert(mapPhaseTransitions).values({
        id,
        fromPhaseId: input.fromPhaseId,
        toPhaseId: input.toPhaseId,
        conditionLabel: input.conditionLabel ?? null,
        isDefault: input.isDefault ?? true,
        createdAt: new Date(),
      });
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetId: id,
        targetType: "phase",
        payload: { transition: true },
      });
      const [created] = await db.select().from(mapPhaseTransitions).where(eq(mapPhaseTransitions.id, id)).limit(1);
      return created;
    }),

  updateTransition: protectedProcedure
    .input(
      z.object({
        transitionId: z.string(),
        updates: z.object({ conditionLabel: z.string().nullable().optional(), isDefault: z.boolean().optional() }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [transition] = await db
        .select()
        .from(mapPhaseTransitions)
        .where(eq(mapPhaseTransitions.id, input.transitionId))
        .limit(1);
      if (!transition) throw new TRPCError({ code: "NOT_FOUND", message: "Transition not found" });
      const [fromPhase] = await db
        .select({ mapId: mapPhases.mapId })
        .from(mapPhases)
        .where(eq(mapPhases.id, transition.fromPhaseId))
        .limit(1);
      if (!fromPhase) throw new TRPCError({ code: "NOT_FOUND", message: "Origin phase not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, fromPhase.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      await db
        .update(mapPhaseTransitions)
        .set({
          conditionLabel:
            input.updates.conditionLabel === undefined
              ? transition.conditionLabel
              : input.updates.conditionLabel,
          isDefault: input.updates.isDefault ?? transition.isDefault,
        })
        .where(eq(mapPhaseTransitions.id, transition.id));

      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetId: transition.id,
        targetType: "phase",
        payload: { transitionUpdated: true, fieldsChanged: Object.keys(input.updates) },
      });
      return { success: true } as const;
    }),

  removeTransition: protectedProcedure
    .input(z.object({ transitionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [transition] = await db
        .select()
        .from(mapPhaseTransitions)
        .where(eq(mapPhaseTransitions.id, input.transitionId))
        .limit(1);
      if (!transition) throw new TRPCError({ code: "NOT_FOUND", message: "Transition not found" });
      const [fromPhase] = await db
        .select({ mapId: mapPhases.mapId })
        .from(mapPhases)
        .where(eq(mapPhases.id, transition.fromPhaseId))
        .limit(1);
      if (!fromPhase) throw new TRPCError({ code: "NOT_FOUND", message: "Origin phase not found" });
      const [map] = await db.select().from(executionMaps).where(eq(executionMaps.id, fromPhase.mapId)).limit(1);
      if (!map) throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });

      await db.delete(mapPhaseTransitions).where(eq(mapPhaseTransitions.id, transition.id));
      await trackMapEvent({
        mapId: map.id,
        trialId: map.trialId,
        eventType: "task.modified",
        userId: ctx.user.id,
        targetId: transition.id,
        targetType: "phase",
        payload: { transitionRemoved: true },
      });
      return { success: true } as const;
    }),

  logTelemetry: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        trialId: z.string(),
        eventType: z.string(),
        targetId: z.string().optional(),
        targetType: z.enum(["task", "phase", "dependency", "map"]).optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await trackMapEvent({
        mapId: input.mapId,
        trialId: input.trialId,
        eventType: input.eventType,
        userId: ctx.user.id,
        targetId: input.targetId,
        targetType: input.targetType,
        payload: input.payload,
      });
      return { success: true } as const;
    }),

  listTelemetry: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        eventTypes: z.array(z.string()).optional(),
        limit: z.number().min(1).max(500).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const base = await db
        .select()
        .from(mapTelemetryEvents)
        .where(eq(mapTelemetryEvents.mapId, input.mapId))
        .orderBy(desc(mapTelemetryEvents.createdAt))
        .limit(input.limit ?? 100);
      if (!input.eventTypes?.length) return base;
      const wanted = new Set(input.eventTypes);
      return base.filter((row) => wanted.has(row.eventType));
    }),
});
