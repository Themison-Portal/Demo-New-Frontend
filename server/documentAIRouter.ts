import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { resolveTrialId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { callBackend } from "./_core/backendClient";
import { getCoreBackendClient } from "./_core/coreBackendClient";
import { authTokenFrom, resolveBeTrialIdForRead } from "./_core/coreBackendDocs";
import type { CoreBackendTrialDocument } from "@shared/coreBackendTypes";
// Type-only: the protocolContext module stays for scaffold generation. The
// chunk-ranking helpers below are legacy (the FE-local RAG chat path is
// retired) and unused, but kept until protocolContext is finalized.
import type { ProtocolContextChunk } from "./_core/protocolContext";

/**
 * Documents are owned by the BE. Document chat/worksheet query the BE's
 * `/api/document-ai/chat` (→ RAG) by BE document UUID; the FE `protocols`
 * table and the FE-local RAG fallback are retired here.
 */

type DocumentAISource = {
    fileId?: string;
    filename?: string;
    fileUrl?: string;
    /** BE document UUID (the FE document identity post-retirement). */
    documentId?: string;
    excerpt?: string;
    section?: string;
    category?: string | null;
    page?: number | null;
    bboxes?: number[][];
    highlightUrl?: string;
};

type WorksheetBlockType = "text" | "heading1" | "heading2" | "heading3" | "checklist";

type WorksheetBlock = {
    id: string;
    type: WorksheetBlockType;
    content: string;
    checked?: boolean;
};

type QuestionType =
    | "protocol_question"
    | "schedule_question"
    | "task_question"
    | "safety_question"
    | "document_management_question"
    | "general_question";

function extractTextContent(rawContent: unknown): string {
    if (typeof rawContent === "string") return rawContent;
    if (!Array.isArray(rawContent)) return "";
    return rawContent
        .filter((item) => item && typeof item === "object" && (item as any).type === "text")
        .map((item) => String((item as any).text ?? ""))
        .join("\n")
        .trim();
}

function extractJsonObject(raw: string) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch { }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            return null;
        }
    }
    return null;
}

function normalizeWorksheetBlockType(value?: string): WorksheetBlockType {
    const token = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
    if (token === "heading1" || token === "h1") return "heading1";
    if (token === "heading2" || token === "h2") return "heading2";
    if (token === "heading3" || token === "h3") return "heading3";
    if (token === "checklist" || token === "checkbox" || token === "todo") return "checklist";
    return "text";
}

function classifyQuestionType(value: string): QuestionType {
    const question = String(value || "").toLowerCase();
    if (!question) return "general_question";
    if (/\b(visit|window|schedule|timeline|soa|cycle|day)\b/.test(question)) return "schedule_question";
    if (/\b(task|todo|to do|owner|assignee|deadline|due|action)\b/.test(question)) return "task_question";
    if (/\b(adverse event|serious adverse|safety|toxicity|dose hold|stop dosing)\b/.test(question)) {
        return "safety_question";
    }
    if (/\b(document|upload|file|category|version|amendment version)\b/.test(question)) {
        return "document_management_question";
    }
    if (/\b(protocol|amendment|eligibility|criterion|criteria|endpoint|section)\b/.test(question)) {
        return "protocol_question";
    }
    return "general_question";
}

function normalizeWorksheetBlocks(rawBlocks: unknown): WorksheetBlock[] {
    if (!Array.isArray(rawBlocks)) return [];
    return rawBlocks
        .map((entry, index) => {
            const row = entry as any;
            const content = String(row?.content || "").trim();
            if (!content) return null;
            const type = normalizeWorksheetBlockType(row?.type);
            return {
                id: `blk-${Date.now()}-${index}`,
                type,
                content,
                ...(type === "checklist" ? { checked: Boolean(row?.checked) } : {}),
            } as WorksheetBlock;
        })
        .filter((entry): entry is WorksheetBlock => Boolean(entry))
        .slice(0, 120);
}

