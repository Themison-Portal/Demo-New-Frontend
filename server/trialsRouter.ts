import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import { getCoreBackendClient } from "./_core/coreBackendClient";
import { authTokenFrom } from "./_core/coreBackendDocs";
import { trialsRouterLocal } from "./trialsRouter.local";
import { isConnectionError } from "./_core/fallbackHelper";

/**
 * Trials are BE-owned (Postgres `trials`, keyed by UUID). The FE client routes
 * by a bare `slug` (e.g. "cardiac-a2b3c", "1") and the demo dataset is a
 * `demo_mode` (sample|full|building). The BFF resolves (slug, demoMode) -> the
 * BE trial via `GET /api/trials/by-slug`, and presents `id = slug` to the
 * client so routing is unchanged. The FE MySQL `trials` table is only used as a
 * transition fallback (for trials not yet backfilled into the BE) and is
 * retired in Phase E.
 */

// BE status CHECK is planning|active|completed|paused|cancelled. Map FE<->BE.
const FE_TO_BE_STATUS: Record<string, string> = {
  "not-started": "planning",
  recruiting: "active",
  "on-hold": "paused",
  terminated: "cancelled",
};
const BE_TO_FE_STATUS: Record<string, string> = {
  planning: "not-started",
  paused: "on-hold",
  cancelled: "terminated",
};
export function normalizeStatusForBackend(s: string | undefined | null): string {
  if (!s) return "planning";
  return FE_TO_BE_STATUS[s] ?? s;
}
function mapBackendStatusToClient(s: string | undefined | null): string {
  if (!s) return "not-started";
  return BE_TO_FE_STATUS[s] ?? s;
}

function mapBackendTrialToClient(t: any) {
  return {
    // Present the bare slug to the client (it routes by `id`); fall back to the
    // BE UUID for legacy rows that predate the slug column.
    id: t.slug || t.id,
    coreBackendTrialId: t.id,
    title: t.name,
    protocolNumber: t.protocol_number || "",
    investigationalProduct: t.investigational_product || "",
    indication: t.indication || "",
    description: t.description || "",
    nctNumber: t.nct_number || "",
    currentVersion: t.current_version || "1.0",
    amendmentVersion: t.amendment_version || "",
    releaseDate: t.release_date || "",
    sampleSize: t.sample_size || "",
    numberOfSites: t.number_of_sites || "",
    studyDuration: t.study_duration || "",
    studyDesignType: t.study_design_type || "",
    primaryObjective: t.primary_objective || "",
    primaryEndpoint: t.primary_endpoint || "",
    phase: t.phase || "Phase I",
    sponsor: t.sponsor || "",
    status: mapBackendStatusToClient(t.status),
    imageUrl: t.image_url || null,
    location: t.location || "",
    studyStart: t.study_start || null,
    estimatedCloseOut: t.estimated_close_out || null,
    startDate: t.study_start || null,
    endDate: t.estimated_close_out || null,
    principalInvestigator: t.principal_investigator || null,
    completionPercentage: t.completion_percentage ?? 0,
    enrolledPatients: t.enrolled_patients ?? 0,
    targetPatients: t.target_patients ?? null,
    createdAt: t.created_at || new Date().toISOString(),
    updatedAt: t.updated_at || new Date().toISOString(),
  };
}

function normalizeDemoMode(mode: any): "sample" | "full" | "building" | undefined {
  if (mode === "sample" || mode === "full" || mode === "building") return mode;
  return undefined;
}

/** Resolve the client's slug (+ demoMode) to the BE trial row. Throws on 404. */
async function resolveBeTrial(slug: string, demoMode: string | undefined, ctx: any) {
  return callBackend<any>(`/api/trials/by-slug`, {
    query: { slug, demo_mode: demoMode },
    user: ctx.user,
  });
}

/** Live enrolled-patient count for a BE trial UUID. */
async function enrolledCount(beUuid: string, ctx: any): Promise<number> {
  try {
    const enr = await callBackend<any[]>(`/api/trial-patients`, {
      query: { trial_id: beUuid },
      user: ctx.user,
    });
    return Array.isArray(enr) ? enr.length : 0;
  } catch {
    return 0;
  }
}

/** Document-hub aggregate computed from the BE documents (the local aggregator
 * reads the retired `protocols` table, so getContext overrides it with this). */
