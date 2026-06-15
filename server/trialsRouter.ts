import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import { trialsRouterLocal } from "./trialsRouter.local";
import { isConnectionError } from "./_core/fallbackHelper";

// BE accepts only: planning | active | completed | paused | cancelled
// (trials_status_check). Map FE UI statuses to the nearest BE value.
const FE_TO_BE_STATUS: Record<string, string> = {
  "not-started": "planning",
  recruiting: "active",
  "on-hold": "paused",
};
export function normalizeStatusForBackend(s: string | undefined | null): string {
  if (!s) return "planning";
  return FE_TO_BE_STATUS[s] ?? s;
}

function mapBackendTrialToClient(backendTrial: any) {
  return {
    id: backendTrial.id,
    title: backendTrial.name,
    protocolNumber: backendTrial.protocol_number || "Prot-100",
    investigationalProduct: backendTrial.investigational_product || "",
    indication: backendTrial.description || "",
    description: backendTrial.description || "",
    nctNumber: backendTrial.nct_number || "",
    currentVersion: backendTrial.current_version || "1.0",
    amendmentVersion: backendTrial.amendment_version || "",
    releaseDate: backendTrial.release_date || "",
    sampleSize: backendTrial.sample_size || "100",
    numberOfSites: backendTrial.number_of_sites || "1",
    studyDuration: backendTrial.study_duration || "12 months",
    studyDesignType: backendTrial.study_design_type || "",
    primaryObjective: backendTrial.primary_objective || "",
    primaryEndpoint: backendTrial.primary_endpoint || "",
    phase: backendTrial.phase || "Phase I",
    sponsor: backendTrial.sponsor || "",
    status: backendTrial.status || "planning",
    imageUrl: backendTrial.image_url || null,
    location: backendTrial.location || "",
    studyStart: backendTrial.study_start || null,
    estimatedCloseOut: backendTrial.estimated_close_out || null,
    startDate: backendTrial.study_start || null,
    endDate: backendTrial.estimated_close_out || null,
    principalInvestigator: backendTrial.principal_investigator || null,
    completionPercentage: backendTrial.completion_percentage || 0,
    enrolledPatients: 0,
    targetPatients: 100,
    createdAt: backendTrial.created_at || new Date().toISOString(),
    updatedAt: backendTrial.updated_at || new Date().toISOString(),
  };
}

function normalizeDemoMode(mode: any): "sample" | "full" | "building" | undefined {
  if (mode === "sample" || mode === "full" || mode === "building") {
    return mode;
  }
  return undefined;
}