function createFallbackWorksheet(
    question: string,
    answer: string,
    sources: DocumentAISource[]
): { title: string; subtitle: string; blocks: WorksheetBlock[] } {
    const visitMatch = question.match(/visit\s*([a-z0-9-]+)/i);
    const visitLabel = visitMatch ? `Visit ${visitMatch[1].toUpperCase()}` : "Visit Worksheet";
    const protocolLabel = sources.find((source) => source.filename)?.filename || "Protocol";
    const summaryLines = answer
        .split("\n")
        .map((line) => line.replace(/^[-*]\s*/, "").trim())
        .filter((line) => line.length > 0)
        .slice(0, 8);
    const checklistItems = summaryLines.length
        ? summaryLines
        : [
            "Confirm subject identity and visit window eligibility",
            "Perform required safety assessments",
            "Collect protocol-required labs",
            "Document adverse events and concomitant medications",
            "Complete source notes and required forms",
        ];

    const blocks: WorksheetBlock[] = [
        {
            id: "fallback-heading-1",
            type: "heading2",
            content: "Pre-Visit Checklist",
        },
        ...checklistItems.slice(0, 5).map((item, index) => ({
            id: `fallback-check-${index + 1}`,
            type: "checklist" as const,
            content: item,
            checked: false,
        })),
        {
            id: "fallback-heading-2",
            type: "heading2",
            content: "Source Verification",
        },
        ...sources.slice(0, 4).map((source, index) => ({
            id: `fallback-source-${index + 1}`,
            type: "text" as const,
            content: `${source.filename || "Document"}${source.section ? ` — ${source.section}` : ""}${source.page ? ` (Page ${source.page})` : ""
                }`,
        })),
    ];

    return {
        title: `${visitLabel} Worksheet`,
        subtitle: protocolLabel,
        blocks,
    };
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
    const hay = normalizeLite(`${chunk.sectionTitle || ""} ${chunk.sectionType} ${chunk.chunkText.slice(0, 2400)}`);
    let score = 0;
    for (const term of terms) {
        const occurrences = hay.split(term).length - 1;
        score += Math.min(occurrences, 8);
    }
    return score;
}

function isAmendmentLike(text: string) {
    const normalized = normalizeLite(text);
    return /\bamendment\b|\brevision history\b|\bchange log\b|\bupdated\b/.test(normalized);
}

function shouldRescueCoverage(query: string, answer: string) {
    if (!isComprehensiveQuestion(query)) return false;
    const normalized = answer.toLowerCase();
    return (
        normalized.includes("not provided in the retrieved protocol context") ||
        normalized.includes("does not provide the full list") ||
        normalized.includes("insufficient") ||
        normalized.includes("not available in the provided context")
    );
}

