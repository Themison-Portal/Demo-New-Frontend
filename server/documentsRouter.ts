import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
    protocols,
    documentCategories,
    trials,
    users,
    protocolChunks,
    telemetryEvents,
} from "../drizzle/schema";
import { eq, like, notLike, inArray, and, or, desc } from "drizzle-orm";
import { storagePut, storageDelete } from "./storage";
import { nanoid } from "nanoid";
import { callBackend } from "./_core/backendClient";
import { resolveTrialId, stripDemoId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { ingestProtocolContextChunks } from "./_core/protocolContext";
import { ENV } from "./_core/env";
import { getCoreBackendClient } from "./_core/coreBackendClient";
import { CoreBackendError } from "@shared/coreBackendTypes";
import { normalizeStatusForBackend } from "./trialsRouter";

/**
 * Demo/building trials are local sandbox rows in the FE MySQL `trials` table
 * with no core-backend counterpart, so their documents can't use the BE's
 * durable storage + RAG chat. This lazily creates a core-backend trial for
 * such a local trial (on first upload) and persists the mapping in
 * `trials.coreBackendTrialId`, so this and subsequent uploads route to the BE.
 * Returns the core-backend trial UUID, or null if registration fails (caller
 * then falls back to the local pipeline).
 */
async function ensureCoreBackendTrialId(
    db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
    localTrialId: string,
    meta: {
        title?: string | null;
        sponsor?: string | null;
        phase?: string | null;
        location?: string | null;
        status?: string | null;
        description?: string | null;
        indication?: string | null;
    },
    user: unknown
): Promise<string | null> {
    try {
        const created = await callBackend<{ id?: string }>(`/api/trials/with-assignments`, {
            method: "POST",
            body: {
                name: meta.title || "Untitled Trial",
                sponsor: meta.sponsor || "",
                phase: meta.phase || "Phase I",
                location: meta.location || "",
                status: normalizeStatusForBackend(meta.status),
                description: meta.description || meta.indication || "",
                members: [],
                pending_members: [],
            },
            user: user as any,
        });
        if (created?.id) {
            await db
                .update(trials)
                .set({ coreBackendTrialId: created.id })
                .where(eq(trials.id, localTrialId));
            console.log(
                `[documents] Registered local trial ${localTrialId} with core-backend trial ${created.id}`
            );
            return created.id;
        }
        console.warn(
            `[documents] core-backend trial create returned no id for ${localTrialId}; staying local.`
        );
    } catch (error) {
        console.warn(
            `[documents] Failed to register local trial ${localTrialId} with core-backend; staying local.`,
            error
        );
    }
    return null;
}

const USES_EXTERNAL_RAG = ENV.ragProvider === "external";

export const documentsRouter = router({
    list: publicProcedure
        .input(
            z.object({
                trialId: z.string(),
                demoMode: z.enum(["sample", "full", "building"]).optional(),
                pageContext: z.string().optional(),
                emitTelemetry: z.boolean().optional(),
            })
        )
        .query(async ({ input, ctx }) => {
            try {
                const docs = await callBackend<any[]>(
                    `/api/trial-documents/?trial_id=${input.trialId}`,
                    { method: "GET" }
                );
                return (docs || []).map((doc: any) => ({
                    id: doc.id,
                    trialId: input.trialId,
                    filename: doc.document_name,
                    fileUrl: doc.document_url,
                    fileKey: doc.document_url,
                    fileSize: doc.file_size || 0,
                    category: doc.document_type || "Protocol",
                    documentVersion: "v1",
                    amendmentVersion: null,
                    releaseDate: null,
                    isCurrent: true,
                    archivedAt: null,
                    sourceType: "manual",
                    sourceReference: null,
                    uploadedBy: null,
                    uploaderName: "Team",
                    createdAt: doc.created_at,
                    coreBackendDocumentId: doc.id,
                    coreBackendJobId: null,
                    coreBackendIngestStatus: doc.ingestion_status || "queued",
                    usesCoreBackend: true,
                    isIndexed: doc.ingestion_status === "ready",
                    indexStatus: doc.ingestion_status === "ready" ? "indexed" :
                        doc.ingestion_status === "failed" ? "failed" : "processing",
                    indexFailureReason: null,
                    indexUpdatedAt: null,
                    contextIndexed: false,
                    contextChunkCount: 0,
                }));
            } catch (e) {
                console.error("Failed to fetch documents from FastAPI:", e);
                return [];
            }
        }),

    upload: protectedProcedure
        .input(
            z.object({
                trialId: z.string(),
                filename: z.string(),
                fileData: z.string(), // base64 encoded
                category: z.string(),
                documentVersion: z.string().max(50).optional(),
                amendmentVersion: z.string().max(50).optional(),
                releaseDate: z.string().max(50).optional(),
                markAsCurrent: z.boolean().optional(),
                sourceType: z.enum(["manual", "integration", "system"]).optional(),
                sourceReference: z.string().max(255).optional(),
                demoMode: z.enum(["sample", "full", "building"]).optional(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const buffer = Buffer.from(input.fileData, "base64");
            const fileSize = buffer.length;

            if (fileSize > 50 * 1024 * 1024) {
                throw new Error("File size exceeds 50MB limit");
            }

            const docCategory = input.category.toLowerCase().includes("protocol")
                ? "protocol"
                : input.category.toLowerCase();

            const client = getCoreBackendClient();
            const authToken = ctx.authToken ?? "auth-disabled-bypass";

            const created = await client.uploadTrialDocumentMultipart(
                {
                    file: buffer,
                    filename: input.filename,
                    trial_id: input.trialId,
                    document_name: input.filename,
                    document_type: docCategory,
                },
                authToken
            );

            const job = await client.uploadPdf({
                document_url: created.document_url,
                document_id: created.id,
                chunk_size: 750,
            });

            console.log(
                `[documents.upload] FastAPI ingest started: doc=${created.id} job=${job.job_id}`
            );

            return {
                success: true,
                url: created.document_url,
                coreBackendDocumentId: created.id,
            };
        }),

    delete: protectedProcedure
        .input(
            z.object({
                id: z.number(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const authToken = ctx.authToken ?? "auth-disabled-bypass";
            try {
                await callBackend(
                    `/api/trial-documents/${input.id}`,
                    { method: "DELETE", user: ctx.user }
                );
            } catch (e) {
                console.error("Failed to delete document from FastAPI:", e);
                throw new Error("Failed to delete document");
            }
            return { success: true };
        }),

    updateControl: protectedProcedure
        .input(
            z.object({
                id: z.number(),
                documentVersion: z.string().max(50).optional(),
                amendmentVersion: z.string().max(50).optional(),
                releaseDate: z.string().max(50).optional(),
                isCurrent: z.boolean().optional(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) {
                throw new Error("Database not available");
            }

            const [doc] = await db
                .select()
                .from(protocols)
                .where(eq(protocols.id, input.id))
                .limit(1);

            if (!doc) {
                throw new Error("Document not found");
            }

            const updates: Record<string, unknown> = {};
            if (input.documentVersion !== undefined) updates.documentVersion = input.documentVersion;
            if (input.amendmentVersion !== undefined) updates.amendmentVersion = input.amendmentVersion;
            if (input.releaseDate !== undefined) updates.releaseDate = input.releaseDate;
            if (input.isCurrent !== undefined) updates.isCurrent = input.isCurrent;

            if (Object.keys(updates).length === 0) {
                return { success: true };
            }

            if (input.isCurrent === true) {
                await db
                    .update(protocols)
                    .set({ isCurrent: false })
                    .where(
                        and(
                            eq(protocols.trialId, doc.trialId),
                            or(eq(protocols.category, "Protocol"), eq(protocols.category, "protocol"))
                        )
                    );
            }

            await db
                .update(protocols)
                .set({
                    ...updates,
                    updatedAt: new Date(),
                })
                .where(eq(protocols.id, input.id));

            await logTelemetryEvent({
                eventType: "document_control_updated",
                action: "edited",
                userId: String(ctx.user.id),
                entityType: "protocol",
                entityId: String(input.id),
                payload: updates,
            });

            return { success: true };
        }),

    setArchived: protectedProcedure
        .input(
            z.object({
                id: z.number(),
                archived: z.boolean(),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) {
                throw new Error("Database not available");
            }

            const [doc] = await db
                .select()
                .from(protocols)
                .where(eq(protocols.id, input.id))
                .limit(1);

            if (!doc) {
                throw new Error("Document not found");
            }

            await db
                .update(protocols)
                .set({
                    archivedAt: input.archived ? new Date() : null,
                    updatedAt: new Date(),
                })
                .where(eq(protocols.id, input.id));

            await logTelemetryEvent({
                eventType: input.archived ? "document_archived" : "document_restored",
                action: input.archived ? "archived" : "restored",
                userId: String(ctx.user.id),
                entityType: "protocol",
                entityId: String(input.id),
                payload: { trialId: doc.trialId },
            });

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
            const normalizedMode = protocol.trialId.startsWith("building:")
                ? "building"
                : protocol.trialId.startsWith("full:")
                    ? "full"
                    : "sample";

            // Phase 4: when the protocol is mapped to a core-backend trial_documents
            // row, route the retry through BE -> RAG service. The legacy OpenAI
            // Vector Store path on this branch is deprecated and is being removed
            // in Phase 5 along with openaiAssistant.ts.
            if (!protocol.coreBackendDocumentId) {
                return {
                    success: false,
                    message:
                        "This document is not registered with the RAG service. Re-upload to get a coreBackendDocumentId before retrying.",
                };
            }

            await logTelemetryEvent({
                eventType: "document_context_index_started",
                action: "started",
                userId: String(ctx.user.id),
                entityType: "protocol",
                entityId: String(protocol.id),
                payload: {
                    trialId: protocol.trialId,
                    filename: protocol.filename,
                    demoMode: normalizedMode,
                    source: "core-backend.document-ai.retry-ingestion",
                },
                aiInvolved: true,
            });

            try {
                const retry = await callBackend<{
                    jobId: string;
                    documentId: string;
                    status: string;
                    message: string;
                }>(`/api/document-ai/retry-ingestion/${encodeURIComponent(protocol.coreBackendDocumentId)}`, {
                    method: "POST",
                    user: ctx.user,
                });

                // Stamp the new job id on the FE protocol row so the UI poller picks
                // it up under coreBackendJobId, same as a fresh upload.
                await db
                    .update(protocols)
                    .set({
                        coreBackendJobId: retry.jobId,
                        coreBackendIngestStatus: retry.status || "queued",
                    })
                    .where(eq(protocols.id, protocol.id));

                await logTelemetryEvent({
                    eventType: "document_processing_retried",
                    action: "retry_processing",
                    userId: String(ctx.user.id),
                    entityType: "protocol",
                    entityId: String(protocol.id),
                    payload: {
                        trialId: protocol.trialId,
                        jobId: retry.jobId,
                        source: "core-backend.document-ai.retry-ingestion",
                    },
                });

                return { success: true, message: retry.message || "Reingestion queued" };
            } catch (error) {
                await logTelemetryEvent({
                    eventType: "document_context_index_failed",
                    action: "failed",
                    userId: String(ctx.user.id),
                    entityType: "protocol",
                    entityId: String(protocol.id),
                    payload: {
                        trialId: protocol.trialId,
                        filename: protocol.filename,
                        reason: error instanceof Error ? error.message : String(error),
                        source: "core-backend.document-ai.retry-ingestion",
                    },
                    aiInvolved: true,
                });
                return {
                    success: false,
                    message: error instanceof Error ? error.message : "Failed to queue reingestion",
                };
            }
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
        .mutation(async ({ input, ctx }) => {
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

            await logTelemetryEvent({
                eventType: "document_category_created",
                action: "created",
                userId: String(ctx.user.id),
                entityType: "document_category",
                entityId: String(created[0]?.id ?? input.name),
                payload: { name: input.name },
            });

            return { success: true, category: created[0] };
        }),

    updateCategory: protectedProcedure
        .input(
            z.object({
                id: z.number(),
                category: z.string().min(1).max(100),
            })
        )
        .mutation(async ({ input, ctx }) => {
            const db = await getDb();
            if (!db) {
                throw new Error("Database not available");
            }

            const [doc] = await db
                .select()
                .from(protocols)
                .where(eq(protocols.id, input.id))
                .limit(1);

            // Update the document category
            await db
                .update(protocols)
                .set({ category: input.category })
                .where(eq(protocols.id, input.id));

            await logTelemetryEvent({
                eventType: "document_category_updated",
                action: "edited",
                userId: String(ctx.user.id),
                entityType: "protocol",
                entityId: String(input.id),
                payload: {
                    category: input.category,
                    trialId: doc?.trialId ?? null,
                },
            });

            return { success: true };
        }),

    getTrialsWithDocuments: publicProcedure
        .input(
            z.object({
                demoMode: z.enum(["sample", "full", "building"]).optional(),
            }).optional()
        )
        .query(async ({ input }) => {
            // Try FastAPI first — returns trials that have documents in core-backend
            try {
                const beTrials = await callBackend<any[]>(`/api/trials/`, { method: "GET" });
                if (Array.isArray(beTrials) && beTrials.length > 0) {
                    return beTrials.map((t: any) => ({
                        id: t.id,
                        name: t.name || t.title || `Trial ${t.id}`,
                    }));
                }
            } catch (e) {
                console.warn("[getTrialsWithDocuments] FastAPI call failed, falling back to MySQL:", e);
            }

            // Fallback: MySQL for legacy prefixed trials
            const db = await getDb();
            if (!db) return [];
            const mode = (input?.demoMode ?? "sample") as DemoMode;

            const prefixed = await db
                .selectDistinct({ trialId: protocols.trialId, title: trials.title })
                .from(protocols)
                .leftJoin(trials, eq(protocols.trialId, trials.id))
                .where(like(protocols.trialId, `${mode}:%`));
            if (prefixed.length > 0) {
                return prefixed.map(t => ({
                    id: stripDemoId(t.trialId),
                    name: t.title || `Trial ${stripDemoId(t.trialId).toUpperCase()}`,
                }));
            }
            const legacy = await db
                .selectDistinct({ trialId: protocols.trialId, title: trials.title })
                .from(protocols)
                .leftJoin(trials, eq(protocols.trialId, trials.id))
                .where(notLike(protocols.trialId, "%:%"));
            return legacy.map(t => ({
                id: t.trialId,
                name: t.title || `Trial ${t.trialId.toUpperCase()}`,
            }));
        }),

    listMultipleTrials: publicProcedure
        .input(
            z.object({
                trialIds: z.array(z.string()),
                demoMode: z.enum(["sample", "full", "building"]).optional(),
            })
        )
        .query(async ({ input }) => {
            if (input.trialIds.length === 0) return {};

            const docsByTrial: Record<string, any[]> = {};

            for (const trialId of input.trialIds) {
                try {
                    const docs = await callBackend<any[]>(
                        `/api/trial-documents/?trial_id=${trialId}`,
                        { method: "GET" }
                    );
                    docsByTrial[trialId] = (docs || []).map((doc: any) => ({
                        id: doc.id,
                        trialId,
                        filename: doc.document_name,
                        fileUrl: doc.document_url,
                        fileKey: doc.document_url,
                        fileSize: doc.file_size || 0,
                        category: doc.document_type || "Protocol",
                        documentVersion: "v1",
                        amendmentVersion: null,
                        releaseDate: null,
                        isCurrent: true,
                        archivedAt: null,
                        sourceType: "manual",
                        sourceReference: null,
                        uploadedBy: null,
                        uploaderName: "Team",
                        createdAt: doc.created_at,
                        coreBackendDocumentId: doc.id,
                        coreBackendIngestStatus: doc.ingestion_status || "queued",
                        usesCoreBackend: true,
                        isIndexed: doc.ingestion_status === "ready",
                        indexStatus: doc.ingestion_status === "ready" ? "indexed" :
                            doc.ingestion_status === "failed" ? "failed" : "processing",
                        indexFailureReason: null,
                        indexUpdatedAt: null,
                        contextIndexed: false,
                        contextChunkCount: 0,
                    }));
                } catch (e) {
                    console.error(`Failed to fetch documents for trial ${trialId}:`, e);
                    docsByTrial[trialId] = [];
                }
            }

            return docsByTrial;
        }),
});