async function computeDocsAggregate(beUuid: string, ctx: any) {
  let docs: any[] = [];
  try {
    docs = await getCoreBackendClient().listTrialDocuments(beUuid, authTokenFrom(ctx));
  } catch {
    docs = [];
  }
  const isReady = (s: any) => s === "ready" || s === "complete";
  const active = docs.filter((d) => !d.archived_at);
  const indexed = active.filter((d) => isReady(d.ingestion_status));
  const processing = active.filter(
    (d) => d.ingestion_status && !isReady(d.ingestion_status) && d.ingestion_status !== "failed"
  );
  const protocols = active.filter((d) =>
    String(d.category ?? d.document_type ?? "").toLowerCase().includes("protocol")
  );
  const amendments = active.filter((d) =>
    String(d.category ?? "").toLowerCase().includes("amend")
  );
  const current = protocols.find((d) => d.is_current) ?? protocols[0] ?? null;
  const categories: Record<string, number> = {};
  for (const d of active) {
    const c = d.category ?? d.document_type ?? "Other";
    categories[c] = (categories[c] ?? 0) + 1;
  }
  const latestUploadedAt = active.reduce<string | null>(
    (m, d) => (!m || new Date(d.created_at) > new Date(m) ? d.created_at : m),
    null
  );
  return {
    total: docs.length,
    active: active.length,
    archived: docs.length - active.length,
    indexed: indexed.length,
    processing: processing.length,
    categories,
    latestUploadedAt,
    currentProtocol: current
      ? { id: current.id, filename: current.document_name }
      : null,
    latestProtocolIndexed: current ? isReady(current.ingestion_status) : false,
    protocolCount: protocols.length,
    amendmentCount: amendments.length,
  };
}

/** Client input -> BE trial body (snake_case). `slug`/`demo_mode` set explicitly. */
function buildTrialBody(input: any): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    if (v !== undefined) b[k] = v;
  };
  set("name", input.title);
  set("sponsor", input.sponsor);
  set("phase", input.phase);
  set("location", input.location);
  if (input.status !== undefined) b.status = normalizeStatusForBackend(input.status);
  if (input.studyStart !== undefined) b.study_start = input.studyStart;
  if (input.startDate !== undefined) b.study_start = input.startDate;
  if (input.estimatedCloseOut !== undefined) b.estimated_close_out = input.estimatedCloseOut;
  if (input.endDate !== undefined) b.estimated_close_out = input.endDate;
  set("description", input.description);
  set("indication", input.indication);
  set("protocol_number", input.protocolNumber);
  set("investigational_product", input.investigationalProduct);
  set("nct_number", input.nctNumber);
  set("current_version", input.currentVersion);
  set("amendment_version", input.amendmentVersion);
  set("release_date", input.releaseDate);
  set("sample_size", input.sampleSize);
  set("number_of_sites", input.numberOfSites);
  set("study_duration", input.studyDuration);
  set("study_design_type", input.studyDesignType);
  set("primary_objective", input.primaryObjective);
  set("primary_endpoint", input.primaryEndpoint);
  set("principal_investigator", input.principalInvestigator);
  set("enrolled_patients", input.enrolledPatients);
  set("target_patients", input.targetPatients);
  set("completion_percentage", input.completionPercentage);
  return b;
}

// Shared create/update input fields.
const trialWriteFields = {
  title: z.string().optional(),
  protocolNumber: z.string().optional(),
  investigationalProduct: z.string().optional(),
  indication: z.string().optional(),
  description: z.string().optional(),
  nctNumber: z.string().optional(),
  currentVersion: z.string().optional(),
  amendmentVersion: z.string().optional(),
  releaseDate: z.string().optional(),
  phase: z.string().optional(),
  status: z.string().optional(),
  sponsor: z.string().optional(),
  location: z.string().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  studyStart: z.string().nullable().optional(),
  estimatedCloseOut: z.string().nullable().optional(),
  sampleSize: z.string().optional(),
  numberOfSites: z.string().optional(),
  studyDuration: z.string().optional(),
  studyDesignType: z.string().optional(),
  primaryObjective: z.string().optional(),
  primaryEndpoint: z.string().optional(),
  principalInvestigator: z.string().nullable().optional(),
  enrolledPatients: z.number().optional(),
  targetPatients: z.number().optional(),
  completionPercentage: z.number().optional(),
  demoMode: z.any().optional(),
};

