import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { type DemoMode, resolveTrialId, stripDemoId } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";
import {
  buildCrossTrialAnalytics,
  computeTrialIntelligenceSnapshot,
  exportTrainingDataset,
  persistTrialSnapshot,
  syncTrialKnowledgeGraph,
} from "./_core/aiIntelligence";
import { evaluateUnifiedRetrievalQuality, runUnifiedQuery } from "./_core/unifiedQuery";
import { aiTrainingExamples, knowledgeGraphEdges, knowledgeGraphNodes } from "../drizzle/schema";
import { desc, eq } from "drizzle-orm";

export const aiIntelligenceRouter = router({
  query: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(5000),
        trialId: z.string().optional(),
        documentIds: z.array(z.number().int().positive()).optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string(),
            })
          )
          .optional(),
        sessionId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId =
        input.trialId && input.trialId !== "all"
          ? await resolveTrialId(db, mode, input.trialId, mode !== "building")
          : undefined;

      await logTelemetryEvent({
        eventType: "ai_query_submitted",
        action: "submitted",
        userId: String(ctx.user.id),
        sessionId: input.sessionId,
        entityType: "query",
        entityId: resolvedTrialId,
        payload: {
          query: input.query,
          trialId: resolvedTrialId,
          documentIds: input.documentIds ?? [],
          demoMode: mode,
        },
        aiInvolved: true,
      });

      const result = await runUnifiedQuery({
        db,
        query: input.query,
        messages: input.messages,
        protocolIds: input.documentIds,
        trialId: resolvedTrialId,
        userId: ctx.user.id,
      });

      await logTelemetryEvent({
        eventType: "ai_response_generated",
        action: "generated",
        userId: String(ctx.user.id),
        sessionId: input.sessionId,
        entityType: "response",
        entityId: resolvedTrialId,
        payload: {
          route: result.route,
          confidence: result.confidence,
          abstained: result.abstained,
        },
        aiInvolved: true,
        aiOutput: result.message,
        aiSources: result.sources,
      });

      return {
        ...result,
        trialId: resolvedTrialId ? stripDemoId(resolvedTrialId) : null,
      };
    }),

  evaluateRetrievalQuality: protectedProcedure
    .input(
      z.object({
        query: z.string().min(2).max(2000),
        documentIds: z.array(z.number().int().positive()).min(1),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      return await evaluateUnifiedRetrievalQuality({
        db,
        query: input.query,
        protocolIds: input.documentIds,
      });
    }),

  getTrialSnapshot: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        persist: z.boolean().optional(),
        snapshotVersion: z.string().max(32).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");
      const snapshot = await computeTrialIntelligenceSnapshot(db, resolvedTrialId);
      if (!snapshot) return null;

      if (input.persist) {
        await persistTrialSnapshot(db, snapshot, input.snapshotVersion ?? "v1");
      }

      await logTelemetryEvent({
        eventType: "ai_snapshot_requested",
        action: "viewed",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolvedTrialId,
        payload: {
          persist: input.persist ?? false,
          demoMode: mode,
        },
        aiInvolved: true,
      });

      return {
        ...snapshot,
        trialId: stripDemoId(snapshot.trialId),
      };
    }),

  syncTrialGraph: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");
      const result = await syncTrialKnowledgeGraph(db, resolvedTrialId);

      await logTelemetryEvent({
        eventType: "knowledge_graph_synced",
        action: "synced",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolvedTrialId,
        payload: {
          nodesCreated: result.nodesCreated,
          edgesCreated: result.edgesCreated,
          demoMode: mode,
        },
        aiInvolved: true,
      });

      return {
        ...result,
        trialId: stripDemoId(result.trialId),
      };
    }),

  getTrialGraph: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        maxNodes: z.number().min(1).max(5000).optional(),
        maxEdges: z.number().min(1).max(10000).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");

      const nodeLimit = input.maxNodes ?? 1000;
      const edgeLimit = input.maxEdges ?? 2500;
      const nodes = await db
        .select()
        .from(knowledgeGraphNodes)
        .where(eq(knowledgeGraphNodes.trialId, resolvedTrialId))
        .limit(nodeLimit);
      const edges = await db
        .select()
        .from(knowledgeGraphEdges)
        .where(eq(knowledgeGraphEdges.trialId, resolvedTrialId))
        .limit(edgeLimit);

      return {
        trialId: stripDemoId(resolvedTrialId),
        nodes,
        edges,
      };
    }),

  getCrossTrialAnalytics: protectedProcedure
    .input(
      z.object({
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        persistRollups: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const result = await buildCrossTrialAnalytics(db, mode, input.persistRollups ?? false);

      await logTelemetryEvent({
        eventType: "cross_trial_analytics_viewed",
        action: "viewed",
        userId: String(ctx.user.id),
        entityType: "analytics",
        entityId: mode,
        payload: {
          demoMode: mode,
          persistRollups: input.persistRollups ?? false,
          totalTrials: result.totalTrials,
        },
        aiInvolved: true,
      });

      return {
        ...result,
        atRiskTrials: result.atRiskTrials.map((trial) => ({
          ...trial,
          trialId: stripDemoId(trial.trialId),
        })),
      };
    }),

  exportTrainingDataset: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(5000).optional(),
        includeJsonl: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const dataset = await exportTrainingDataset(db, input.limit ?? 500);

      await logTelemetryEvent({
        eventType: "training_dataset_exported",
        action: "exported",
        userId: String(ctx.user.id),
        entityType: "training_dataset",
        payload: {
          limit: input.limit ?? 500,
          includeJsonl: input.includeJsonl ?? true,
          count: dataset.count,
        },
        aiInvolved: true,
      });

      return {
        generatedAt: dataset.generatedAt,
        count: dataset.count,
        labelDistribution: dataset.labelDistribution,
        records: dataset.records,
        jsonl: input.includeJsonl === false ? null : dataset.jsonl,
      };
    }),

  recordSuggestionFeedback: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        suggestionId: z.string(),
        decision: z.enum(["accepted", "dismissed", "edited"]),
        prompt: z.string().optional(),
        response: z.string().optional(),
        correction: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");

      await db.insert(aiTrainingExamples).values({
        sourceEventId: null,
        trialId: resolvedTrialId,
        userId: String(ctx.user.id),
        prompt: input.prompt ?? null,
        response: input.response ?? null,
        label: input.decision,
        correction: input.correction ?? null,
        metadata: {
          suggestionId: input.suggestionId,
          decision: input.decision,
          ...(input.metadata ?? {}),
        },
        createdAt: new Date(),
      });

      await logTelemetryEvent({
        eventType: "ai_suggestion_feedback",
        action: input.decision,
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolvedTrialId,
        payload: {
          suggestionId: input.suggestionId,
          decision: input.decision,
          demoMode: mode,
        },
        aiInvolved: true,
      });

      const recent = await db
        .select()
        .from(aiTrainingExamples)
        .where(eq(aiTrainingExamples.trialId, resolvedTrialId))
        .orderBy(desc(aiTrainingExamples.createdAt))
        .limit(50);

      return {
        success: true,
        trialId: stripDemoId(resolvedTrialId),
        recorded: recent.length,
      } as const;
    }),
});