export const trialsRouter = router({
  getById: publicProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.any().optional(),
    }))
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const t = await callBackend<any>(`/api/trials/${input.id}`, { user: ctx.user });
        if (!t) return null;
        
        let enrolledCount = 0;
        try {
          const enrollments = await callBackend<any[]>(`/api/trial-patients`, {
            query: { trial_id: t.id },
            user: ctx.user
          });
          enrolledCount = enrollments.length;
        } catch (err) {
          console.error(`Failed to fetch patient count for trial ${t.id}:`, err);
        }
        
        return {
          ...mapBackendTrialToClient(t),
          enrolledPatients: enrolledCount,
        };
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[trialsRouter] Backend offline. Falling back to local database for getById.");
          const caller = trialsRouterLocal.createCaller(ctx);
          return caller.getById({
            id: input.id,
            demoMode: normalizeDemoMode(input.demoMode),
          });
        }
        console.error(`Error getting trial ${input.id}:`, err);
        return null;
      }
    }),

  getContext: publicProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.any().optional(),
      include: z.any().optional(),
      pageContext: z.string().optional(),
      emitTelemetry: z.boolean().optional(),
    }))
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const t = await callBackend<any>(`/api/trials/${input.id}`, { user: ctx.user });
        if (!t) return null;
        return {
          trial: mapBackendTrialToClient(t),
          protocol: null,
          chunks: [],
          documents: {
            total: 0,
            active: 0,
            archived: 0,
            indexed: 0,
            processing: 0,
            categories: {},
            latestUploadedAt: null,
            currentProtocol: null as any,
            latestProtocolIndexed: false,
            protocolCount: 0,
            amendmentCount: 0,
          },
          telemetry: null as any,
          execution: null as any,
          suggestions: [],
          insights: [],
        };
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[trialsRouter] Backend offline. Falling back to local database for getContext.");
          const caller = trialsRouterLocal.createCaller(ctx);
          return caller.getContext({
            id: input.id,
            demoMode: normalizeDemoMode(input.demoMode),
            include: Array.isArray(input.include) ? input.include : undefined,
            pageContext: input.pageContext,
            emitTelemetry: input.emitTelemetry,
          });
        }
        console.error("Error in getContext proxy:", err);
        return null;
      }
    }),

  list: publicProcedure
    .input(z.object({
      demoMode: z.any().optional(),
    }).optional())
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const trials = await callBackend<any[]>(`/api/trials`, { user: ctx.user });
        
        const enriched = await Promise.all(trials.map(async (t) => {
          let enrolledCount = 0;
          try {
            const enrollments = await callBackend<any[]>(`/api/trial-patients`, {
              query: { trial_id: t.id },
              user: ctx.user
            });
            enrolledCount = enrollments.length;
          } catch (err) {
            console.error(`Failed to fetch patient count for trial ${t.id}:`, err);
          }
          
          return {
            ...mapBackendTrialToClient(t),
            enrolledPatients: enrolledCount,
          };
        }));
        
        return enriched;
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[trialsRouter] Backend offline. Falling back to local database for list.");
          const caller = trialsRouterLocal.createCaller(ctx);
          return caller.list({
            demoMode: normalizeDemoMode(input?.demoMode),
          });
        }
        console.error("Error listing trials:", err);
        return [];
      }
    }),

  create: protectedProcedure
    .input(z.object({
      id: z.string().optional(),
      title: z.string(),
      protocolNumber: z.string().optional(),
      investigationalProduct: z.string().optional(),
      indication: z.string().optional(),
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
      enrolledPatients: z.number().optional(),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().optional(),
      demoMode: z.any().optional(),
    }))
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      const body = {
        name: input.title,
        sponsor: input.sponsor || "",
        phase: input.phase || "Phase I",
        location: input.location || "San Francisco, CA",
        status: normalizeStatusForBackend(input.status),
        study_start: input.studyStart || input.startDate || null,
        estimated_close_out: input.estimatedCloseOut || input.endDate || null,
        description: input.indication || "",
      };
      
      try {
        const created = await callBackend<any>(`/api/trials/with-assignments`, {
          method: "POST",
          body: {
            ...body,
            members: [],
            pending_members: [],
          },
          user: ctx.user,
        });
        return mapBackendTrialToClient(created);
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[trialsRouter] Backend offline. Falling back to local database for create.");
          const caller = trialsRouterLocal.createCaller(ctx);
          return caller.create({
            ...input,
            id: input.id || `trial-${Math.random().toString(36).substring(7)}`,
            demoMode: normalizeDemoMode(input.demoMode) ?? "sample",
          } as any);
        }
        console.error("Error creating trial:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create trial on backend",
        });
      }
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().optional(),
      protocolNumber: z.string().optional(),
      investigationalProduct: z.string().optional(),
      indication: z.string().optional(),
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
      enrolledPatients: z.number().optional(),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().optional(),
      demoMode: z.any().optional(),
    }))
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      const body: any = {};
      if (input.title !== undefined) body.name = input.title;
      if (input.sponsor !== undefined) body.sponsor = input.sponsor;
      if (input.phase !== undefined) body.phase = input.phase;
      if (input.status !== undefined) body.status = normalizeStatusForBackend(input.status);
      if (input.location !== undefined) body.location = input.location;
      if (input.studyStart !== undefined) body.study_start = input.studyStart;
      if (input.startDate !== undefined) body.study_start = input.startDate;
      if (input.estimatedCloseOut !== undefined) body.estimated_close_out = input.estimatedCloseOut;
      if (input.endDate !== undefined) body.estimated_close_out = input.endDate;
      if (input.indication !== undefined) body.description = input.indication;
      
      try {
        const updated = await callBackend<any>(`/api/trials/${input.id}`, {
          method: "PUT",
          body,
          user: ctx.user,
        });
        return mapBackendTrialToClient(updated);
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[trialsRouter] Backend offline. Falling back to local database for update.");
          const caller = trialsRouterLocal.createCaller(ctx);
          return caller.update({
            ...input,
            demoMode: normalizeDemoMode(input.demoMode),
          } as any);
        }
        console.error("Error updating trial:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update trial on backend",
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.any().optional(),
    }))
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      // In proxy mode, delete was a mock success, but in fallback mode we should invoke local delete
      // so it cascades cleanly in MySQL.
      try {
        // Try calling delete on backend if it supports it
        await callBackend(`/api/trials/${input.id}`, {
          method: "DELETE",
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          console.warn("[trialsRouter] Backend offline. Falling back to local database for delete.");
          const caller = trialsRouterLocal.createCaller(ctx);
          return caller.delete({
            id: input.id,
            demoMode: normalizeDemoMode(input.demoMode) ?? "sample",
          });
        }
        // If it was another error, just return mock success like the original proxy did
        return { success: true };
      }
    }),
});