export const trialsRouter = router({
  getById: publicProcedure
    .input(z.object({ id: z.string(), demoMode: z.any().optional() }))
    .query(async ({ input, ctx }) => {
      const demoMode = normalizeDemoMode(input.demoMode);
      try {
        const t = await resolveBeTrial(input.id, demoMode, ctx);
        const enrolled = await enrolledCount(t.id, ctx);
        return { ...mapBackendTrialToClient(t), enrolledPatients: enrolled };
      } catch (err) {
        // Offline OR trial not yet backfilled into the BE -> FE fallback.
        try {
          return await trialsRouterLocal
            .createCaller(ctx)
            .getById({ id: input.id, demoMode });
        } catch {
          if (!isConnectionError(err)) {
            console.error(`Error getting trial ${input.id}:`, err);
          }
          return null;
        }
      }
    }),

  getContext: publicProcedure
    .input(
      z.object({
        id: z.string(),
        demoMode: z.any().optional(),
        include: z.any().optional(),
        pageContext: z.string().optional(),
        emitTelemetry: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const demoMode = normalizeDemoMode(input.demoMode);
      const include = Array.isArray(input.include) ? input.include : undefined;
      const localArgs = {
        id: input.id,
        demoMode,
        include,
        pageContext: input.pageContext,
        emitTelemetry: input.emitTelemetry,
      };
      try {
        const beTrial = await resolveBeTrial(input.id, demoMode, ctx);
        // Reuse the local aggregator for execution/telemetry/insights (keyed by
        // the FE prefixed id); override `trial` with BE metadata and `documents`
        // with a BE-computed aggregate (local reads the retired protocols table).
        let localCtx: any = null;
        try {
          localCtx = await trialsRouterLocal.createCaller(ctx).getContext(localArgs);
        } catch {
          localCtx = null; // BE-only trial with no FE child data yet
        }
        const [enrolled, documents] = await Promise.all([
          enrolledCount(beTrial.id, ctx),
          computeDocsAggregate(beTrial.id, ctx),
        ]);
        const trial = {
          ...mapBackendTrialToClient(beTrial),
          enrolledPatients: enrolled,
        };
        if (localCtx) return { ...localCtx, trial, documents };
        return {
          trial,
          protocol: null,
          chunks: [],
          documents,
          telemetry: null,
          execution: null,
          suggestions: [],
          insights: [],
          pageContext: input.pageContext ?? null,
          generatedAt: new Date().toISOString(),
          contextVersion: "v2",
        };
      } catch (err) {
        try {
          return await trialsRouterLocal.createCaller(ctx).getContext(localArgs);
        } catch {
          if (!isConnectionError(err)) {
            console.error("Error in getContext:", err);
          }
          return null;
        }
      }
    }),

  list: publicProcedure
    .input(z.object({ demoMode: z.any().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const demoMode = normalizeDemoMode(input?.demoMode);
      try {
        const trials = await callBackend<any[]>(`/api/trials`, {
          query: { demo_mode: demoMode },
          user: ctx.user,
        });
        return await Promise.all(
          (trials ?? []).map(async (t) => ({
            ...mapBackendTrialToClient(t),
            enrolledPatients: await enrolledCount(t.id, ctx),
          }))
        );
      } catch (err) {
        try {
          return await trialsRouterLocal.createCaller(ctx).list({ demoMode });
        } catch {
          if (!isConnectionError(err)) console.error("Error listing trials:", err);
          return [];
        }
      }
    }),

  create: protectedProcedure
    .input(z.object({ id: z.string().optional(), ...trialWriteFields, title: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const demoMode = normalizeDemoMode(input.demoMode);
      const slug =
        input.id || `trial-${Math.random().toString(36).substring(2, 9)}`;
      const body = {
        ...buildTrialBody(input),
        slug,
        demo_mode: demoMode,
        // BE-required fields with defaults.
        name: input.title,
        phase: input.phase || "Phase I",
        location: input.location || "San Francisco, CA",
        sponsor: input.sponsor || "",
        status: normalizeStatusForBackend(input.status),
        members: [],
        pending_members: [],
      };
      try {
        const created = await callBackend<any>(`/api/trials/with-assignments`, {
          method: "POST",
          body,
          user: ctx.user,
        });
        return mapBackendTrialToClient(created);
      } catch (err) {
        if (isConnectionError(err)) {
          return trialsRouterLocal
            .createCaller(ctx)
            .create({ ...input, id: slug, demoMode: demoMode ?? "sample" } as any);
        }
        console.error("Error creating trial:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create trial on backend",
        });
      }
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), ...trialWriteFields }))
    .mutation(async ({ input, ctx }) => {
      const demoMode = normalizeDemoMode(input.demoMode);
      try {
        const beTrial = await resolveBeTrial(input.id, demoMode, ctx);
        const updated = await callBackend<any>(`/api/trials/${beTrial.id}`, {
          method: "PUT",
          body: buildTrialBody(input),
          user: ctx.user,
        });
        return mapBackendTrialToClient(updated);
      } catch (err) {
        if (isConnectionError(err)) {
          return trialsRouterLocal
            .createCaller(ctx)
            .update({ ...input, demoMode } as any);
        }
        console.error("Error updating trial:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update trial on backend",
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string(), demoMode: z.any().optional() }))
    .mutation(async ({ input, ctx }) => {
      const demoMode = normalizeDemoMode(input.demoMode);
      try {
        const beTrial = await resolveBeTrial(input.id, demoMode, ctx);
        await callBackend(`/api/trials/${beTrial.id}`, {
          method: "DELETE",
          user: ctx.user,
        });
        // Also cascade FE-owned child data for this trial (scaffolds/maps/etc.)
        // — handled by the local delete until Phase C moves it server-side.
        try {
          await trialsRouterLocal
            .createCaller(ctx)
            .delete({ id: input.id, demoMode: demoMode ?? "sample" });
        } catch {
          /* FE child cleanup best-effort */
        }
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          return trialsRouterLocal
            .createCaller(ctx)
            .delete({ id: input.id, demoMode: demoMode ?? "sample" });
        }
        console.error("Error deleting trial:", err);
        return { success: true };
      }
    }),
});
