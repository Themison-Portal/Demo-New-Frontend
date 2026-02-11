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
import {
  evaluateUnifiedRetrievalQuality,
  runUnifiedQuery,
  runUnifiedQueryDiagnostics,
} from "./_core/unifiedQuery";
import { runUnifiedEvalHarness } from "./_core/evalHarness";
import {
  getTelemetryDrivenSignals,
  listPendingApprovals,
  resolveApproval,
  runOrchestratedAgent,
} from "./_core/agentOrchestrator";
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

  queryDiagnostics: protectedProcedure
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
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId =
        input.trialId && input.trialId !== "all"
          ? await resolveTrialId(db, mode, input.trialId, mode !== "building")
          : undefined;

      const diagnostics = await runUnifiedQueryDiagnostics({
        db,
        query: input.query,
        messages: input.messages,
        protocolIds: input.documentIds,
        trialId: resolvedTrialId,
        userId: ctx.user.id,
      });

      await logTelemetryEvent({
        eventType: "ai_query_diagnostics_requested",
        action: "requested",
        userId: String(ctx.user.id),
        entityType: "query",
        entityId: resolvedTrialId ?? null,
        payload: {
          demoMode: mode,
          route: diagnostics.route,
          focus: diagnostics.plan.focus,
          candidateCount: diagnostics.retrieval.candidateCount,
          selectedCount: diagnostics.retrieval.selectedCount,
          protocolCount: diagnostics.protocols.length,
        },
        aiInvolved: true,
      });

      return {
        ...diagnostics,
        trialId: resolvedTrialId ? stripDemoId(resolvedTrialId) : null,
      };
    }),

  runEvalHarness: protectedProcedure
    .input(
      z.object({
        trialId: z.string().optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        documentIds: z.array(z.number().int().positive()).min(1),
        cases: z
          .array(
            z.object({
              id: z.string().min(1).max(120),
              query: z.string().min(2).max(2000),
              kind: z.enum([
                "criteria",
                "schedule",
                "general",
                "visit_procedures",
                "scheduling",
                "special_requirements",
                "eligibility",
                "safety",
                "dosing",
                "cross_document",
                "abstention",
              ]),
              category: z.string().max(120).optional(),
              mustContain: z.array(z.string().min(1).max(200)).optional(),
              mustNotContain: z.array(z.string().min(1).max(200)).optional(),
              mustCite: z.union([z.boolean(), z.array(z.string().min(1).max(200))]).optional(),
              mustReference: z.string().min(1).max(200).optional(),
              mustStartWithYesOrNo: z.boolean().optional(),
              mustContainNumber: z.boolean().optional(),
              mustContainTimeframe: z.boolean().optional(),
              expectedCount: z.number().int().positive().max(200).optional(),
              useStructuredExpectedCount: z.boolean().optional(),
              mustListAll: z.boolean().optional(),
              retrievalMustContain: z.array(z.string().min(1).max(200)).optional(),
              mustNotHallucinate: z.boolean().optional(),
              shouldAbstain: z.boolean().optional(),
            })
          )
          .optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId =
        input.trialId && input.trialId !== "all"
          ? await resolveTrialId(db, mode, input.trialId, mode !== "building")
          : undefined;

      const report = await runUnifiedEvalHarness({
        db,
        trialId: resolvedTrialId,
        protocolIds: input.documentIds,
        cases: input.cases,
      });

      await logTelemetryEvent({
        eventType: "ai_eval_harness_run",
        action: "completed",
        userId: String(ctx.user.id),
        entityType: "analytics",
        entityId: resolvedTrialId ?? null,
        payload: {
          demoMode: mode,
          cases: report.totals.cases,
          passed: report.totals.passed,
          failed: report.totals.failed,
          abstained: report.totals.abstained,
          retrievalPrecisionAtKProxy: report.metrics.retrievalPrecisionAtKProxy,
          citationCorrectness: report.metrics.citationCorrectness,
        },
        aiInvolved: true,
      });

      return report;
    }),

  getTelemetrySignals: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");
      const signalResult = await getTelemetryDrivenSignals({
        db,
        trialId: resolvedTrialId,
      });
      if (!signalResult) return null;

      await logTelemetryEvent({
        eventType: "ai_signals_requested",
        action: "viewed",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolvedTrialId,
        payload: {
          demoMode: mode,
          signalCount: signalResult.signals.length,
          readinessScore: signalResult.snapshot.scores.readinessScore,
          riskScore: signalResult.snapshot.scores.riskScore,
        },
        aiInvolved: true,
      });

      return {
        ...signalResult,
        trialId: stripDemoId(signalResult.trialId),
      };
    }),

  runAgent: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        agentType: z.enum([
          "study_setup",
          "visit_prep",
          "deviation_prevention",
          "amendment_impact",
          "coordination",
          "query_resolution",
        ]),
        query: z.string().max(5000).optional(),
        documentIds: z.array(z.number().int().positive()).optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        requireApproval: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId = await resolveTrialId(db, mode, input.trialId, mode !== "building");
      const result = await runOrchestratedAgent({
        db,
        trialId: resolvedTrialId,
        agentType: input.agentType,
        requestedBy: String(ctx.user.id),
        requireApproval: input.requireApproval ?? input.agentType !== "query_resolution",
        query: input.query ?? null,
        documentIds: input.documentIds ?? [],
        payload: input.payload ?? {},
      });

      await logTelemetryEvent({
        eventType: "ai_agent_run_requested",
        action: result.status === "pending_approval" ? "pending_approval" : "completed",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolvedTrialId,
        payload: {
          demoMode: mode,
          agentType: input.agentType,
          confidence: result.confidence,
          requiresApproval: result.requiresApproval,
          approvalId: result.approvalId,
        },
        aiInvolved: true,
      });

      return {
        ...result,
        trialId: stripDemoId(result.trialId),
      };
    }),

  getPendingAgentApprovals: protectedProcedure
    .input(
      z.object({
        trialId: z.string().optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedTrialId =
        input.trialId && input.trialId !== "all"
          ? await resolveTrialId(db, mode, input.trialId, mode !== "building")
          : undefined;

      const rows = listPendingApprovals({
        trialId: resolvedTrialId,
        requestedBy: undefined,
      });

      await logTelemetryEvent({
        eventType: "ai_agent_approvals_viewed",
        action: "viewed",
        userId: String(ctx.user.id),
        entityType: "analytics",
        entityId: resolvedTrialId ?? null,
        payload: {
          pendingCount: rows.length,
          demoMode: mode,
        },
        aiInvolved: true,
      });

      return rows.map((row) => ({
        ...row,
        trialId: stripDemoId(row.trialId),
        result: {
          ...row.result,
          trialId: stripDemoId(row.result.trialId),
        },
      }));
    }),

  resolveAgentApproval: protectedProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        approved: z.boolean(),
        modifications: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const resolved = resolveApproval({
        approvalId: input.approvalId,
        approved: input.approved,
        modifications: input.modifications ?? null,
      });

      await logTelemetryEvent({
        eventType: input.approved ? "ai_agent_approved" : "ai_agent_rejected",
        action: input.approved ? "approved" : "rejected",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolved.approval.trialId,
        payload: {
          agentType: resolved.approval.agentType,
          approvalId: input.approvalId,
          modifications: input.modifications ?? null,
        },
        aiInvolved: true,
        userCorrection: input.approved ? null : JSON.stringify(input.modifications ?? {}),
      });

      return {
        ...resolved,
        approval: {
          ...resolved.approval,
          trialId: stripDemoId(resolved.approval.trialId),
          result: {
            ...resolved.approval.result,
            trialId: stripDemoId(resolved.approval.result.trialId),
          },
        },
        result: {
          ...resolved.result,
          trialId: stripDemoId(resolved.result.trialId),
        },
      };
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
