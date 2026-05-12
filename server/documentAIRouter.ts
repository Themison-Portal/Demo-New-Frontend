import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { protocols, fileSearchStores, fileSearchDocuments } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { queryWithAssistant, uploadToVectorStore, createVectorStore } from "./_core/openaiAssistant";
import { resolveTrialId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { invokeLLM } from "./_core/llm";
import {
  getProtocolContextChunks,
  ingestProtocolContextChunks,
  type ProtocolContextChunk,
} from "./_core/protocolContext";
import { runUnifiedQuery } from "./_core/unifiedQuery";
import { ENV } from "./_core/env";
import { getCoreBackendClient } from "./_core/coreBackendClient";

const USES_EXTERNAL_RAG = ENV.ragProvider === "external";

type DocumentAISource = {
  fileId?: string;
  filename?: string;
  fileUrl?: string;
  protocolId?: number;
  excerpt?: string;
  section?: string;
  category?: string | null;
  page?: number | null;
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
  } catch {}
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
      content: `${source.filename || "Document"}${source.section ? ` — ${source.section}` : ""}${
        source.page ? ` (Page ${source.page})` : ""
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
    const header = `[Protocol ${chunk.protocolId}] ${chunk.citation.filename} | ${chunk.sectionTitle || chunk.sectionType} | ${
      chunk.citation.page
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

function buildSourcesFromChunks(
  chunks: ProtocolContextChunk[],
  protocolById: Map<number, typeof protocols.$inferSelect>
): DocumentAISource[] {
  const sourceMap = new Map<string, DocumentAISource>();
  for (const chunk of chunks) {
    const protocol = protocolById.get(chunk.protocolId);
    const key = `${chunk.protocolId}:${chunk.sectionTitle || chunk.sectionType}:${chunk.pageStart || chunk.pageEnd || ""}`;
    if (sourceMap.has(key)) continue;

    sourceMap.set(key, {
      filename: protocol?.filename || chunk.citation.filename,
      fileUrl: protocol?.fileUrl,
      protocolId: chunk.protocolId,
      category: protocol?.category ?? null,
      excerpt: chunk.chunkText.slice(0, 260),
      section: chunk.sectionTitle || chunk.sectionType,
      page: chunk.pageStart ?? chunk.pageEnd ?? null,
    });
  }
  return Array.from(sourceMap.values()).slice(0, 16);
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
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const mode = (input.demoMode ?? "sample") as DemoMode;
      let resolvedTrialId: string | undefined;
      if (input.trialId && input.trialId !== "all") {
        resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");
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

      // If no documents are explicitly selected, use unified retrieval for the active scope.
      // Fall back to basic LLM only if unified retrieval fails.
      if (!input.documentIds || input.documentIds.length === 0) {
        try {
          const unified = await runUnifiedQuery({
            db,
            query: latestUserMessage.content,
            messages: input.messages,
            trialId: resolvedTrialId,
            demoMode: mode,
            userId: ctx.user?.id,
          });

          await logTelemetryEvent({
            eventType: "ai_response_generated",
            action: "generated",
            sessionId: input.sessionId,
            entityType: "response",
            entityId: resolvedTrialId,
            payload: {
              route: unified.route,
              confidence: unified.confidence,
              abstained: unified.abstained,
              questionType,
            },
            aiInvolved: true,
            aiOutput: unified.message,
            aiSources: unified.sources,
          });

          return unified;
        } catch (error) {
          console.warn("[Document AI] Unified query path failed in unfiltered mode; falling back to basic assistant.", error);
        }

        // Build conversation history for context
        const conversationHistory = input.messages.map(msg => 
          `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join('\n\n');

        const systemPrompt = `You are Themison AI, a helpful assistant for clinical trial research teams. You help with:
- Understanding clinical trial protocols and procedures
- Answering questions about trial operations and regulations
- Providing guidance on study setup and execution
- Assisting with document analysis and organization

Be professional, accurate, and helpful. Use clear clinical terminology when appropriate.

Previous conversation:
${conversationHistory}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: latestUserMessage.content },
          ],
        });

        const rawContent = response.choices[0]?.message?.content;
        let answer = "I apologize, but I'm unable to generate a response at the moment.";
        
        if (typeof rawContent === 'string') {
          answer = rawContent;
        } else if (Array.isArray(rawContent)) {
          answer = rawContent
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');
        }

        await logTelemetryEvent({
          eventType: "ai_response_generated",
          action: "generated",
          sessionId: input.sessionId,
          entityType: "response",
          payload: {
            route: "fallback_llm",
            questionType,
          },
          aiInvolved: true,
          aiOutput: answer,
        });

        return {
          message: answer,
          thinking: "Analyzing your question about clinical trial procedures and searching my knowledge base for relevant information to provide an accurate response.",
        };
      }

      const documentIds = input.documentIds
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id));

      const selectedProtocols = documentIds.length
        ? await db.select().from(protocols).where(inArray(protocols.id, documentIds))
        : [];

      // Phase 4: when the selected docs are mapped to core-backend's
      // `trial_documents`, route the query through core-backend's
      // /query endpoint instead of the local pipeline. Each call uses
      // the X-API-Key auth mode and returns a cited answer. We fire
      // queries in parallel and pick the first that yields an answer
      // (multi-doc fan-in across answers is a future improvement).
      const coreBackendDocs = selectedProtocols.filter(
        (p): p is typeof p & { coreBackendDocumentId: string } =>
          !!p.coreBackendDocumentId
      );
      if (coreBackendDocs.length > 0 && ENV.coreBackendApiUrl) {
        try {
          const client = getCoreBackendClient();
          const results = await Promise.allSettled(
            coreBackendDocs.map((doc) =>
              client.query({
                query: latestUserMessage.content,
                document_id: doc.coreBackendDocumentId,
                document_name: doc.filename,
              }).then((res) => ({ doc, res }))
            )
          );
          const successes = results.flatMap((r) =>
            r.status === "fulfilled" ? [r.value] : []
          );
          if (successes.length > 0) {
            const primary = successes[0];
            const sources: DocumentAISource[] = successes.flatMap(({ doc, res }) =>
              (res.sources ?? []).map((src) => ({
                fileId: doc.coreBackendDocumentId,
                filename: doc.filename,
                fileUrl: doc.fileUrl,
                protocolId: doc.id,
                category: doc.category ?? null,
                excerpt: src.exact_text,
                section: src.section,
                page: typeof src.page === "number" ? src.page : null,
              }))
            );

            await logTelemetryEvent({
              eventType: "ai_response_generated",
              action: "generated",
              sessionId: input.sessionId,
              entityType: "response",
              payload: {
                route: "core_backend_query",
                docCount: coreBackendDocs.length,
                successCount: successes.length,
                citationCount: sources.length,
                questionType,
              },
              aiInvolved: true,
              aiOutput: primary.res.answer,
              aiSources: sources,
            });

            return {
              message: primary.res.answer,
              thinking: `Queried core-backend RAG across ${successes.length} of ${coreBackendDocs.length} selected document(s).`,
              sources,
            };
          }
          console.warn(
            "[Document AI] core-backend /query returned no successful results; falling back to local pipeline."
          );
        } catch (error) {
          console.warn(
            "[Document AI] core-backend /query path failed; falling back to local pipeline.",
            error
          );
        }
      }

      if (selectedProtocols.length === 0) {
        return {
          message: "The selected documents have not been processed yet. Please wait for processing to complete.",
        };
      }

      if (!resolvedTrialId) {
        resolvedTrialId = selectedProtocols[0]?.trialId;
      }

      try {
        const unified = await runUnifiedQuery({
          db,
          query: latestUserMessage.content,
          messages: input.messages,
          protocolIds: documentIds,
          trialId: resolvedTrialId,
          demoMode: mode,
          userId: ctx.user?.id,
        });

        await logTelemetryEvent({
          eventType: "ai_response_generated",
          action: "generated",
          sessionId: input.sessionId,
          entityType: "response",
          entityId: resolvedTrialId,
          payload: {
            route: unified.route,
            confidence: unified.confidence,
            abstained: unified.abstained,
            questionType,
          },
          aiInvolved: true,
          aiOutput: unified.message,
          aiSources: unified.sources,
        });

        return unified;
      } catch (error) {
        console.warn("[Document AI] Unified query path failed; falling back to legacy path.", error);
      }

      const protocolById = new Map(selectedProtocols.map((protocol) => [protocol.id, protocol]));

      try {
        const needsComprehensive = isComprehensiveQuestion(latestUserMessage.content);
        const sectionTypeHints = getSectionTypeHints(latestUserMessage.content);
        const chunkGroups = await Promise.all(
          selectedProtocols.map(async (protocol) => {
            const baseRequest = {
              protocolId: protocol.id,
              query: latestUserMessage.content,
              comprehensive: true as const,
              limit: needsComprehensive ? 10 : 6,
            };
            try {
              const broad = await getProtocolContextChunks(baseRequest);
              if (sectionTypeHints && sectionTypeHints.length > 0) {
                const focused = await getProtocolContextChunks({
                  ...baseRequest,
                  sectionTypes: sectionTypeHints,
                });
                if (focused.length > 0) {
                  const merged = [...focused];
                  const existing = new Set(merged.map((chunk) => chunk.id));
                  for (const chunk of broad) {
                    if (existing.has(chunk.id)) continue;
                    merged.push(chunk);
                    existing.add(chunk.id);
                  }
                  return merged;
                }
              }
              return broad;
            } catch (error) {
              console.warn("[Document AI] Failed to fetch protocol context chunks", protocol.id, error);
              return [];
            }
          })
        );

        const contextCandidates = chunkGroups.flat();
        const orderedCandidates = contextCandidates.sort((a, b) => {
          if (a.protocolId !== b.protocolId) return a.protocolId - b.protocolId;
          const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
          const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
          if (ap !== bp) return ap - bp;
          return a.id - b.id;
        });

        const { selectedChunks, contextText } = buildPromptContext(orderedCandidates, {
          maxChunks: needsComprehensive ? 28 : 14,
          maxChars: needsComprehensive ? 42000 : 24000,
          perChunkChars: needsComprehensive ? 2200 : 1500,
        });

        if (selectedChunks.length > 0 && contextText.trim().length > 0) {
          const history = input.messages
            .slice(-8, -1)
            .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
            .join("\n\n");

          const systemPrompt = `You are Themison AI for clinical trial operations.
You must answer using ONLY the retrieved protocol context.
If the question involves criteria, tables, schedules, procedures, visits, endpoints, or requirements:
- Be exhaustive and do not omit continuation rows across pages.
- Preserve numbering and sub-items when present.
- Include footnote conditions when they change applicability.
Always include source tags in this exact format: [Source: <filename>, <page label>].
If the retrieved context is insufficient, clearly state what is missing instead of guessing.`;

          const response = await invokeLLM({
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: `Conversation so far:\n${history}\n\nRetrieved protocol context:\n${contextText}\n\nQuestion: ${latestUserMessage.content}`,
              },
            ],
          });

          const answer =
            extractTextContent(response.choices[0]?.message?.content) ||
            "I could not generate a grounded answer from the selected protocol context.";
          let finalAnswer = answer;
          let finalSources = buildSourcesFromChunks(selectedChunks, protocolById);

          if (shouldRescueCoverage(latestUserMessage.content, answer)) {
            const rescueGroups = await Promise.all(
              selectedProtocols.map(async (protocol) => {
                try {
                  const allChunks = await getProtocolContextChunks({
                    protocolId: protocol.id,
                    limit: 2500,
                  });
                  return buildRescueCoverageChunks(latestUserMessage.content, allChunks);
                } catch (error) {
                  console.warn("[Document AI] Rescue coverage retrieval failed", protocol.id, error);
                  return [];
                }
              })
            );

            const rescueCandidates = rescueGroups.flat();
            if (rescueCandidates.length > 0) {
              const rescueContext = buildPromptContext(
                rescueCandidates.sort((a, b) => {
                  const ap = a.pageStart ?? Number.MAX_SAFE_INTEGER;
                  const bp = b.pageStart ?? Number.MAX_SAFE_INTEGER;
                  if (ap !== bp) return ap - bp;
                  return a.id - b.id;
                }),
                {
                  maxChunks: 48,
                  maxChars: 72000,
                  perChunkChars: 2400,
                }
              );

              const rescueResponse = await invokeLLM({
                messages: [
                  {
                    role: "system",
                    content:
                      "You are Themison AI. Produce a complete answer from provided protocol text. Do not claim information is missing if present. For list/criteria/table questions, return every listed item in order with sub-items and conditions. Cite sources as [Source: <filename>, <page label>].",
                  },
                  {
                    role: "user",
                    content: `Retrieved protocol context:\n${rescueContext.contextText}\n\nQuestion: ${latestUserMessage.content}`,
                  },
                ],
              });

              const rescuedAnswer = extractTextContent(rescueResponse.choices[0]?.message?.content);
              if (rescuedAnswer && rescuedAnswer.trim().length > 0) {
                finalAnswer = rescuedAnswer;
                finalSources = buildSourcesFromChunks(rescueContext.selectedChunks, protocolById);
              }
            }
          }

          await logTelemetryEvent({
            eventType: "ai_response_generated",
            action: "generated",
            sessionId: input.sessionId,
            entityType: "response",
            payload: {
              route: "selected_docs_local_context",
              needsComprehensive,
              selectedChunkCount: selectedChunks.length,
              questionType,
            },
            aiInvolved: true,
            aiOutput: finalAnswer,
            aiSources: finalSources,
          });

          return {
            message: finalAnswer,
            thinking: needsComprehensive
              ? "Cross-checking structured and continued protocol sections to return complete criteria/procedure coverage."
              : "Grounding the response in relevant protocol sections and page-level citations.",
            sources: finalSources,
          };
        }
      } catch (error) {
        console.warn("[Document AI] Local protocol-context answer path failed; falling back to assistant retrieval.", error);
      }

      try {
        if (USES_EXTERNAL_RAG) {
          return {
            message:
              "Fallback assistant retrieval is disabled in external RAG mode. Retry your question to use local protocol context retrieval.",
          };
        }

        const docs = await db
          .select()
          .from(fileSearchDocuments)
          .where(inArray(fileSearchDocuments.protocolId, documentIds));

        if (docs.length === 0) {
          return {
            message: "The selected documents have not been processed yet. Please wait for processing to complete.",
          };
        }

        const storeIds = Array.from(new Set(docs.map((doc) => doc.storeId)));
        const stores = await db.select().from(fileSearchStores).where(inArray(fileSearchStores.id, storeIds));
        const storeNames = stores.map((store) => store.storeName);

        const { answer, citations } = await queryWithAssistant(latestUserMessage.content, storeNames);

        let sources: DocumentAISource[] = [];
        if (citations && citations.length > 0) {
          const fileIds = Array.from(
            new Set(
              citations
                .map((citation: any) => citation.file_id)
                .filter((id: string | undefined): id is string => Boolean(id))
            )
          );

          if (fileIds.length > 0) {
            const fileDocs = await db
              .select()
              .from(fileSearchDocuments)
              .where(inArray(fileSearchDocuments.documentName, fileIds));

            const protocolIds = Array.from(new Set(fileDocs.map((doc) => doc.protocolId)));
            const protocolRows = protocolIds.length
              ? await db.select().from(protocols).where(inArray(protocols.id, protocolIds))
              : [];

            const fileDocById = new Map(fileDocs.map((doc) => [doc.documentName, doc]));
            const protocolLookup = new Map(protocolRows.map((protocol) => [protocol.id, protocol]));

            sources = citations.map((citation: any) => {
              const fileId = citation.file_id;
              const fileDoc = fileId ? fileDocById.get(fileId) : undefined;
              const protocol = fileDoc ? protocolLookup.get(fileDoc.protocolId) : undefined;

              return {
                fileId,
                filename: protocol?.filename || fileDoc?.displayName || citation.file_name || fileId,
                fileUrl: protocol?.fileUrl,
                protocolId: fileDoc?.protocolId,
                category: protocol?.category ?? null,
                excerpt: citation.text,
                section: citation.section,
                page: citation.page_number ?? null,
              };
            });
          }
        }

        await logTelemetryEvent({
          eventType: "ai_response_generated",
          action: "generated",
          sessionId: input.sessionId,
          entityType: "response",
          payload: {
            route: "selected_docs_assistant_retrieval",
            storeCount: storeNames.length,
            citationCount: Array.isArray(citations) ? citations.length : 0,
            questionType,
          },
          aiInvolved: true,
          aiOutput: answer,
          aiSources: sources,
        });

        return {
          message: answer,
          thinking: `Using assistant retrieval across ${storeNames.length} indexed document store(s).`,
          citations,
          sources,
        };
      } catch (error: any) {
        console.error("Error querying with File Search:", error);
        return {
          message: "Sorry, I encountered an error while searching the documents. Please try again.",
        };
      }
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
              protocolId: z.number().optional(),
              excerpt: z.string().optional(),
              section: z.string().optional(),
              category: z.string().nullable().optional(),
              page: z.number().nullable().optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      let resolvedTrialId: string | undefined;
      if (input.trialId && input.trialId !== "all") {
        resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");
      }

      const sourceList = input.sources ?? [];
      const sourceProtocolIds = Array.from(
        new Set(
          sourceList
            .map((source) => source.protocolId)
            .filter((id): id is number => Number.isFinite(id))
        )
      );

      let worksheetSources: DocumentAISource[] = sourceList.map((source) => ({
        filename: source.filename,
        fileUrl: source.fileUrl,
        protocolId: source.protocolId,
        excerpt: source.excerpt,
        section: source.section,
        category: source.category ?? null,
        page: source.page ?? null,
      }));
      let worksheetTitle = "";
      let worksheetSubtitle = "";
      let worksheetBlocks: WorksheetBlock[] = [];

      let protocolRows: typeof protocols.$inferSelect[] = [];
      if (sourceProtocolIds.length > 0) {
        protocolRows = await db.select().from(protocols).where(inArray(protocols.id, sourceProtocolIds));
      } else if (resolvedTrialId) {
        protocolRows = await db.select().from(protocols).where(eq(protocols.trialId, resolvedTrialId));
      }
      const protocolById = new Map(protocolRows.map((row) => [row.id, row]));

      try {
        const chunkGroups = await Promise.all(
          protocolRows.slice(0, 4).map(async (protocol) => {
            try {
              return await getProtocolContextChunks({
                protocolId: protocol.id,
                query: input.question,
                comprehensive: true,
                limit: 10,
              });
            } catch (error) {
              console.warn("[Document AI] Failed to fetch worksheet context chunks", protocol.id, error);
              return [];
            }
          })
        );
        const contextCandidates = chunkGroups.flat();
        const { selectedChunks, contextText } = buildPromptContext(contextCandidates, {
          maxChunks: 20,
          maxChars: 36000,
          perChunkChars: 1800,
        });

        if (selectedChunks.length > 0 && contextText.trim()) {
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
            worksheetSources = buildSourcesFromChunks(selectedChunks, protocolById);
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
          protocolRows[0]?.filename ||
          "Protocol worksheet draft";
      }

      await logTelemetryEvent({
        eventType: "ai_response_generated",
        action: "worksheet_generated",
        sessionId: undefined,
        entityType: "worksheet",
        entityId: resolvedTrialId,
        aiInvolved: true,
        aiOutput: `${worksheetTitle}\n${worksheetBlocks.map((block) => block.content).join("\n")}`,
        aiSources: worksheetSources,
        payload: {
          question: input.question,
          trialId: resolvedTrialId,
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
   * Upload a document to Google File Search Store
   * Call this after a protocol is uploaded to S3
   */
  uploadDocument: protectedProcedure
    .input(
      z.object({
        protocolId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        // Get the protocol
        const protocol = await db
          .select()
          .from(protocols)
          .where(eq(protocols.id, input.protocolId))
          .limit(1);

        if (protocol.length === 0) {
          throw new Error("Protocol not found");
        }

        const doc = protocol[0];

        if (USES_EXTERNAL_RAG) {
          await ingestProtocolContextChunks({
            protocolId: doc.id,
            forceRefresh: true,
          });
          return {
            success: true,
            message: "Document context indexed successfully",
          };
        }

        // Get or create File Search Store for this trial
        let store = await db
          .select()
          .from(fileSearchStores)
          .where(eq(fileSearchStores.trialId, doc.trialId))
          .limit(1);

        let storeName: string;

        if (store.length === 0) {
          // Create new Vector Store
          storeName = await createVectorStore(`Trial ${doc.trialId} Documents`);
          
          // Save to database
          await db.insert(fileSearchStores).values({
            trialId: doc.trialId,
            storeName,
            displayName: `Trial ${doc.trialId} Documents`,
          });
        } else {
          storeName = store[0].storeName;
        }

        // Download the PDF from S3
        const response = await fetch(doc.fileUrl);
        const arrayBuffer = await response.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // Upload to OpenAI Vector Store
        const documentName = await uploadToVectorStore(
          fileBuffer,
          doc.filename,
          storeName
        );

        // Track the uploaded document
        await db.insert(fileSearchDocuments).values({
          storeId: store.length > 0 ? store[0].id : (await db.select().from(fileSearchStores).where(eq(fileSearchStores.storeName, storeName)))[0].id,
          protocolId: doc.id,
          documentName,
          displayName: doc.filename,
        });

        return {
          success: true,
          message: "Document uploaded and processed successfully",
        };
      } catch (error: any) {
        console.error('Error uploading document:', error);
        return {
          success: false,
          message: error.message || "Failed to upload document",
        };
      }
    }),

  /**
   * Process all documents for a trial (upload to File Search Store)
   */
  processTrialDocuments: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");

      try {
        // Get all protocols for this trial
        const docs = await db
          .select()
          .from(protocols)
          .where(eq(protocols.trialId, resolvedTrialId));

        if (docs.length === 0) {
          return {
            success: false,
            message: "No documents found for this trial",
          };
        }

        if (USES_EXTERNAL_RAG) {
          let successCount = 0;
          let errorCount = 0;
          for (const doc of docs) {
            try {
              await ingestProtocolContextChunks({
                protocolId: doc.id,
                forceRefresh: true,
              });
              successCount++;
            } catch (error) {
              console.error(`Error indexing local context for ${doc.filename}:`, error);
              errorCount++;
            }
          }

          return {
            success: errorCount === 0,
            message: `Processed local context for ${successCount} documents successfully${
              errorCount > 0 ? `, ${errorCount} failed` : ""
            }`,
          };
        }

        // Get or create File Search Store
        let store = await db
          .select()
          .from(fileSearchStores)
          .where(eq(fileSearchStores.trialId, resolvedTrialId))
          .limit(1);

        let storeName: string;
        let storeId: number;

        if (store.length === 0) {
          // Create new Vector Store
          storeName = await createVectorStore(`Trial ${resolvedTrialId} Documents`);
          
          // Save to database
          await db.insert(fileSearchStores).values({
            trialId: resolvedTrialId,
            storeName,
            displayName: `Trial ${resolvedTrialId} Documents`,
          });
          
          // Fetch the created store to get its ID
          const createdStore = await db
            .select()
            .from(fileSearchStores)
            .where(eq(fileSearchStores.storeName, storeName))
            .limit(1);
          
          storeId = createdStore[0].id;
        } else {
          storeName = store[0].storeName;
          storeId = store[0].id;
        }

        // Upload each document
        let successCount = 0;
        let errorCount = 0;

        for (const doc of docs) {
          try {
            // Check if already uploaded
            const existing = await db
              .select()
              .from(fileSearchDocuments)
              .where(eq(fileSearchDocuments.protocolId, doc.id))
              .limit(1);

            if (existing.length > 0) {
              console.log(`Document ${doc.filename} already uploaded, skipping`);
              successCount++;
              continue;
            }

            // Download from S3
            const response = await fetch(doc.fileUrl);
            const arrayBuffer = await response.arrayBuffer();
            const fileBuffer = Buffer.from(arrayBuffer);

            // Upload to OpenAI Vector Store
            const documentName = await uploadToVectorStore(
              fileBuffer,
              doc.filename,
              storeName
            );

            // Track the uploaded document
            await db.insert(fileSearchDocuments).values({
              storeId,
              protocolId: doc.id,
              documentName,
              displayName: doc.filename,
            });

            successCount++;
          } catch (error) {
            console.error(`Error uploading ${doc.filename}:`, error);
            errorCount++;
          }
        }

        return {
          success: errorCount === 0,
          message: `Processed ${successCount} documents successfully${errorCount > 0 ? `, ${errorCount} failed` : ''}`,
        };
      } catch (error: any) {
        console.error('Error processing trial documents:', error);
        return {
          success: false,
          message: error.message || "Failed to process trial documents",
        };
      }
    }),
});
