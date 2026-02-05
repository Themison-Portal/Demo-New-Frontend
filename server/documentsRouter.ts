import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { protocols, fileSearchStores, fileSearchDocuments, documentCategories, trials } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { createVectorStore, uploadToVectorStore } from "./_core/openaiAssistant";

export const documentsRouter = router({
  list: publicProcedure
    .input(
      z.object({
        trialId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return [];
      }

      const docs = await db
        .select()
        .from(protocols)
        .where(eq(protocols.trialId, input.trialId));

      // Check File Search status for each document
      const docsWithStatus = await Promise.all(
        docs.map(async (doc) => {
          const fileSearchDoc = await db
            .select()
            .from(fileSearchDocuments)
            .where(eq(fileSearchDocuments.protocolId, doc.id))
            .limit(1);

          return {
            ...doc,
            isIndexed: fileSearchDoc.length > 0,
          };
        })
      );

      return docsWithStatus;
    }),

  upload: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        filename: z.string(),
        fileData: z.string(), // base64 encoded
        category: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Decode base64
      const buffer = Buffer.from(input.fileData, "base64");
      const fileSize = buffer.length;

      // Check file size (50MB limit)
      if (fileSize > 50 * 1024 * 1024) {
        throw new Error("File size exceeds 50MB limit");
      }

      // Generate unique file key
      const fileExtension = input.filename.split(".").pop();
      const fileKey = `protocols/${input.trialId}/${nanoid()}.${fileExtension}`;

      // Upload to S3
      const contentType = fileExtension === "pdf" ? "application/pdf" : "application/octet-stream";
      const { url } = await storagePut(fileKey, buffer, contentType);

      // Save to database
      const result = await db.insert(protocols).values({
        trialId: input.trialId,
        filename: input.filename,
        fileUrl: url,
        fileKey,
        fileSize,
        category: input.category,
        uploadedBy: ctx.user.id,
        createdAt: new Date(),
      });

      // Get the inserted protocol ID
      const insertedProtocols = await db
        .select()
        .from(protocols)
        .where(eq(protocols.fileKey, fileKey))
        .limit(1);
      
      const protocolId = insertedProtocols[0]?.id;

      // Automatically upload to Google File Search Store (async, don't block response)
      if (protocolId) {
        // Run in background
        (async () => {
          try {
            // Get or create File Search Store for this trial
            let store = await db
              .select()
              .from(fileSearchStores)
              .where(eq(fileSearchStores.trialId, input.trialId))
              .limit(1);

            let storeName: string;
            let storeId: number;

            if (store.length === 0) {
              // Create new File Search Store
              storeName = await createVectorStore(`Trial ${input.trialId} Documents`);
              
              await db.insert(fileSearchStores).values({
                trialId: input.trialId,
                storeName,
                displayName: `Trial ${input.trialId} Documents`,
              });
              
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

            // Upload to File Search Store
            const documentName = await uploadToVectorStore(
              buffer,
              input.filename,
              storeName
            );

            // Track the uploaded document
            await db.insert(fileSearchDocuments).values({
              storeId,
              protocolId,
              documentName,
              displayName: input.filename,
            });

            console.log(`✅ Document ${input.filename} automatically uploaded to File Search Store`);
          } catch (error) {
            console.error(`❌ Failed to auto-upload ${input.filename} to File Search:`, error);
          }
        })();
      }

      return { success: true, url };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Get the document to check ownership and get file info
      const doc = await db
        .select()
        .from(protocols)
        .where(eq(protocols.id, input.id))
        .limit(1);

      if (doc.length === 0) {
        throw new Error("Document not found");
      }

      // Delete from File Search Store (if exists)
      const fileSearchDoc = await db
        .select()
        .from(fileSearchDocuments)
        .where(eq(fileSearchDocuments.protocolId, input.id))
        .limit(1);

      if (fileSearchDoc.length > 0) {
        // Delete from fileSearchDocuments table
        await db
          .delete(fileSearchDocuments)
          .where(eq(fileSearchDocuments.protocolId, input.id));
      }

      // Delete from database
      await db.delete(protocols).where(eq(protocols.id, input.id));

      // Note: We're not deleting from S3 to keep files for audit/backup purposes
      // In production, you might want to implement soft delete or S3 cleanup

      return { success: true };
    }),

  retryProcessing: protectedProcedure
    .input(
      z.object({
        id: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Get the document
      const doc = await db
        .select()
        .from(protocols)
        .where(eq(protocols.id, input.id))
        .limit(1);

      if (doc.length === 0) {
        throw new Error("Document not found");
      }

      const protocol = doc[0];

      // Check if already indexed
      const existingFileSearchDoc = await db
        .select()
        .from(fileSearchDocuments)
        .where(eq(fileSearchDocuments.protocolId, input.id))
        .limit(1);

      if (existingFileSearchDoc.length > 0) {
        return { success: true, message: "Document already indexed" };
      }

      // Get or create File Search Store for this trial
      let store = await db
        .select()
        .from(fileSearchStores)
        .where(eq(fileSearchStores.trialId, protocol.trialId))
        .limit(1);

      let storeName: string;
      let storeId: number;

      if (store.length === 0) {
        // Create new File Search Store
        storeName = await createVectorStore(`Trial ${protocol.trialId} Documents`);
        
        await db.insert(fileSearchStores).values({
          trialId: protocol.trialId,
          storeName,
          displayName: `Trial ${protocol.trialId} Documents`,
        });
        
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

      // Download file from S3 and upload to File Search Store
      const response = await fetch(protocol.fileUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      const documentName = await uploadToVectorStore(
        buffer,
        protocol.filename,
        storeName
      );

      // Track the uploaded document
      await db.insert(fileSearchDocuments).values({
        storeId,
        protocolId: protocol.id,
        documentName,
        displayName: protocol.filename,
      });

      return { success: true, message: "Document processed successfully" };
    }),

  getCategories: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return [];
    }

    const categories = await db.select().from(documentCategories).orderBy(documentCategories.name);
    return categories;
  }),

  createCategory: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Check if category already exists
      const existing = await db
        .select()
        .from(documentCategories)
        .where(eq(documentCategories.name, input.name))
        .limit(1);

      if (existing.length > 0) {
        return { success: true, category: existing[0] };
      }

      // Create new category
      await db.insert(documentCategories).values({
        name: input.name,
        isDefault: false,
      });

      const created = await db
        .select()
        .from(documentCategories)
        .where(eq(documentCategories.name, input.name))
        .limit(1);

      return { success: true, category: created[0] };
    }),

  updateCategory: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        category: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Update the document category
      await db
        .update(protocols)
        .set({ category: input.category })
        .where(eq(protocols.id, input.id));

      return { success: true };
    }),

  getTrialsWithDocuments: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return [];
    }

    // Get distinct trial IDs from protocols table and join with trials table to get actual names
    const trialsWithDocs = await db
      .selectDistinct({ 
        trialId: protocols.trialId,
        title: trials.title,
      })
      .from(protocols)
      .leftJoin(trials, eq(protocols.trialId, trials.id));

    // Return trials with their actual titles from the database
    return trialsWithDocs.map(t => ({
      id: t.trialId,
      name: t.title || `Trial ${t.trialId.toUpperCase()}`, // Fallback to ID if title is null
    }));
  }),

  listMultipleTrials: publicProcedure
    .input(
      z.object({
        trialIds: z.array(z.string()),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db || input.trialIds.length === 0) {
        return {};
      }

      // Fetch documents for all trial IDs
      const allDocs = await db
        .select()
        .from(protocols);

      // Filter by trial IDs and check File Search status
      const docsByTrial: Record<string, any[]> = {};
      
      for (const trialId of input.trialIds) {
        const trialDocs = allDocs.filter(doc => doc.trialId === trialId);
        
        const docsWithStatus = await Promise.all(
          trialDocs.map(async (doc) => {
            const fileSearchDoc = await db
              .select()
              .from(fileSearchDocuments)
              .where(eq(fileSearchDocuments.protocolId, doc.id))
              .limit(1);

            return {
              ...doc,
              isIndexed: fileSearchDoc.length > 0,
            };
          })
        );

        docsByTrial[trialId] = docsWithStatus;
      }

      return docsByTrial;
    }),
});