function buildRescueCoverageChunks(query: string, allChunks: ProtocolContextChunk[]) {
    if (!allChunks.length) return [];

    const ordered = [...allChunks].sort((a, b) => {
        const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
        const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
        if (ap !== bp) return ap - bp;
        return a.id - b.id;
    });

    const normalizedQuery = normalizeLite(query);
    const wantsInclusion = /\binclusion\b/.test(normalizedQuery) && /\bcriteria\b/.test(normalizedQuery);
    const wantsExclusion = /\bexclusion\b/.test(normalizedQuery) && /\bcriteria\b/.test(normalizedQuery);

    if (wantsInclusion || wantsExclusion) {
        const headingPattern = wantsInclusion ? /\binclusion criteria\b/ : /\bexclusion criteria\b/;
        const stopPattern = wantsInclusion
            ? /\bexclusion criteria\b/
            : /\b(study treatment|objectives|endpoints|study procedures|schedule of activities)\b/;

        let anchorIndex = -1;
        for (let i = 0; i < ordered.length; i += 1) {
            const head = `${ordered[i].sectionTitle || ""} ${ordered[i].chunkText.slice(0, 1000)}`;
            if (headingPattern.test(normalizeLite(head)) && !isAmendmentLike(head)) {
                anchorIndex = i;
                break;
            }
        }

        if (anchorIndex < 0) {
            anchorIndex = ordered.findIndex(
                (chunk) =>
                    chunk.sectionType === "eligibility" &&
                    !isAmendmentLike(`${chunk.sectionTitle || ""} ${chunk.chunkText.slice(0, 1000)}`)
            );
        }

        if (anchorIndex >= 0) {
            const result: ProtocolContextChunk[] = [];
            const start = Math.max(0, anchorIndex - 1);
            for (let i = start; i < ordered.length; i += 1) {
                const chunk = ordered[i];
                const hay = normalizeLite(`${chunk.sectionTitle || ""} ${chunk.chunkText.slice(0, 900)}`);
                if (i > anchorIndex && stopPattern.test(hay)) break;
                result.push(chunk);
                if (result.length >= 56) break;
            }
            if (result.length > 0) return result;
        }
    }

    const ranked = ordered
        .map((chunk) => ({ chunk, score: scoreChunkLite(query, chunk) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score);

    const selected = new Set<number>();
    const anchors = ranked.slice(0, 10).map((row) => row.chunk.id);
    for (const anchorId of anchors) {
        const idx = ordered.findIndex((row) => row.id === anchorId);
        if (idx < 0) continue;
        for (let i = Math.max(0, idx - 4); i <= Math.min(ordered.length - 1, idx + 6); i += 1) {
            selected.add(ordered[i].id);
        }
    }

    return ordered.filter((chunk) => selected.has(chunk.id)).slice(0, 56);
}

function buildPromptContext(
    chunks: ProtocolContextChunk[],
    options: { maxChunks: number; maxChars: number; perChunkChars: number }
) {
    const { maxChunks, maxChars, perChunkChars } = options;
    const seen = new Set<string>();
    const selected: ProtocolContextChunk[] = [];
    const sections: string[] = [];
    let totalChars = 0;

    for (const chunk of chunks) {
        const key = `${chunk.protocolId}:${chunk.id}`;
        if (seen.has(key)) continue;
        if (selected.length >= maxChunks) break;

        const snippet = chunk.chunkText.slice(0, perChunkChars);
        const header = `[Protocol ${chunk.protocolId}] ${chunk.citation.filename} | ${chunk.sectionTitle || chunk.sectionType} | ${chunk.citation.page
            }`;
        const block = `${header}\n${snippet}`;
        if (totalChars + block.length > maxChars && selected.length > 0) break;

        selected.push(chunk);
        sections.push(block);
        seen.add(key);
        totalChars += block.length;
    }

    return {
        selectedChunks: selected,
        contextText: sections.join("\n\n---\n\n"),
    };
}

/**
 * Query a set of BE documents via the BE's /api/document-ai/chat endpoint
 * (→ RAG) and map the BE's sources back to the FE source shape (joining with the
 * BE document row for fileUrl/category). `documentIds` are BE document UUIDs.
 * Returns null if the BE call fails. Shared by the selected-document path and
 * the "All Documents" path.
 */
async function queryViaCoreBackend(params: {
    docs: CoreBackendTrialDocument[];
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    resolvedTrialId: string | undefined;
    sessionId: string | undefined;
    user: unknown;
    authToken: string | null;
    questionType: string;
}): Promise<{ message: string; thinking?: string; sources: DocumentAISource[] } | null> {
    const { docs, messages, resolvedTrialId, sessionId, user, authToken, questionType } = params;
    try {
        const beResponse = await callBackend<{
            message: string;
            sources: Array<{
                fileId: string;
                filename: string;
                section?: string | null;
                page?: number | null;
                excerpt: string;
                relevance?: string | null;
                bboxes?: number[][] | null;
            }>;
            route: string;
            documentsQueried: number;
            documentsWithSources: number;
            model?: string | null;
        }>("/api/document-ai/chat", {
            method: "POST",
            body: {
                messages,
                documentIds: docs.map((d) => d.id),
                trialId: resolvedTrialId ?? null,
                sessionId: sessionId ?? null,
            },
            user: user as any,
            // Forward the real bearer token so the BE attributes the chat to the
            // logged-in user instead of the proxy-header demo fallback.
            authToken,
        });

        // Map BE sources back to the FE source shape, joining with the BE document
        // row (keyed by UUID) so the UI keeps documentId, fileUrl, category, etc.
        const docByBeId = new Map(docs.map((d) => [d.id, d]));

        // Fetch download URLs for all docs that have bboxes or excerpts in sources
        const downloadUrlCache = new Map<string, string>();
        await Promise.all(
            beResponse.sources
                .filter((src) => (Array.isArray(src.bboxes) && src.bboxes.length > 0) || !!src.excerpt)
                .map(async (src) => {
                    if (!downloadUrlCache.has(src.fileId)) {
                        try {
                            const token = authTokenFrom(params.user as any);
                            console.log("[highlight] fetching download URL for", src.fileId, "token:", token ? "present" : "MISSING");
                            const result = await getCoreBackendClient().getDownloadUrl(src.fileId, token);
                            console.log("[highlight] download URL result:", result?.url);
                            if (result?.url) {
                                let resolvedUrl = result.url;
                                if (resolvedUrl.includes("localhost") || resolvedUrl.includes("127.0.0.1")) {
                                    resolvedUrl = resolvedUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, ENV.fastapiBackendUrl.replace(/\/$/, ""));
                                }
                                downloadUrlCache.set(src.fileId, resolvedUrl);
                            }
                        } catch (e) {
                            console.error("[highlight] getDownloadUrl failed:", e);
                            // fallback to blob path
                        }
                    }
                })
        );


        const sources: DocumentAISource[] = beResponse.sources.map((src) => {
            const doc = docByBeId.get(src.fileId);
            let fileUrl = downloadUrlCache.get(src.fileId) || doc?.document_url;
            if (fileUrl && (fileUrl.includes("localhost") || fileUrl.includes("127.0.0.1"))) {
                fileUrl = fileUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/, ENV.fastapiBackendUrl.replace(/\/$/, ""));
            }
            const page = typeof src.page === "number" ? src.page : null;
            const bboxes = Array.isArray(src.bboxes) ? src.bboxes : undefined;
            // Generate highlightUrl if we have bboxes OR an excerpt, plus a page, fileUrl, and FastAPI backend URL
            const hasHighlights = (bboxes && bboxes.length > 0) || !!src.excerpt;
            const highlightUrl =
                hasHighlights && page && fileUrl && ENV.fastapiBackendUrl
                    ? `${ENV.fastapiBackendUrl.replace(/\/$/, "")}/query/highlighted-pdf` +
                    `?doc=${encodeURIComponent(fileUrl)}` +
                    `&page=${page}` +
                    (bboxes && bboxes.length > 0 ? `&bboxes=${encodeURIComponent(JSON.stringify(bboxes))}` : "") +
                    (src.excerpt ? `&exact_text=${encodeURIComponent(src.excerpt)}` : "")
                    : undefined;
            console.log("[BFF highlight debug]", {
                hasFileUrl: !!fileUrl,
                hasBboxes: !!(bboxes && bboxes.length > 0),
                hasPage: !!page,
                hasFastapiUrl: !!ENV.fastapiBackendUrl,
                fastapiBackendUrl: ENV.fastapiBackendUrl,
                bboxes,
                page,
                fileUrl,
                highlightUrl,
            });
            return {
                fileId: src.fileId,
                filename: src.filename || doc?.document_name,
                fileUrl,
                documentId: src.fileId,
                category: doc?.category ?? doc?.document_type ?? null,
                excerpt: src.excerpt,
                section: src.section ?? undefined,
                page,
                bboxes,
                highlightUrl,
            };
        });

        await logTelemetryEvent({
            eventType: "ai_response_generated",
            action: "generated",
            sessionId,
            entityType: "response",
            payload: {
                route: "core_backend_document_ai",
                backendRoute: beResponse.route,
                docCount: docs.length,
                docsWithSources: beResponse.documentsWithSources,
                citationCount: sources.length,
                questionType,
                model: beResponse.model ?? null,
            },
            aiInvolved: true,
            aiOutput: beResponse.message,
            aiSources: sources,
        });

        return {
            message: beResponse.message,
            thinking: `Queried BE document-AI across ${beResponse.documentsQueried} document(s); ${beResponse.documentsWithSources} returned citations.`,
            sources,
        };
    } catch (error) {
        console.warn(
            "[Document AI] BE /api/document-ai/chat failed.",
            error
        );
        return null;
    }
}

