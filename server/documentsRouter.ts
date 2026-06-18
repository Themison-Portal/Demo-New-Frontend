import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { documentCategories, trials } from "../drizzle/schema";
import { eq, like, notLike } from "drizzle-orm";
import { callBackend } from "./_core/backendClient";
import { resolveTrialId, stripDemoId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import { ENV } from "./_core/env";
import { getCoreBackendClient } from "./_core/coreBackendClient";
import {
  CoreBackendError,
  type CoreBackendTrialDocument,
} from "@shared/coreBackendTypes";
import { normalizeStatusForBackend } from "./trialsRouter";
import {
  authTokenFrom,
  resolveBeTrialIdForRead,
  mapBeDoc,
} from "./_core/coreBackendDocs";

/**
 * Documents are owned by the BE (`trial_documents` in Postgres) — the FE
 * `protocols` table is retired. These BFF procedures read/write documents
 * through the core-backend REST API; the FE MySQL is only consulted for the
 * `trials.coreBackendTrialId` mapping (trials stay FE-owned).
 */

/**
 * Demo/building trials are local sandbox rows in the FE MySQL `trials` table
 * with no core-backend counterpart. This lazily creates a core-backend trial
 * for such a local trial (on first upload) and persists the mapping in
 * `trials.coreBackendTrialId`. Returns the core-backend trial UUID, or null if
 * registration fails.
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
      `[documents] core-backend trial create returned no id for ${localTrialId}.`
    );
  } catch (error) {
    console.warn(
      `[documents] Failed to register local trial ${localTrialId} with core-backend.`,
      error
    );
  }
  return null;
}

const parseVersionNumber = (value?: string | null) => {
  if (!value) return 0;
  const match = value.match(/(\d+)/);
  const parsed = match ? Number.parseInt(match[1], 10) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

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
      if (!db) return [];

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const beTrialId = await resolveBeTrialIdForRead(db, mode, input.trialId);
      if (!beTrialId) {
        // resolveBeTrialIdForRead already logged WHY (no mapping). Surface the
        // input so deployed logs tie it to the trial the user is viewing.
        console.warn(
          `[documents/list] trial="${input.trialId}" mode=${mode} -> no BE trial; returning [].`
        );
        return [];
      }

      let beDocs: CoreBackendTrialDocument[] = [];
      try {
        beDocs = await getCoreBackendClient().listTrialDocuments(
          beTrialId,
          authTokenFrom(ctx)
        );
        console.log(
          `[documents/list] trial="${input.trialId}" mode=${mode} -> beTrial=${beTrialId} -> ${beDocs.length} doc(s)`
        );
      } catch (error) {
        console.error(
          `[documents/list] BE list FAILED trial="${input.trialId}" beTrial=${beTrialId} ` +
            `coreBackendApiUrl=${ENV.coreBackendApiUrl}:`,
          error instanceof Error ? error.message : error
        );
        return [];
      }

      const docs = beDocs
        .map(mapBeDoc)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

      if (input.emitTelemetry) {
        await logTelemetryEvent({
          eventType: "document_hub_viewed",
          action: "viewed",
          userId: ctx.user ? String(ctx.user.id) : null,
          entityType: "trial",
          entityId: beTrialId,
          payload: {
            trialId: beTrialId,
            pageContext: input.pageContext ?? "document-hub",
            totalDocuments: docs.length,
            indexedDocuments: docs.filter((doc) => !!doc.isIndexed).length,
            demoMode: mode,
          },
        });
      }

      return docs;
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
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(
        db,
        mode,
        input.trialId,
        mode !== "building"
      );

      const buffer = Buffer.from(input.fileData, "base64");
      if (buffer.length > 50 * 1024 * 1024) {
        throw new Error("File size exceeds 50MB limit");
      }

      if (!ENV.coreBackendApiUrl) {
        throw new Error(
          "CORE_BACKEND_API_URL is not configured — documents now require the backend."
        );
      }

      // Resolve — and for demo/building trials, lazily provision — the
      // core-backend trial this upload attaches to.
      const [trialMeta] = await db
        .select({
          coreBackendTrialId: trials.coreBackendTrialId,
          currentVersion: trials.currentVersion,
          amendmentVersion: trials.amendmentVersion,
          releaseDate: trials.releaseDate,
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

      // Resolve the trial the SAME way the read path does (bare UUID → BE
      // by-slug → FE mapping), so uploads land under the trial the Hub lists.
      // Only when the trial genuinely isn't in the BE yet do we lazily provision
      // one (transition/legacy demo trials).
      let beTrialId: string | null = await resolveBeTrialIdForRead(
        db,
        mode,
        input.trialId
      );
      if (!beTrialId) {
        const meta = trialMeta ?? {
          title: input.filename.replace(/\.[^./\\]+$/, "") || input.filename,
        };
        beTrialId = await ensureCoreBackendTrialId(db, resolvedTrialId, meta, ctx.user);
      }
      if (!beTrialId) {
        throw new Error(
          "Could not resolve a backend trial for this upload. Please retry."
        );
      }

      const isProtocolCategory = input.category.toLowerCase() === "protocol";
      const authToken = authTokenFrom(ctx);
      const client = getCoreBackendClient();

      // Auto-version: compute the next protocol version from the BE's existing
      // protocol-category documents for this trial.
      let nextAutoVersion = "v1";
      if (isProtocolCategory) {
        try {
          const existing = await client.listTrialDocuments(beTrialId, authToken);
          const maxVersion = existing
            .filter((d) => (d.category ?? "").toLowerCase() === "protocol")
            .reduce((max, d) => {
              const n = parseVersionNumber(d.document_version);
              return n > max ? n : max;
            }, 0);
          nextAutoVersion = `v${maxVersion + 1}`;
        } catch {
          /* non-fatal: fall back to v1 */
        }
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
      const docCategory = isProtocolCategory ? "protocol" : input.category.toLowerCase();

      try {
        // BE-first: the multipart upload creates the trial_documents row +
        // durable storage; the BE enforces the "only one current" invariant.
        const created = await client.uploadTrialDocumentMultipart(
          {
            file: buffer,
            filename: input.filename,
            trial_id: beTrialId,
            document_name: input.filename,
            document_type: docCategory,
            category: input.category,
            document_version: documentVersion,
            amendment_version: amendmentVersion,
            release_date: releaseDate,
            is_current: markAsCurrent,
            source_type: input.sourceType ?? "manual",
            source_reference: input.sourceReference ?? undefined,
          },
          authToken
        );

        // Trigger RAG ingestion (async on the BE; tracked by job_id).
        const job = await client.uploadPdf({
          document_url: created.document_url,
          document_id: created.id,
          chunk_size: 750,
        });

        console.log(
          `[documents.upload] BE ingest started: doc=${created.id} job=${job.job_id}`
        );

        await logTelemetryEvent({
          eventType: "document_context_index_started",
          action: "started",
          userId: String(ctx.user.id),
          entityType: "document",
          entityId: created.id,
          payload: {
            trialId: beTrialId,
            filename: input.filename,
            category: input.category,
            coreBackendDocumentId: created.id,
            coreBackendJobId: job.job_id,
            source: "core-backend",
            demoMode: mode,
          },
          aiInvolved: true,
        });

        return {
          success: true,
          url: created.document_url,
          coreBackendDocumentId: created.id,
        };
      } catch (error) {
        const reason =
          error instanceof CoreBackendError
            ? `${error.path} ${error.status}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        console.error(`❌ BE upload failed for ${input.filename}: ${reason}`);
        throw new Error(
          `Document could not be registered with the backend: ${reason}`
        );
      }
    }),

  // Lazily mint a short-lived openable URL for a document. For the demo BE
  // (local storage) `document_url` is already absolute, but prod/GCS needs a
  // signed URL — the client should call this right before opening the viewer.
  getDownloadUrl: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const res = await getCoreBackendClient().getDownloadUrl(
          input.id,
          authTokenFrom(ctx)
        );
        return { url: res.url };
      } catch (error) {
        console.warn(
          `[documents/getDownloadUrl] failed for ${input.id}:`,
          error instanceof Error ? error.message : error
        );
        return { url: null };
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await getCoreBackendClient().deleteTrialDocument(input.id, authTokenFrom(ctx));
      await logTelemetryEvent({
        eventType: "protocol_deleted",
        action: "deleted",
        userId: String(ctx.user.id),
        entityType: "document",
        entityId: input.id,
      });
      return { success: true };
    }),

  updateControl: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        documentVersion: z.string().max(50).optional(),
        amendmentVersion: z.string().max(50).optional(),
        releaseDate: z.string().max(50).optional(),
        isCurrent: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const update: Record<string, unknown> = {};
      if (input.documentVersion !== undefined) update.document_version = input.documentVersion;
      if (input.amendmentVersion !== undefined) update.amendment_version = input.amendmentVersion;
      if (input.releaseDate !== undefined) update.release_date = input.releaseDate;
      if (input.isCurrent !== undefined) update.is_current = input.isCurrent;

      if (Object.keys(update).length === 0) return { success: true };

      // The BE enforces the "only one current" invariant on is_current=true.
      await getCoreBackendClient().updateTrialDocument(
        input.id,
        update,
        authTokenFrom(ctx)
      );

      await logTelemetryEvent({
        eventType: "document_control_updated",
        action: "edited",
        userId: String(ctx.user.id),
        entityType: "document",
        entityId: input.id,
        payload: update,
      });

      return { success: true };
    }),

  setArchived: protectedProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await getCoreBackendClient().updateTrialDocument(
        input.id,
        { archived_at: input.archived ? new Date().toISOString() : null },
        authTokenFrom(ctx)
      );
      await logTelemetryEvent({
        eventType: input.archived ? "document_archived" : "document_restored",
        action: input.archived ? "archived" : "restored",
        userId: String(ctx.user.id),
        entityType: "document",
        entityId: input.id,
      });
      return { success: true };
    }),

  retryProcessing: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // `id` is the BE document UUID (coreBackendDocumentId).
      try {
        const retry = await callBackend<{
          jobId: string;
          documentId: string;
          status: string;
          message: string;
        }>(`/api/document-ai/retry-ingestion/${encodeURIComponent(input.id)}`, {
          method: "POST",
          user: ctx.user,
        });

        await logTelemetryEvent({
          eventType: "document_processing_retried",
          action: "retry_processing",
          userId: String(ctx.user.id),
          entityType: "document",
          entityId: input.id,
          payload: {
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
          entityType: "document",
          entityId: input.id,
          payload: {
            reason: error instanceof Error ? error.message : String(error),
            source: "core-backend.document-ai.retry-ingestion",
          },
          aiInvolved: true,
        });
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "Failed to queue reingestion",
        };
      }
    }),

  // Category catalog stays FE-owned (a free-text pick-list, independent of the
  // BE trial_documents table).
  getCategories: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(documentCategories).orderBy(documentCategories.name);
  }),

  createCategory: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const existing = await db
        .select()
        .from(documentCategories)
        .where(eq(documentCategories.name, input.name))
        .limit(1);
      if (existing.length > 0) {
        return { success: true, category: existing[0] };
      }

      await db.insert(documentCategories).values({ name: input.name, isDefault: false });
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
    .input(z.object({ id: z.string(), category: z.string().min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      await getCoreBackendClient().updateTrialDocument(
        input.id,
        { category: input.category },
        authTokenFrom(ctx)
      );
      await logTelemetryEvent({
        eventType: "document_category_updated",
        action: "edited",
        userId: String(ctx.user.id),
        entityType: "document",
        entityId: input.id,
        payload: { category: input.category },
      });
      return { success: true };
    }),

  getTrialsWithDocuments: publicProcedure
    .input(
      z
        .object({ demoMode: z.enum(["sample", "full", "building"]).optional() })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const mode = (input?.demoMode ?? "sample") as DemoMode;

      // Candidate trials = FE trials for this demo mode that have a BE mapping.
      const candidates = await db
        .select({
          id: trials.id,
          title: trials.title,
          coreBackendTrialId: trials.coreBackendTrialId,
        })
        .from(trials)
        .where(
          mode === "sample" || mode === "full" || mode === "building"
            ? like(trials.id, `${mode}:%`)
            : notLike(trials.id, "%:%")
        );

      const token = authTokenFrom(ctx);
      const client = getCoreBackendClient();
      const results = await Promise.all(
        candidates
          .filter((t) => !!t.coreBackendTrialId)
          .map(async (t) => {
            try {
              const docs = await client.listTrialDocuments(
                t.coreBackendTrialId as string,
                token
              );
              return docs.length > 0
                ? {
                    id: stripDemoId(t.id),
                    name: t.title || `Trial ${stripDemoId(t.id).toUpperCase()}`,
                  }
                : null;
            } catch {
              return null;
            }
          })
      );
      return results.filter((r): r is { id: string; name: string } => r !== null);
    }),

  listMultipleTrials: publicProcedure
    .input(
      z.object({
        trialIds: z.array(z.string()),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db || input.trialIds.length === 0) return {};
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const token = authTokenFrom(ctx);
      const client = getCoreBackendClient();

      const docsByTrial: Record<string, ReturnType<typeof mapBeDoc>[]> = {};
      await Promise.all(
        input.trialIds.map(async (trialId) => {
          const beTrialId = await resolveBeTrialIdForRead(db, mode, trialId);
          if (!beTrialId) {
            docsByTrial[trialId] = [];
            return;
          }
          try {
            const docs = await client.listTrialDocuments(beTrialId, token);
            docsByTrial[trialId] = docs.map(mapBeDoc);
          } catch {
            docsByTrial[trialId] = [];
          }
        })
      );
      return docsByTrial;
    }),
});
