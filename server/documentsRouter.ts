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
      const db = await getDb();
      if (!db) {
        return [];
      }

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");

      let docs = await db
        .select()
        .from(protocols)
        .where(eq(protocols.trialId, resolvedTrialId))
        .orderBy(desc(protocols.createdAt));

      // Compatibility fallback for trials created before ID normalization fixes:
      // attempt to find protocol rows that were saved under an alternate trial ID variant.
      if (docs.length === 0) {
        const prefixedInputId = `${mode}:${input.trialId}`;
        const prefixMatches = await db
          .select()
          .from(protocols)
          .where(like(protocols.trialId, `${prefixedInputId}%`))
          .orderBy(desc(protocols.createdAt));

        if (prefixMatches.length > 0) {
          docs = prefixMatches;
        } else {
          const suffixMatch = input.trialId.match(/-([a-z0-9]{4,8})$/i);
          if (suffixMatch) {
            const suffixMatches = await db
              .select()
              .from(protocols)
              .where(like(protocols.trialId, `${mode}:%-${suffixMatch[1]}`))
              .orderBy(desc(protocols.createdAt));
            if (suffixMatches.length > 0) {
              docs = suffixMatches;
            }
          }
        }
      }

      const uploaderIds = Array.from(
        new Set(
          docs
            .map((doc) => doc.uploadedBy)
            .filter((id): id is number => typeof id === "number")
        )
      );
      const uploaderNameById = new Map<number, string>();
      if (uploaderIds.length > 0) {
        const uploaderRows = await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, uploaderIds));
        uploaderRows.forEach((row) => {
          uploaderNameById.set(row.id, row.name || row.email || `User ${row.id}`);
        });
      }

      // Check File Search status for each document
      const protocolIds = docs.map((doc) => doc.id);
      const chunkRows = protocolIds.length
        ? await db
            .select({ protocolId: protocolChunks.protocolId })
            .from(protocolChunks)
            .where(inArray(protocolChunks.protocolId, protocolIds))
        : [];
      const chunkCountByProtocol = chunkRows.reduce<Record<number, number>>((acc, row) => {
        acc[row.protocolId] = (acc[row.protocolId] ?? 0) + 1;
        return acc;
      }, {});

      const protocolEntityIds = protocolIds.map((id) => String(id));
      const vectorIndexEventTypes = [
        "document_vector_index_started",
        "document_vector_index_completed",
        "document_vector_index_failed",
        "document_processing_retried",
      ] as const;
      const vectorIndexTelemetryRows = protocolEntityIds.length
        ? await db
            .select({
              entityId: telemetryEvents.entityId,
              eventType: telemetryEvents.eventType,
              createdAt: telemetryEvents.createdAt,
              payload: telemetryEvents.payload,
            })
            .from(telemetryEvents)
            .where(
              and(
                eq(telemetryEvents.entityType, "protocol"),
                inArray(telemetryEvents.entityId, protocolEntityIds),
                inArray(telemetryEvents.eventType, [...vectorIndexEventTypes])
              )
            )
            .orderBy(desc(telemetryEvents.createdAt))
        : [];

      const latestVectorIndexEventByProtocol = new Map<
        string,
        {
          eventType: string;
          createdAt: Date;
          payload: unknown;
        }
      >();
      for (const row of vectorIndexTelemetryRows) {
        const entityId = String(row.entityId || "").trim();
        if (!entityId) continue;
        if (!latestVectorIndexEventByProtocol.has(entityId)) {
          latestVectorIndexEventByProtocol.set(entityId, {
            eventType: row.eventType,
            createdAt: row.createdAt,
            payload: row.payload,
          });
        }
      }

      const docsWithStatus = await Promise.all(
        docs.map(async (doc) => {
          // Phase 5: when a doc was uploaded through core-backend
          // (Phase 3 stamped `coreBackendDocumentId` + `coreBackendJobId`
          // on the row), refresh the ingestion state from
          // /upload/status/{job_id} and let it drive the badge. Avoids
          // race conditions between local telemetry events and what
          // core-backend's RAG pipeline has actually completed.
          let coreStatus: string | null = doc.coreBackendIngestStatus ?? null;
          // Terminal states never regress, so once we've recorded one
          // there's no point pinging core-backend on every list refresh.
          // Skips the per-row /upload/status round-trip for docs that
          // are done, freeing up roughly N × 500ms per 2-second poll on
          // a trial with N completed protocols.
          const TERMINAL_STATES = new Set(["complete", "ready", "error", "failed"]);
          const isTerminal = coreStatus !== null && TERMINAL_STATES.has(coreStatus);
          if (doc.coreBackendJobId && ENV.coreBackendApiUrl && !isTerminal) {
            try {
              const live = await getCoreBackendClient().getUploadStatus(
                doc.coreBackendJobId
              );
              if (live.status && live.status !== coreStatus) {
                coreStatus = live.status;
                await db
                  .update(protocols)
                  .set({ coreBackendIngestStatus: live.status })
                  .where(eq(protocols.id, doc.id));
              }
            } catch (error) {
              // Non-fatal: status will retry on next list. Keep the
              // last-known value rather than failing the whole list.
              console.warn(
                `[documents/list] core-backend status check failed for doc ${doc.id}:`,
                error instanceof Error ? error.message : error
              );
            }
          }

          const latestVectorEvent = latestVectorIndexEventByProtocol.get(String(doc.id));
          const hasContextIndex = (chunkCountByProtocol[doc.id] ?? 0) > 0;
          // Phase 5: OpenAI Vector Store indexing is deprecated. The
          // core-backend ingestion status is now the source of truth for
          // "is indexed"; legacy local context chunks remain a fallback
          // signal until Phase 6 removes protocolChunks.
          const usesCoreBackend = !!doc.coreBackendDocumentId;
          const hasEffectiveIndex = usesCoreBackend
            ? coreStatus === "complete" || coreStatus === "ready"
            : hasContextIndex;
          let indexStatus: "indexed" | "processing" | "failed" = hasEffectiveIndex
            ? "indexed"
            : "processing";
          let indexFailureReason: string | null = null;
          if (usesCoreBackend) {
            if (coreStatus === "error" || coreStatus === "failed") {
              indexStatus = "failed";
              indexFailureReason =
                "core-backend ingestion failed. Retry processing.";
            }
          } else if (
            !usesCoreBackend &&
            !hasContextIndex &&
            latestVectorEvent?.eventType === "document_vector_index_failed"
          ) {
            indexStatus = "failed";
            const payload = latestVectorEvent.payload as Record<string, unknown> | null;
            const reason =
              payload && typeof payload.reason === "string" ? payload.reason.trim() : "";
            indexFailureReason = reason || "Indexing failed. Retry processing.";
          }

          return {
            ...doc,
            isIndexed: hasEffectiveIndex,
            indexStatus,
            indexFailureReason,
            indexUpdatedAt: USES_EXTERNAL_RAG ? null : latestVectorEvent?.createdAt ?? null,
            contextIndexed: hasContextIndex,
            contextChunkCount: chunkCountByProtocol[doc.id] ?? 0,
            uploaderName: uploaderNameById.get(doc.uploadedBy) || `User ${doc.uploadedBy}`,
          };
        })
      );

      if (input.emitTelemetry) {
        await logTelemetryEvent({
          eventType: "document_hub_viewed",
          action: "viewed",
          userId: ctx.user ? String(ctx.user.id) : null,
          entityType: "trial",
          entityId: resolvedTrialId,
          payload: {
            trialId: resolvedTrialId,
            pageContext: input.pageContext ?? "document-hub",
            totalDocuments: docsWithStatus.length,
            indexedDocuments: docsWithStatus.filter((doc) => !!doc.isIndexed).length,
            demoMode: mode,
          },
        });
      }

      return docsWithStatus;
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
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");

      // Decode base64
      const buffer = Buffer.from(input.fileData, "base64");
      const fileSize = buffer.length;

      // Check file size (50MB limit)
      if (fileSize > 50 * 1024 * 1024) {
        throw new Error("File size exceeds 50MB limit");
      }

      // Generate unique file key. The trial id may carry a "mode:" prefix
      // from resolveTrialId (e.g. "building:<slug>"); NTFS treats `:` as an
      // Alternate Data Stream separator so we strip it here.
      const fileExtension = input.filename.split(".").pop();
      const safeTrialIdSegment = String(resolvedTrialId).replace(/:/g, "_");
      const fileKey = `protocols/${safeTrialIdSegment}/${nanoid()}.${fileExtension}`;

      // Upload to S3
      const contentType = fileExtension === "pdf" ? "application/pdf" : "application/octet-stream";
      const { url } = await storagePut(fileKey, buffer, contentType);

      const isProtocolCategory = input.category.toLowerCase() === "protocol";
      const [trialMeta] = await db
        .select({
          currentVersion: trials.currentVersion,
          amendmentVersion: trials.amendmentVersion,
          releaseDate: trials.releaseDate,
          coreBackendTrialId: trials.coreBackendTrialId,
          title: trials.title,
          sponsor: trials.sponsor,
          phase: trials.phase,
          location: trials.location,
          status: trials.status,
          description: trials.description,
          indication: trials.indication,
        })
        .from(trials)
        .where(eq(trials.id, resolvedTrialId))
        .limit(1);

      const parseVersionNumber = (value?: string | null) => {
        if (!value) return 0;
        const match = value.match(/(\d+)/);
        const parsed = match ? Number.parseInt(match[1], 10) : 0;
        return Number.isFinite(parsed) ? parsed : 0;
      };

      let nextAutoVersion = "v1";
      if (isProtocolCategory) {
        const existingProtocols = await db
          .select({ documentVersion: protocols.documentVersion })
          .from(protocols)
          .where(
            and(
              eq(protocols.trialId, resolvedTrialId),
              or(eq(protocols.category, "Protocol"), eq(protocols.category, "protocol"))
            )
          );
        const maxVersion = existingProtocols.reduce((max, row) => {
          const number = parseVersionNumber(row.documentVersion);
          return number > max ? number : max;
        }, 0);
        nextAutoVersion = `v${maxVersion + 1}`;
      }

      const documentVersion =
        input.documentVersion?.trim() ||
        (isProtocolCategory ? trialMeta?.currentVersion || nextAutoVersion : undefined);
      const amendmentVersion =
        input.amendmentVersion?.trim() ||
        (isProtocolCategory ? trialMeta?.amendmentVersion || undefined : undefined);
      const releaseDate =
        input.releaseDate?.trim() ||
        (isProtocolCategory ? trialMeta?.releaseDate || undefined : undefined);
      const markAsCurrent = isProtocolCategory ? (input.markAsCurrent ?? true) : false;

      if (markAsCurrent) {
        await db
          .update(protocols)
          .set({ isCurrent: false })
          .where(
            and(
              eq(protocols.trialId, resolvedTrialId),
              or(eq(protocols.category, "Protocol"), eq(protocols.category, "protocol"))
            )
          );
      }

      // Save to database
      await db.insert(protocols).values({
        trialId: resolvedTrialId,
        filename: input.filename,
        fileUrl: url,
        fileKey,
        fileSize,
        category: input.category,
        documentVersion,
        amendmentVersion,
        releaseDate,
        isCurrent: markAsCurrent,
        archivedAt: null,
        sourceType: input.sourceType ?? "manual",
        sourceReference: input.sourceReference ?? null,
        uploadedBy: ctx.user.id,
        createdAt: new Date(),
      });

      await logTelemetryEvent({
        eventType: "protocol_uploaded",
        action: "created",
        userId: String(ctx.user.id),
        entityType: "protocol",
        entityId: String(resolvedTrialId),
        payload: {
          filename: input.filename,
          category: input.category,
          documentVersion,
          amendmentVersion,
          releaseDate,
          isCurrent: markAsCurrent,
          sourceType: input.sourceType ?? "manual",
          trialId: resolvedTrialId,
          demoMode: mode,
        },
      });

      // Get the inserted protocol ID
      const insertedProtocols = await db
        .select()
        .from(protocols)
        .where(eq(protocols.fileKey, fileKey))
        .limit(1);
      
      const protocolId = insertedProtocols[0]?.id;

      if (protocolId) {
        await logTelemetryEvent({
          eventType: "document_created",
          action: "created",
          userId: String(ctx.user.id),
          entityType: "document",
          entityId: String(protocolId),
          payload: {
            trialId: resolvedTrialId,
            filename: input.filename,
            category: input.category,
            sourceType: input.sourceType ?? "manual",
            sourceReference: input.sourceReference ?? null,
            demoMode: mode,
          },
        });
      }

      // Phase 3 of the core-backend integration. When the user is
      // signed in via Auth0 AND the local trial is mapped to a
      // core-backend trial, route ingestion through core-backend's
      // two-step flow (multipart create → upload-pdf trigger). Falls
      // back to the legacy in-FE pipeline below when preconditions
      // aren't met, so existing trials keep working unchanged.
      // When AUTH_DISABLED=true the FastAPI backend mocks the user, so an
      // Auth0 JWT is not actually required. Allow the BE forward to fire
      // with a placeholder token in that case (BE never inspects it).
      const authBypass = process.env.AUTH_DISABLED === "true";
      const canUseBackend =
        !!protocolId && (!!ctx.authToken || authBypass) && !!ENV.coreBackendApiUrl;

      // Resolve — and for demo/building trials, lazily provision — the
      // core-backend trial id this upload should attach to:
      // - An explicit mapping (`coreBackendTrialId`) always wins.
      // - Real trials aren't in FE MySQL (`trialMeta` undefined) and are NOT
      //   demo mode; their `resolvedTrialId` already IS the core-backend UUID.
      // - Everything else (sample/full/building) registers a core-backend trial
      //   now. Wizard "building" trials are ephemeral and have no FE `trials`
      //   row (`trialMeta` undefined), so we fall back to a filename-derived
      //   name. `ensureCoreBackendTrialId` persists the mapping when an FE row
      //   exists (a no-op update otherwise).
      let beTrialId: string | null = trialMeta?.coreBackendTrialId ?? null;
      if (!beTrialId && canUseBackend) {
        if (!trialMeta && mode !== "building") {
          beTrialId = resolvedTrialId;
        } else {
          const meta = trialMeta ?? {
            title: input.filename.replace(/\.[^./\\]+$/, "") || input.filename,
          };
          beTrialId = await ensureCoreBackendTrialId(db, resolvedTrialId, meta, ctx.user);
        }
      }
      const useCoreBackend = canUseBackend && !!beTrialId;

      // Diagnostic: surface exactly why an upload does / doesn't route to the BE.
      console.log(
        "[documents.upload] core-backend routing decision:",
        JSON.stringify({
          filename: input.filename,
          mode,
          resolvedTrialId,
          hasProtocolId: !!protocolId,
          hasAuthToken: !!ctx.authToken,
          authBypass,
          coreBackendApiUrl: ENV.coreBackendApiUrl,
          hasTrialMeta: !!trialMeta,
          existingCoreBackendTrialId: trialMeta?.coreBackendTrialId ?? null,
          resolvedBeTrialId: beTrialId,
          canUseBackend,
          useCoreBackend,
        })
      );

      if (useCoreBackend && protocolId) {
        const documentName = input.filename;
        const authToken = ctx.authToken ?? "auth-disabled-bypass";
        const docCategory = input.category.toLowerCase().includes("protocol")
          ? "protocol"
          : input.category.toLowerCase();

        (async () => {
          const client = getCoreBackendClient();
          try {
            const created = await client.uploadTrialDocumentMultipart(
              {
                file: buffer,
                filename: input.filename,
                trial_id: beTrialId!,
                document_name: documentName,
                document_type: docCategory,
              },
              authToken
            );

            const job = await client.uploadPdf({
              document_url: created.document_url,
              document_id: created.id,
              chunk_size: 750,
            });

            // Point the FE record's openable URL at the BE's durable document
            // URL so "Open document" resolves to the backend instead of the
            // local-storage (localhost) URL written by storagePut above. For
            // local BE storage this is a full /local-files URL; a GCS blob path
            // (no scheme) is left as-is and resolved on demand later.
            const beFileUrl =
              typeof created.document_url === "string" &&
              /^https?:\/\//.test(created.document_url)
                ? created.document_url
                : null;

            await db
              .update(protocols)
              .set({
                coreBackendDocumentId: created.id,
                coreBackendJobId: job.job_id,
                coreBackendIngestStatus: job.status ?? "queued",
                ...(beFileUrl ? { fileUrl: beFileUrl } : {}),
              })
              .where(eq(protocols.id, protocolId));

            console.log(
              `[documents.upload] core-backend ingest started: doc=${created.id} job=${job.job_id} url=${beFileUrl ?? created.document_url}`
            );

            // The core-backend now durably stores this document and the FE
            // record points at the BE URL (beFileUrl), so drop the transient
            // FE-local copy — the FE is no longer the store of record. Only
            // delete when the BE URL is directly openable; if it's a GCS blob
            // path (beFileUrl null) the FE copy is still referenced, so keep it.
            if (beFileUrl) {
              await storageDelete(fileKey);
            }

            await logTelemetryEvent({
              eventType: "document_context_index_started",
              action: "started",
              userId: String(ctx.user.id),
              entityType: "protocol",
              entityId: String(protocolId),
              payload: {
                trialId: resolvedTrialId,
                filename: input.filename,
                coreBackendDocumentId: created.id,
                coreBackendJobId: job.job_id,
                source: "core-backend",
                demoMode: mode,
              },
              aiInvolved: true,
            });
          } catch (error) {
            const reason =
              error instanceof CoreBackendError
                ? `${error.path} ${error.status}: ${error.message}`
                : error instanceof Error
                  ? error.message
                  : String(error);
            console.error(
              `❌ core-backend upload failed for ${input.filename}: ${reason}`
            );
            await db
              .update(protocols)
              .set({ coreBackendIngestStatus: "failed" })
              .where(eq(protocols.id, protocolId));
            await logTelemetryEvent({
              eventType: "document_context_index_failed",
              action: "failed",
              userId: String(ctx.user.id),
              entityType: "protocol",
              entityId: String(protocolId),
              payload: {
                trialId: resolvedTrialId,
                filename: input.filename,
                reason,
                source: "core-backend",
                demoMode: mode,
              },
              aiInvolved: true,
            });
          }
        })();
      }

      // Automatically upload to Google File Search Store (async, don't block response)
      if (protocolId && !useCoreBackend) {
        // Run in background
        (async () => {
          try {
            await logTelemetryEvent({
              eventType: "document_context_index_started",
              action: "started",
              userId: String(ctx.user.id),
              entityType: "protocol",
              entityId: String(protocolId),
              payload: {
                trialId: resolvedTrialId,
                filename: input.filename,
                demoMode: mode,
              },
              aiInvolved: true,
            });

            const chunkResult = await ingestProtocolContextChunks({
              protocolId,
              forceRefresh: true,
            });

            await logTelemetryEvent({
              eventType: "document_context_index_completed",
              action: "completed",
              userId: String(ctx.user.id),
              entityType: "protocol",
              entityId: String(protocolId),
              payload: {
                trialId: resolvedTrialId,
                filename: input.filename,
                chunksCreated: chunkResult.created,
                reused: chunkResult.reused,
                pageCount: chunkResult.pageCount,
                wordCount: chunkResult.wordCount,
                hasStructuredSchedule: chunkResult.hasStructuredSchedule,
                hasStructuredCriteria: chunkResult.hasStructuredCriteria,
                langExtractFactCount: chunkResult.langExtractFactCount ?? 0,
                langExtractModel: chunkResult.langExtractModel ?? null,
                embeddingCount: chunkResult.embeddingCount,
                demoMode: mode,
              },
              aiInvolved: true,
            });
          } catch (error) {
            console.error(`❌ Failed to parse ${input.filename} into context chunks:`, error);
            await logTelemetryEvent({
              eventType: "document_context_index_failed",
              action: "failed",
              userId: String(ctx.user.id),
              entityType: "protocol",
              entityId: String(protocolId),
              payload: {
                trialId: resolvedTrialId,
                filename: input.filename,
                reason: error instanceof Error ? error.message : String(error),
                demoMode: mode,
              },
              aiInvolved: true,
            });
          }

          // Phase 5: OpenAI Vector Store auto-upload is deprecated. When a
          // protocol is not routed through core-backend, the local context
          // chunks computed above are the only auxiliary index; the
          // Vector Store branch that used to sit here is gone.
          await logTelemetryEvent({
            eventType: "document_vector_index_skipped",
            action: "skipped",
            userId: String(ctx.user.id),
            entityType: "protocol",
            entityId: String(protocolId),
            payload: {
              trialId: resolvedTrialId,
              filename: input.filename,
              reason: "vector_store_deprecated_phase5",
              demoMode: mode,
            },
            aiInvolved: true,
          });
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

      // Phase 5: Vector Store rows are vestigial; nothing populates
      // fileSearchDocuments anymore, so there's nothing to clean up here.
      // The core-backend trial_documents row (if any) is left to the BE
      // to manage.
      await db.delete(protocols).where(eq(protocols.id, input.id));

      await logTelemetryEvent({
        eventType: "protocol_deleted",
        action: "deleted",
        userId: String(ctx.user.id),
        entityType: "protocol",
        entityId: String(input.id),
      });

      // Note: We're not deleting from S3 to keep files for audit/backup purposes
      // In production, you might want to implement soft delete or S3 cleanup

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
    const db = await getDb();
    if (!db) {
      return [];
    }
    const mode = (input?.demoMode ?? "sample") as DemoMode;

    // Get distinct trial IDs from protocols table and join with trials table to get actual names
    const prefixedTrialsWithDocs = await db
      .selectDistinct({ 
        trialId: protocols.trialId,
        title: trials.title,
      })
      .from(protocols)
      .leftJoin(trials, eq(protocols.trialId, trials.id))
      .where(like(protocols.trialId, `${mode}:%`));

    // Return trials with their actual titles from the database
    if (prefixedTrialsWithDocs.length > 0) {
      return prefixedTrialsWithDocs.map(t => ({
        id: stripDemoId(t.trialId),
        name: t.title || `Trial ${stripDemoId(t.trialId).toUpperCase()}`, // Fallback to ID if title is null
      }));
    }

    const legacyTrialsWithDocs = await db
      .selectDistinct({ 
        trialId: protocols.trialId,
        title: trials.title,
      })
      .from(protocols)
      .leftJoin(trials, eq(protocols.trialId, trials.id))
      .where(notLike(protocols.trialId, "%:%"));

    return legacyTrialsWithDocs.map(t => ({
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
      const db = await getDb();
      if (!db || input.trialIds.length === 0) {
        return {};
      }
      const mode = (input.demoMode ?? "sample") as DemoMode;

      // Fetch documents for all trial IDs
      const allDocs = await db
        .select()
        .from(protocols);

      // Phase 5: `isIndexed` was previously derived from the deprecated
      // OpenAI Vector Store table. It now reflects core-backend ingestion
      // status (`complete` or `ready` means indexed and queryable).
      const docsByTrial: Record<string, any[]> = {};

      for (const trialId of input.trialIds) {
        const resolvedTrialId = await resolveTrialId(db, mode, trialId, mode !== "building");
        const trialDocs = allDocs.filter(doc => doc.trialId === resolvedTrialId);

        docsByTrial[trialId] = trialDocs.map((doc) => ({
          ...doc,
          isIndexed:
            doc.coreBackendIngestStatus === "complete" ||
            doc.coreBackendIngestStatus === "ready",
        }));
      }

      return docsByTrial;
    }),
});
