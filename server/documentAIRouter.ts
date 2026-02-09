import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { protocols, fileSearchStores, fileSearchDocuments } from "../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { queryWithAssistant, uploadToVectorStore, createVectorStore } from "./_core/openaiAssistant";
import { resolveTrialId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { invokeLLM } from "./_core/llm";
import { getProtocolContextChunks, type ProtocolContextChunk } from "./_core/protocolContext";

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

function extractTextContent(rawContent: unknown): string {
  if (typeof rawContent === "string") return rawContent;
  if (!Array.isArray(rawContent)) return "";
  return rawContent
    .filter((item) => item && typeof item === "object" && (item as any).type === "text")
    .map((item) => String((item as any).text ?? ""))
    .join("\n")
    .trim();
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
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Get the latest user message
      const latestUserMessage = [...input.messages].reverse().find(m => m.role === 'user');
      
      if (!latestUserMessage) {
        return {
          message: "No user message found",
        };
      }

      await logTelemetryEvent({
        eventType: "ai_query_submitted",
        action: "submitted",
        sessionId: input.sessionId,
        entityType: "query",
        payload: {
          query: latestUserMessage.content,
          documentIds: input.documentIds ?? [],
        },
        aiInvolved: true,
      });

      // If no documents specified, use basic LLM without grounding
      if (!input.documentIds || input.documentIds.length === 0) {
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

      if (selectedProtocols.length === 0) {
        return {
          message: "The selected documents have not been processed yet. Please wait for processing to complete.",
        };
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