export const documentAIRouter = router({
    /**
     * RAG-powered chat with Themison AI using OpenAI Assistants API
     * Searches across trial documents using OpenAI's managed vector database
     */
    chat: publicProcedure
        .input(
            z.object({
                messages: z.array(
                    z.object({
                        role: z.enum(["user", "assistant"]),
                        content: z.string(),
                    })
                ),
                documentIds: z.array(z.string()).optional(), // Optional: specific documents to query
                trialId: z.string().optional(),
                demoMode: z.enum(["sample", "full", "building"]).optional(),
                sessionId: z.string().optional(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const mode = (input.demoMode ?? "sample") as DemoMode;
            let resolvedTrialId: string | undefined;
            if (input.trialId && input.trialId !== "all") {
                resolvedTrialId = await resolveTrialId(mode, input.trialId, mode !== "building");
            }

            // Get the latest user message
            const latestUserMessage = [...input.messages].reverse().find(m => m.role === 'user');

            if (!latestUserMessage) {
                return {
                    message: "No user message found",
                };
            }
            const questionType = classifyQuestionType(latestUserMessage.content);

            await logTelemetryEvent({
                eventType: "ai_query_submitted",
                action: "submitted",
                sessionId: input.sessionId,
                entityType: "query",
                payload: {
                    query: latestUserMessage.content,
                    questionType,
                    trialId: resolvedTrialId ?? null,
                    demoMode: mode,
                    documentIds: input.documentIds ?? [],
                },
                aiInvolved: true,
            });

            if (!ENV.coreBackendApiUrl) {
                return {
                    message: "AI chat is unavailable: the backend is not configured.",
                    sources: [],
                };
            }

            const token = authTokenFrom(ctx);
            const client = getCoreBackendClient();

            // Resolve the BE documents to query. Documents are BE-owned; their UUIDs
            // come from the BE, never from FE MySQL.
            let docs: CoreBackendTrialDocument[] = [];
            if (!input.documentIds || input.documentIds.length === 0) {
                // "All Documents": list the trial's BE documents (prefer indexed, cap
                // the fan-out). No FE-local fallback — the FE-local RAG is retired.
                // If the trial can't be resolved (building/cross-trial mode) or has
                // no indexed docs, we deliberately fall through with docs=[] so the
                // query still reaches the BE and gets recorded; the BE returns its
                // own no-documents guidance message.
                const beTrialId = input.trialId
                    ? await resolveBeTrialIdForRead(mode, input.trialId)
                    : null;
                if (beTrialId) {
                    const ALL_DOCS_CAP = 10;
                    try {
                        const all = await client.listTrialDocuments(beTrialId, token);
                        const indexed = all.filter(
                            (d) =>
                                d.ingestion_status === "ready" || d.ingestion_status === "complete"
                        );
                        docs = (indexed.length > 0 ? indexed : all).slice(0, ALL_DOCS_CAP);
                    } catch (error) {
                        console.warn("[Document AI] BE list failed in All-Documents mode.", error);
                    }
                }
            } else {
                // Selected documents: the ids ARE BE document UUIDs (the FE document
                // identity). Fetch the BE docs (for source enrichment).
                docs = (
                    await Promise.all(
                        input.documentIds.map(async (id) => {
                            try {
                                return await client.getTrialDocument(id, token);
                            } catch {
                                return null;
                            }
                        })
                    )
                ).filter((d): d is CoreBackendTrialDocument => d !== null);
            }

            const beResult = await queryViaCoreBackend({
                docs,
                messages: input.messages,
                resolvedTrialId,
                sessionId: input.sessionId,
                user: ctx.user,
                // Raw bearer token (null when unauthenticated) — lets the BE
                // attribute the chat to the real logged-in user.
                authToken: ctx.authToken ?? null,
                questionType,
            });
            if (beResult) return beResult;

            await logTelemetryEvent({
                eventType: "ai_response_generated",
                action: "generated",
                sessionId: input.sessionId,
                entityType: "response",
                payload: {
                    route: "no_results",
                    docCount: docs.length,
                    questionType,
                },
                aiInvolved: true,
            });

            return {
                message:
                    "I couldn't reach the AI service just now. Please try again in a moment.",
                sources: [],
            };
        }),

    generateWorksheet: publicProcedure
        .input(
            z.object({
                question: z.string().min(1),
                answer: z.string().optional(),
                trialId: z.string().optional(),
                demoMode: z.enum(["sample", "full", "building"]).optional(),
                sources: z
                    .array(
                        z.object({
                            filename: z.string().optional(),
                            fileUrl: z.string().optional(),
                            documentId: z.string().optional(),
                            excerpt: z.string().optional(),
                            section: z.string().optional(),
                            category: z.string().nullable().optional(),
                            page: z.number().nullable().optional(),
                        })
                    )
                    .optional(),
            })
        )
        .mutation(async ({ input }) => {
            const sourceList = input.sources ?? [];

            const worksheetSources: DocumentAISource[] = sourceList.map((source) => ({
                filename: source.filename,
                fileUrl: source.fileUrl,
                documentId: source.documentId,
                excerpt: source.excerpt,
                section: source.section,
                category: source.category ?? null,
                page: source.page ?? null,
            }));
            let worksheetTitle = "";
            let worksheetSubtitle = "";
            let worksheetBlocks: WorksheetBlock[] = [];

            // Build the evidence context from the citation excerpts that came back
            // with the chat answer (documents are BE-owned; no FE-local chunk store).
            const contextText = worksheetSources
                .filter((s) => s.excerpt && s.excerpt.trim())
                .slice(0, 20)
                .map(
                    (s) =>
                        `[${s.filename || "Document"}${s.section ? ` | ${s.section}` : ""}${s.page ? ` | p${s.page}` : ""
                        }]\n${s.excerpt}`
                )
                .join("\n\n---\n\n");

            try {
                if (contextText.trim()) {
                    const response = await invokeLLM({
                        responseFormat: { type: "json_object" },
                        messages: [
                            {
                                role: "system",
                                content: `You create operational clinical visit worksheets for site teams.
Return strict JSON with this shape:
{
  "title": "string",
  "subtitle": "string",
  "blocks": [
    { "type": "heading2|heading3|text|checklist", "content": "string", "checked": false }
  ]
}
Rules:
- Focus on actionable visit workflow.
- Include concise checklist items nurses/PI can execute.
- Keep 12-40 blocks max.
- No markdown formatting in content.`,
                            },
                            {
                                role: "user",
                                content: `Question: ${input.question}
Assistant summary: ${input.answer || ""}

Evidence context:
${contextText}
`,
                            },
                        ],
                    });

                    const raw = extractTextContent(response.choices[0]?.message?.content);
                    const parsed = extractJsonObject(raw) as any;
                    const blocks = normalizeWorksheetBlocks(parsed?.blocks);
                    if (blocks.length > 0) {
                        worksheetTitle = String(parsed?.title || "").trim() || "Visit Worksheet";
                        worksheetSubtitle = String(parsed?.subtitle || "").trim();
                        worksheetBlocks = blocks;
                    }
                }
            } catch (error) {
                console.warn("[Document AI] Worksheet generation via LLM failed, using fallback.", error);
            }

            if (worksheetBlocks.length === 0) {
                const fallback = createFallbackWorksheet(input.question, input.answer || "", worksheetSources);
                worksheetTitle = fallback.title;
                worksheetSubtitle = fallback.subtitle;
                worksheetBlocks = fallback.blocks;
            }

            if (!worksheetSubtitle) {
                worksheetSubtitle =
                    worksheetSources.find((source) => source.filename)?.filename ||
                    "Protocol worksheet draft";
            }

            await logTelemetryEvent({
                eventType: "ai_response_generated",
                action: "worksheet_generated",
                sessionId: undefined,
                entityType: "worksheet",
                entityId: input.trialId,
                aiInvolved: true,
                aiOutput: `${worksheetTitle}\n${worksheetBlocks.map((block) => block.content).join("\n")}`,
                aiSources: worksheetSources,
                payload: {
                    question: input.question,
                    trialId: input.trialId,
                    blockCount: worksheetBlocks.length,
                },
            });

            return {
                title: worksheetTitle,
                subtitle: worksheetSubtitle,
                blocks: worksheetBlocks,
                sources: worksheetSources,
            };
        }),

    /**
     * (Re)trigger RAG ingestion for a single BE document by its UUID.
     */
    uploadDocument: protectedProcedure
        .input(
            z.object({
                coreBackendDocumentId: z.string(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            try {
                const retry = await callBackend<{
                    jobId: string;
                    documentId: string;
                    status: string;
                    message: string;
                }>(
                    `/api/document-ai/retry-ingestion/${encodeURIComponent(input.coreBackendDocumentId)}`,
                    { method: "POST", user: ctx.user }
                );
                return {
                    success: true,
                    message: retry.message || "Ingestion queued via core-backend",
                };
            } catch (error: any) {
                console.error("Error queuing document ingestion:", error);
                return {
                    success: false,
                    message: error.message || "Failed to queue ingestion",
                };
            }
        }),

    /**
     * (Re)trigger RAG ingestion for every BE document of a trial.
     */
    processTrialDocuments: protectedProcedure
        .input(
            z.object({
                trialId: z.string(),
                demoMode: z.enum(["sample", "full", "building"]).optional(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const mode = (input.demoMode ?? "sample") as DemoMode;
            const beTrialId = await resolveBeTrialIdForRead(mode, input.trialId);
            if (!beTrialId) {
                return { success: false, message: "No backend trial found for this trial" };
            }

            try {
                const token = authTokenFrom(ctx);
                const docs = await getCoreBackendClient().listTrialDocuments(beTrialId, token);
                if (docs.length === 0) {
                    return { success: false, message: "No documents found for this trial" };
                }

                let successCount = 0;
                let errorCount = 0;
                for (const doc of docs) {
                    try {
                        await callBackend<{ jobId: string; status: string; message: string }>(
                            `/api/document-ai/retry-ingestion/${encodeURIComponent(doc.id)}`,
                            { method: "POST", user: ctx.user }
                        );
                        successCount++;
                    } catch (error) {
                        console.error(`Error queuing reingestion for ${doc.document_name}:`, error);
                        errorCount++;
                    }
                }

                const parts = [`Queued reingestion for ${successCount} document(s)`];
                if (errorCount > 0) parts.push(`${errorCount} failed`);
                return { success: errorCount === 0, message: parts.join("; ") };
            } catch (error: any) {
                console.error("Error processing trial documents:", error);
                return {
                    success: false,
                    message: error.message || "Failed to process trial documents",
                };
            }
        }),
});
