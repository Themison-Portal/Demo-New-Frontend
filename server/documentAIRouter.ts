import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { protocols, fileSearchStores, fileSearchDocuments } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { queryWithAssistant, uploadToVectorStore, createVectorStore } from "./_core/openaiAssistant";
import { resolveTrialId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";

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

        // Use the invokeLLM helper from the existing implementation
        const { invokeLLM } = await import("./_core/llm");
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

      // Get the File Search document names for the specified document IDs
      const { inArray } = await import("drizzle-orm");
      const documentIds = input.documentIds.map(id => parseInt(id));
      console.log('[Document AI] Received documentIds:', input.documentIds);
      console.log('[Document AI] Parsed to integers:', documentIds);
      
      const docs = await db
        .select()
        .from(fileSearchDocuments)
        .where(inArray(fileSearchDocuments.protocolId, documentIds));
      
      console.log('[Document AI] Found documents in fileSearchDocuments:', docs.length);
      console.log('[Document AI] Documents:', docs);

      if (docs.length === 0) {
        return {
          message: "The selected documents have not been processed yet. Please wait for processing to complete.",
        };
      }

      // Get unique store names from the documents
      const storeIds = Array.from(new Set(docs.map(doc => doc.storeId)));
      const stores = await db
        .select()
        .from(fileSearchStores)
        .where(inArray(fileSearchStores.id, storeIds));
      
      const storeNames = stores.map(store => store.storeName);

      try {
        // Query using OpenAI Assistant with File Search
        const { answer, citations } = await queryWithAssistant(
          latestUserMessage.content,
          storeNames
        );

        let sources: Array<{
          fileId?: string;
          filename?: string;
          fileUrl?: string;
          protocolId?: number;
          excerpt?: string;
          section?: string;
        }> = [];

        if (citations && citations.length > 0) {
          const fileIds = Array.from(
            new Set(
              citations
                .map((citation: any) => citation.file_id)
                .filter((id: string | undefined): id is string => Boolean(id))
            )
          );

          if (fileIds.length > 0) {
            const { inArray } = await import("drizzle-orm");
            const fileDocs = await db
              .select()
              .from(fileSearchDocuments)
              .where(inArray(fileSearchDocuments.documentName, fileIds));

            const protocolIds = Array.from(
              new Set(fileDocs.map(doc => doc.protocolId))
            );

            const protocolRows = protocolIds.length
              ? await db
                  .select()
                  .from(protocols)
                  .where(inArray(protocols.id, protocolIds))
              : [];

            const fileDocById = new Map(fileDocs.map(doc => [doc.documentName, doc]));
            const protocolById = new Map(protocolRows.map(protocol => [protocol.id, protocol]));

            sources = citations.map((citation: any) => {
              const fileId = citation.file_id;
              const fileDoc = fileId ? fileDocById.get(fileId) : undefined;
              const protocol = fileDoc ? protocolById.get(fileDoc.protocolId) : undefined;

              return {
                fileId,
                filename: protocol?.filename || fileDoc?.displayName || citation.file_name || fileId,
                fileUrl: protocol?.fileUrl,
                protocolId: fileDoc?.protocolId,
                category: protocol?.category,
                excerpt: citation.text,
                section: citation.section,
                page: citation.page_number,
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
          thinking: `Searching through ${storeNames.length} document store(s) to find relevant information. Analyzing document contents and extracting key information to answer your question accurately.`,
          citations,
          sources,
        };
      } catch (error: any) {
        console.error('Error querying with File Search:', error);
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
