import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { getDb } from "./db";
import {
  trials,
  protocols,
  fileSearchDocuments,
  fileSearchStores,
  telemetryEvents,
  executionMaps,
  mapPhases,
  mapTasks,
  taskScaffolds,
  phases,
  tasks,
  taskDependencies,
  phaseTransitions,
  protocolSections,
  protocolChunks,
  aiFeatureSnapshots,
  aiAnalyticsRollups,
  aiTrainingExamples,
  knowledgeGraphNodes,
  knowledgeGraphEdges,
} from "../drizzle/schema";
import { and, desc, eq, inArray, like, notLike } from "drizzle-orm";
import { toDemoId, serializeTrial, resolveTrialId, type DemoMode } from "./_core/demoMode";
import { logTelemetryEvent } from "./_core/telemetry";

function extractDbErrorDetails(error: unknown) {
  const err = error as any;
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const sqlState = cause?.sqlState || err?.sqlState;
  const rawMessage =
    cause?.sqlMessage ||
    cause?.message ||
    err?.message ||
    "Database operation failed";

  return {
    code: typeof code === "string" ? code : undefined,
    sqlState: typeof sqlState === "string" ? sqlState : undefined,
    rawMessage: typeof rawMessage === "string" ? rawMessage : String(rawMessage),
  };
}

export const trialsRouter = router({
  // Get a single trial by ID
  getById: publicProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, input.id, mode !== "building");
      const [trial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, resolvedId))
        .limit(1);
      
      return trial ? serializeTrial(trial) : null;
    }),

  // Get unified trial context for AI operations (v2 foundation payload)
  getContext: publicProcedure
    .input(
      z.object({
        id: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
        include: z
          .array(z.enum(["trial", "documents", "telemetry", "execution", "suggestions", "insights"]))
          .optional(),
        pageContext: z.string().optional(),
        emitTelemetry: z.boolean().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, input.id, mode !== "building");
      const include = new Set(
        input.include ?? ["trial", "documents", "telemetry", "execution", "suggestions", "insights"]
      );

      const [trial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, resolvedId))
        .limit(1);

      if (!trial) return null;

      let documents: any = undefined;
      let telemetry: any = undefined;
      let execution: any = undefined;
      let suggestions: any = undefined;
      let insights: any = undefined;

      let protocolRows: Array<any> = [];
      const needsDocuments =
        include.has("documents") ||
        include.has("suggestions") ||
        include.has("insights") ||
        include.has("telemetry");
      const needsTelemetry =
        include.has("telemetry") || include.has("suggestions") || include.has("insights");
      const needsExecution =
        include.has("execution") || include.has("suggestions") || include.has("insights");

      if (needsDocuments || needsExecution || needsTelemetry) {
        try {
          protocolRows = await db
            .select()
            .from(protocols)
            .where(eq(protocols.trialId, resolvedId))
            .orderBy(desc(protocols.createdAt));
        } catch (error) {
          console.warn("[trials.getContext] Unable to load protocol rows", error);
        }
      }

      let documentStats = {
        total: 0,
        active: 0,
        archived: 0,
        indexed: 0,
        processing: 0,
        categories: {} as Record<string, number>,
        latestUploadedAt: null as Date | null,
        currentProtocol: null as any,
        latestProtocolIndexed: false,
      };
      let indexedProtocolIds = new Set<number>();

      if (include.has("documents") || include.has("suggestions") || include.has("insights")) {
        try {
          const protocolIds = protocolRows.map((doc) => doc.id);
          indexedProtocolIds = protocolIds.length
            ? new Set(
                (
                  await db
                    .select({ protocolId: fileSearchDocuments.protocolId })
                    .from(fileSearchDocuments)
                    .where(inArray(fileSearchDocuments.protocolId, protocolIds))
                ).map((row) => row.protocolId)
              )
            : new Set<number>();

          const byCategory = protocolRows.reduce<Record<string, number>>((acc, doc) => {
            const key = String(doc.category || "uncategorized").toLowerCase();
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {});

          const archived = protocolRows.filter((doc) => !!doc.archivedAt);
          const active = protocolRows.filter((doc) => !doc.archivedAt);
          const indexed = active.filter((doc) => indexedProtocolIds.has(doc.id));
          const processing = active.filter((doc) => !indexedProtocolIds.has(doc.id));

          const protocolDocs = protocolRows.filter(
            (doc) => String(doc.category || "").toLowerCase() === "protocol"
          );
          const persistedCurrent = protocolDocs.find((doc) => !!doc.isCurrent && !doc.archivedAt);
          const fallbackCurrent = protocolDocs.find((doc) => !doc.archivedAt) ?? protocolDocs[0];
          const currentProtocol = persistedCurrent ?? fallbackCurrent ?? null;

          documentStats = {
            total: protocolRows.length,
            active: active.length,
            archived: archived.length,
            indexed: indexed.length,
            processing: processing.length,
            categories: byCategory,
            latestUploadedAt: protocolRows[0]?.createdAt ?? null,
            currentProtocol: currentProtocol
              ? {
                  id: currentProtocol.id,
                  filename: currentProtocol.filename,
                  category: currentProtocol.category,
                  documentVersion: currentProtocol.documentVersion,
                  amendmentVersion: currentProtocol.amendmentVersion,
                  releaseDate: currentProtocol.releaseDate,
                  isCurrent: !!currentProtocol.isCurrent,
                  createdAt: currentProtocol.createdAt,
                }
              : null,
            latestProtocolIndexed: currentProtocol ? indexedProtocolIds.has(currentProtocol.id) : false,
          };

          if (include.has("documents")) {
            documents = {
              ...documentStats,
              protocolCount: protocolDocs.length,
              amendmentCount: byCategory["amendment"] ?? 0,
            };
          }
        } catch (error) {
          console.warn("[trials.getContext] Unable to build document context", error);
          documentStats = {
            total: 0,
            active: 0,
            archived: 0,
            indexed: 0,
            processing: 0,
            categories: {},
            latestUploadedAt: null,
            currentProtocol: null,
            latestProtocolIndexed: false,
          };
          if (include.has("documents")) {
            documents = {
              ...documentStats,
              protocolCount: 0,
              amendmentCount: 0,
              unavailable: true,
            };
          }
        }
      }

      let telemetryStats = {
        totalEvents: 0,
        eventsLast7Days: 0,
        aiInvolvedEvents: 0,
        aiUsageRate: 0,
        byEventType: {} as Record<string, number>,
        byAction: {} as Record<string, number>,
        byEntityType: {} as Record<string, number>,
        lastEventAt: null as Date | null,
        recent: [] as any[],
      };

      if (needsTelemetry) {
        try {
          const relatedEntityIds = [resolvedId, ...protocolRows.map((row) => String(row.id))];
          const trialEvents = await db
            .select({
              id: telemetryEvents.id,
              eventType: telemetryEvents.eventType,
              action: telemetryEvents.action,
              aiInvolved: telemetryEvents.aiInvolved,
              entityType: telemetryEvents.entityType,
              entityId: telemetryEvents.entityId,
              userId: telemetryEvents.userId,
              timestamp: telemetryEvents.timestamp,
            })
            .from(telemetryEvents)
            .where(
              relatedEntityIds.length > 1
                ? inArray(telemetryEvents.entityId, relatedEntityIds)
                : eq(telemetryEvents.entityId, resolvedId)
            )
            .orderBy(desc(telemetryEvents.timestamp))
            .limit(250);

          const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const last7Days = trialEvents.filter((event) => {
            const ts = event.timestamp ? new Date(event.timestamp).getTime() : 0;
            return ts >= since;
          });
          const aiEvents = trialEvents.filter((event) => !!event.aiInvolved);

          const byEventType = trialEvents.reduce<Record<string, number>>((acc, event) => {
            acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
            return acc;
          }, {});
          const byAction = trialEvents.reduce<Record<string, number>>((acc, event) => {
            acc[event.action] = (acc[event.action] ?? 0) + 1;
            return acc;
          }, {});
          const byEntityType = trialEvents.reduce<Record<string, number>>((acc, event) => {
            const key = event.entityType ?? "unknown";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {});

          telemetryStats = {
            totalEvents: trialEvents.length,
            eventsLast7Days: last7Days.length,
            aiInvolvedEvents: aiEvents.length,
            aiUsageRate: trialEvents.length
              ? Number((aiEvents.length / trialEvents.length).toFixed(3))
              : 0,
            byEventType,
            byAction,
            byEntityType,
            lastEventAt: trialEvents[0]?.timestamp ?? null,
            recent: trialEvents.slice(0, 12),
          };
          if (include.has("telemetry")) {
            telemetry = telemetryStats;
          }
        } catch (error) {
          console.warn("[trials.getContext] Unable to build telemetry context", error);
          telemetryStats = {
            totalEvents: 0,
            eventsLast7Days: 0,
            aiInvolvedEvents: 0,
            aiUsageRate: 0,
            byEventType: {},
            byAction: {},
            byEntityType: {},
            lastEventAt: null,
            recent: [],
          };
          if (include.has("telemetry")) {
            telemetry = {
              ...telemetryStats,
              unavailable: true,
            };
          }
        }
      }

      let executionStats = {
        scaffolds: 0,
        phases: 0,
        visitLikePhases: 0,
        tasks: {
          total: 0,
          pending: 0,
          inProgress: 0,
          completed: 0,
          blocked: 0,
          unassigned: 0,
          dueToday: 0,
          dueSoon: 0,
          overdue: 0,
          progressPercent: 0,
        },
      };

      if (needsExecution) {
        try {
          const now = new Date();
          const todayIso = now.toISOString().slice(0, 10);
          const terminalStatuses = new Set(["done", "completed", "cancelled", "skipped"]);
          const blockedStatuses = new Set(["blocked", "waiting"]);
          const inProgressStatuses = new Set(["in_progress"]);

          const executionMapRows = await db
            .select({
              id: executionMaps.id,
              status: executionMaps.status,
              updatedAt: executionMaps.updatedAt,
            })
            .from(executionMaps)
            .where(eq(executionMaps.trialId, resolvedId))
            .orderBy(desc(executionMaps.updatedAt));

          const activeExecutionMap = executionMapRows.find((row) => row.status !== "archived") ?? null;
          const activeMapId = activeExecutionMap?.id ?? null;

          if (activeMapId) {
            const phaseRows = await db
              .select({
                id: mapPhases.id,
                name: mapPhases.name,
              })
              .from(mapPhases)
              .where(eq(mapPhases.mapId, activeMapId));

            const taskRows = await db
              .select({
                id: mapTasks.id,
                name: mapTasks.name,
                status: mapTasks.status,
                suggestedDate: mapTasks.suggestedDate,
                dueDate: mapTasks.dueDate,
                assignedUserId: mapTasks.assignedUserId,
              })
              .from(mapTasks)
              .where(eq(mapTasks.mapId, activeMapId));

            const normalizeStatus = (status: unknown) => String(status || "").toLowerCase();
            const totalTasks = taskRows.length;
            const completedTasks = taskRows.filter((task) => terminalStatuses.has(normalizeStatus(task.status))).length;
            const blockedTasks = taskRows.filter((task) => blockedStatuses.has(normalizeStatus(task.status))).length;
            const inProgressTasks = taskRows.filter((task) => inProgressStatuses.has(normalizeStatus(task.status))).length;
            const pendingTasks = taskRows.filter((task) => {
              const normalized = normalizeStatus(task.status);
              if (terminalStatuses.has(normalized)) return false;
              if (blockedStatuses.has(normalized)) return false;
              if (inProgressStatuses.has(normalized)) return false;
              return true;
            }).length;
            const unassignedTasks = taskRows.filter((task) => task.assignedUserId == null).length;
            const dueTodayTasks = taskRows.filter((task) => {
              const normalized = normalizeStatus(task.status);
              if (terminalStatuses.has(normalized)) return false;
              const candidateDate = task.dueDate || task.suggestedDate;
              if (!candidateDate) return false;
              return new Date(candidateDate).toISOString().slice(0, 10) === todayIso;
            }).length;
            const dueSoonTasks = taskRows.filter((task) => {
              const normalized = normalizeStatus(task.status);
              if (terminalStatuses.has(normalized)) return false;
              const candidateDate = task.dueDate || task.suggestedDate;
              if (!candidateDate) return false;
              const candidate = new Date(candidateDate);
              const deltaMs = candidate.getTime() - now.getTime();
              const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
              return deltaDays > 0 && deltaDays <= 3;
            }).length;
            const overdueTasks = taskRows.filter((task) => {
              const normalized = normalizeStatus(task.status);
              if (terminalStatuses.has(normalized)) return false;
              const candidateDate = task.dueDate || task.suggestedDate;
              if (!candidateDate) return false;
              return new Date(candidateDate) < now;
            }).length;
            const progressPercent = totalTasks
              ? Number(((completedTasks / totalTasks) * 100).toFixed(1))
              : 0;

            const visitLikePhases = phaseRows.filter((phase) =>
              /(visit|screening|follow-up|baseline|eos|week)/i.test(phase.name)
            );

            executionStats = {
              scaffolds: executionMapRows.length,
              phases: phaseRows.length,
              visitLikePhases: visitLikePhases.length,
              tasks: {
                total: totalTasks,
                pending: pendingTasks,
                inProgress: inProgressTasks,
                completed: completedTasks,
                blocked: blockedTasks,
                unassigned: unassignedTasks,
                dueToday: dueTodayTasks,
                dueSoon: dueSoonTasks,
                overdue: overdueTasks,
                progressPercent,
              },
            };
          } else {
            const scaffoldRows = await db
              .select({
                id: taskScaffolds.id,
                status: taskScaffolds.status,
              })
              .from(taskScaffolds)
              .where(eq(taskScaffolds.trialId, resolvedId));

            const scaffoldIds = scaffoldRows.map((row) => row.id);
            const phaseRows = scaffoldIds.length
              ? await db
                  .select({
                    id: phases.id,
                    scaffoldId: phases.scaffoldId,
                    name: phases.name,
                  })
                  .from(phases)
                  .where(inArray(phases.scaffoldId, scaffoldIds))
              : [];

            const phaseIds = phaseRows.map((row) => row.id);
            const taskRows = phaseIds.length
              ? await db
                  .select({
                    id: tasks.id,
                    phaseId: tasks.phaseId,
                    name: tasks.name,
                    suggestedDate: tasks.suggestedDate,
                    status: tasks.status,
                  })
                  .from(tasks)
                  .where(inArray(tasks.phaseId, phaseIds))
              : [];

            const pendingTasks = taskRows.filter((task) => task.status === "pending").length;
            const completedTasks = taskRows.filter((task) => task.status === "completed").length;
            const blockedTasks = taskRows.filter((task) => task.status === "blocked").length;
            const dueTodayTasks = taskRows.filter((task) => {
              if (!task.suggestedDate || task.status === "completed") return false;
              return new Date(task.suggestedDate).toISOString().slice(0, 10) === todayIso;
            }).length;
            const dueSoonTasks = taskRows.filter((task) => {
              if (!task.suggestedDate || task.status === "completed") return false;
              const candidate = new Date(task.suggestedDate);
              const deltaMs = candidate.getTime() - now.getTime();
              const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
              return deltaDays > 0 && deltaDays <= 3;
            }).length;
            const overdueTasks = taskRows.filter((task) => {
              if (!task.suggestedDate || task.status === "completed") return false;
              return new Date(task.suggestedDate) < now;
            }).length;
            const totalTasks = taskRows.length;
            const progressPercent = totalTasks
              ? Number(((completedTasks / totalTasks) * 100).toFixed(1))
              : 0;

            const visitLikePhases = phaseRows.filter((phase) =>
              /(visit|screening|follow-up|baseline|eos|week)/i.test(phase.name)
            );

            executionStats = {
              scaffolds: scaffoldRows.length,
              phases: phaseRows.length,
              visitLikePhases: visitLikePhases.length,
              tasks: {
                total: totalTasks,
                pending: pendingTasks,
                inProgress: 0,
                completed: completedTasks,
                blocked: blockedTasks,
                unassigned: 0,
                dueToday: dueTodayTasks,
                dueSoon: dueSoonTasks,
                overdue: overdueTasks,
                progressPercent,
              },
            };
          }

          if (include.has("execution")) {
            execution = executionStats;
          }
        } catch (error) {
          console.warn("[trials.getContext] Unable to build execution context", error);
          executionStats = {
            scaffolds: 0,
            phases: 0,
            visitLikePhases: 0,
            tasks: {
              total: 0,
              pending: 0,
              inProgress: 0,
              completed: 0,
              blocked: 0,
              unassigned: 0,
              dueToday: 0,
              dueSoon: 0,
              overdue: 0,
              progressPercent: 0,
            },
          };
          if (include.has("execution")) {
            execution = {
              ...executionStats,
              unavailable: true,
            };
          }
        }
      }

      if (include.has("suggestions") || include.has("insights")) {
        const draftSuggestions: Array<{
          id: string;
          category: "documents" | "execution" | "timeline" | "readiness" | "telemetry";
          priority: "high" | "medium" | "low";
          title: string;
          description: string;
          actionLabel: string;
          actionTarget: "overview" | "document-hub" | "study-setup-wizard" | "assistant";
          confidence: number;
        }> = [];

        if (documentStats.total === 0) {
          draftSuggestions.push({
            id: "upload_protocol",
            category: "documents",
            priority: "high",
            title: "Protocol missing in Document Hub",
            description: "Upload the protocol to enable retrieval, extraction traceability, and AI context.",
            actionLabel: "Open Document Hub",
            actionTarget: "document-hub",
            confidence: 0.99,
          });
        } else if (documentStats.processing > 0) {
          draftSuggestions.push({
            id: "wait_for_indexing",
            category: "documents",
            priority: "high",
            title: `${documentStats.processing} document(s) still indexing`,
            description: "Themison AI will provide stronger guidance after indexing finishes.",
            actionLabel: "Review Documents",
            actionTarget: "document-hub",
            confidence: 0.95,
          });
        }

        const protocolDocCount = documentStats.categories["protocol"] ?? 0;
        if (documentStats.total > 0 && protocolDocCount === 0) {
          draftSuggestions.push({
            id: "missing_protocol_category",
            category: "documents",
            priority: "high",
            title: "No protocol document categorized",
            description: "Tag at least one document as Protocol so task generation and citations stay traceable.",
            actionLabel: "Review Document Categories",
            actionTarget: "document-hub",
            confidence: 0.93,
          });
        }

        if (documentStats.currentProtocol && !documentStats.latestProtocolIndexed) {
          draftSuggestions.push({
            id: "current_protocol_not_indexed",
            category: "documents",
            priority: "high",
            title: "Current protocol is not indexed yet",
            description: "Wait for indexing or retry processing to ensure complete AI retrieval and citations.",
            actionLabel: "Open Document Hub",
            actionTarget: "document-hub",
            confidence: 0.94,
          });
        }

        if (executionStats.tasks.total === 0 && documentStats.total > 0) {
          draftSuggestions.push({
            id: "generate_study_setup",
            category: "execution",
            priority: "high",
            title: "No execution plan generated yet",
            description: "Run Study Setup Agent to convert protocol sections into actionable tasks.",
            actionLabel: "Open Study Setup Agent",
            actionTarget: "study-setup-wizard",
            confidence: 0.97,
          });
        }

        if (!trial.startDate || !trial.endDate) {
          draftSuggestions.push({
            id: "set_trial_timeline",
            category: "timeline",
            priority: "medium",
            title: "Timeline is incomplete",
            description: "Set both start and end dates to activate schedule-based planning and alerts.",
            actionLabel: "Set Dates in Overview",
            actionTarget: "overview",
            confidence: 0.92,
          });
        }

        if (trial.startDate && trial.endDate) {
          const startMs = new Date(trial.startDate).getTime();
          const endMs = new Date(trial.endDate).getTime();
          if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
            draftSuggestions.push({
              id: "timeline_invalid_range",
              category: "timeline",
              priority: "high",
              title: "Timeline date range is invalid",
              description: "End date is earlier than start date. Correct timeline dates to avoid schedule errors.",
              actionLabel: "Fix Dates in Overview",
              actionTarget: "overview",
              confidence: 0.98,
            });
          }
        }

        if ((trial.status || "not-started") === "not-started" && executionStats.tasks.total > 0) {
          draftSuggestions.push({
            id: "activate_trial",
            category: "readiness",
            priority: "medium",
            title: "Trial is still not started",
            description: "Activate when onboarding and core setup are complete to begin active tracking.",
            actionLabel: "Review Trial Status",
            actionTarget: "overview",
            confidence: 0.82,
          });
        }

        if (executionStats.tasks.blocked > 0) {
          draftSuggestions.push({
            id: "blocked_tasks",
            category: "execution",
            priority: "high",
            title: `${executionStats.tasks.blocked} blocked task(s) detected`,
            description: "Resolve blockers first to protect visit timelines and downstream dependencies.",
            actionLabel: "Open Study Setup Agent",
            actionTarget: "study-setup-wizard",
            confidence: 0.88,
          });
        }

        if (executionStats.tasks.overdue > 0) {
          draftSuggestions.push({
            id: "overdue_tasks",
            category: "execution",
            priority: "high",
            title: `${executionStats.tasks.overdue} overdue task(s)`,
            description: "Overdue tasks may impact near-term visits. Review and re-sequence immediately.",
            actionLabel: "Open Study Setup Agent",
            actionTarget: "study-setup-wizard",
            confidence: 0.91,
          });
        }

        if (executionStats.tasks.unassigned > 0) {
          draftSuggestions.push({
            id: "unassigned_tasks",
            category: "execution",
            priority: "medium",
            title: `${executionStats.tasks.unassigned} task(s) are unassigned`,
            description: "Assign owners to improve execution accountability and reduce delays.",
            actionLabel: "Open Study Setup Agent",
            actionTarget: "study-setup-wizard",
            confidence: 0.84,
          });
        }

        if (executionStats.tasks.dueToday > 0) {
          draftSuggestions.push({
            id: "high_due_today_load",
            category: "execution",
            priority: executionStats.tasks.dueToday >= 5 ? "high" : "medium",
            title: `${executionStats.tasks.dueToday} task(s) due today`,
            description:
              executionStats.tasks.dueToday >= 5
                ? "Today’s workload is high. Prioritize critical-path items and confirm owners now."
                : "Review today’s due tasks and confirm ownership to protect protocol timelines.",
            actionLabel: "Open Study Setup Agent",
            actionTarget: "study-setup-wizard",
            confidence: 0.8,
          });
        }

        if (executionStats.tasks.dueSoon > 0) {
          draftSuggestions.push({
            id: "due_soon_tasks",
            category: "execution",
            priority: "medium",
            title: `${executionStats.tasks.dueSoon} task(s) due within 72 hours`,
            description:
              "Near-term task deadlines are approaching. Sequence work now to avoid overdue spillover.",
            actionLabel: "Open Study Setup Agent",
            actionTarget: "study-setup-wizard",
            confidence: 0.83,
          });
        }

        if (telemetryStats.eventsLast7Days === 0) {
          const isActiveLike =
            (trial.status || "not-started") === "active" ||
            (trial.status || "not-started") === "recruiting";
          draftSuggestions.push({
            id: "low_recent_activity",
            category: "telemetry",
            priority: isActiveLike ? "medium" : "low",
            title: isActiveLike
              ? "No recent activity detected on an active trial"
              : "No recent operational activity detected",
            description: isActiveLike
              ? "Log current trial activity to keep risk detection and signals current."
              : "As the team uses tasks and documents, Themison AI recommendations become more precise.",
            actionLabel: "Open Themison AI",
            actionTarget: "assistant",
            confidence: 0.76,
          });
        }

        if (telemetryStats.totalEvents >= 10 && telemetryStats.aiUsageRate < 0.08) {
          draftSuggestions.push({
            id: "low_ai_utilization",
            category: "telemetry",
            priority: "low",
            title: "Low AI utilization in recent workflow",
            description: "Use Themison AI for task clarifications and protocol Q&A to improve decision speed and consistency.",
            actionLabel: "Ask Themison AI",
            actionTarget: "assistant",
            confidence: 0.67,
          });
        }

        const priorityOrder = { high: 0, medium: 1, low: 2 } as const;
        const rankedSuggestions = draftSuggestions.sort(
          (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.confidence - a.confidence
        );
        const normalizedPageContext = String(input.pageContext || "").toLowerCase();
        const pageCategoryFilters: Record<string, Array<"documents" | "execution" | "timeline" | "readiness" | "telemetry">> = {
          // Overview is intentionally broad.
          overview: ["documents", "execution", "timeline", "readiness", "telemetry"],
          // Document Hub should only surface document-relevant signals.
          "document-hub": ["documents"],
          // Setup view should focus on execution readiness.
          "study-setup-wizard": ["execution", "readiness", "documents"],
        };
        const allowedCategories = pageCategoryFilters[normalizedPageContext];
        suggestions = (allowedCategories
          ? rankedSuggestions.filter((signal) => allowedCategories.includes(signal.category))
          : rankedSuggestions).slice(0, 12);

        const readinessParts = [
          documentStats.total > 0,
          documentStats.indexed > 0,
          executionStats.tasks.total > 0,
          Boolean(trial.startDate && trial.endDate),
          (trial.status || "not-started") !== "not-started",
        ];
        const readinessScore = Math.round(
          (readinessParts.filter(Boolean).length / readinessParts.length) * 100
        );
        const aiCoverageScore =
          documentStats.active > 0
            ? Math.round((documentStats.indexed / documentStats.active) * 100)
            : 0;

        insights = {
          readinessScore,
          aiCoverageScore,
          blockedTaskRisk: executionStats.tasks.blocked > 0 ? "high" : "low",
          pendingTaskLoad: executionStats.tasks.pending,
          dueTodayTasks: executionStats.tasks.dueToday,
          dueSoonTasks: executionStats.tasks.dueSoon,
          totalSignals: suggestions.length,
        };
      }

      if (input.emitTelemetry) {
        await logTelemetryEvent({
          eventType: "trial_context_viewed",
          action: "viewed",
          userId: ctx.user ? String(ctx.user.id) : null,
          entityType: "trial",
          entityId: resolvedId,
          payload: {
            pageContext: input.pageContext ?? null,
            include: Array.from(include),
            suggestionCount: Array.isArray(suggestions) ? suggestions.length : 0,
            documentTotal: documentStats.total,
            executionTaskTotal: executionStats.tasks.total,
            demoMode: mode,
          },
        });
      }

      return {
        trial: include.has("trial") ? serializeTrial(trial) : undefined,
        documents,
        telemetry,
        execution,
        suggestions: include.has("suggestions") ? suggestions ?? [] : undefined,
        insights:
          include.has("insights")
            ? insights ?? {
                readinessScore: 0,
                aiCoverageScore: 0,
                blockedTaskRisk: "low",
                pendingTaskLoad: 0,
                dueTodayTasks: 0,
                dueSoonTasks: 0,
                totalSignals: 0,
              }
            : undefined,
        pageContext: input.pageContext ?? null,
        generatedAt: new Date().toISOString(),
        contextVersion: "v2",
      };
    }),

  // List all trials
  list: publicProcedure
    .input(z.object({
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input?.demoMode ?? "sample") as DemoMode;
      const prefixed = await db
        .select()
        .from(trials)
        .where(like(trials.id, `${mode}:%`))
        .orderBy(trials.createdAt);

      if (prefixed.length > 0) {
        return prefixed.map(serializeTrial);
      }
      if (mode === "building") {
        return [];
      }

      const legacy = await db
        .select()
        .from(trials)
        .where(notLike(trials.id, "%:%"))
        .orderBy(trials.createdAt);

      return legacy.map(serializeTrial);
    }),

  // Create a new trial
  create: protectedProcedure
    .input(z.object({
      id: z.string(),
      title: z.string(),
      protocolNumber: z.string().optional(),
      investigationalProduct: z.string().optional(),
      indication: z.string().optional(),
      nctNumber: z.string().optional(),
      currentVersion: z.string().optional(),
      amendmentVersion: z.string().optional(),
      releaseDate: z.string().optional(),
      sampleSize: z.string().optional(),
      numberOfSites: z.string().optional(),
      studyDuration: z.string().optional(),
      studyDesignType: z.string().optional(),
      primaryObjective: z.string().optional(),
      primaryEndpoint: z.string().optional(),
      description: z.string().optional(),
      phase: z.string().optional(),
      status: z.enum(["not-started", "active", "recruiting", "on-hold", "completed", "terminated"]).default("not-started"),
      sponsor: z.string().optional(),
      location: z.string().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      principalInvestigator: z.string().optional(),
      enrolledPatients: z.number().default(0),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().default(0),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { demoMode, ...trialInput } = input;
      const mode = (demoMode ?? "building") as DemoMode;
      const clampId = (value: string, max: number) => {
        const normalized = value
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/(^-|-$)+/g, "");
        if (!normalized) return "trial";
        if (normalized.length <= max) return normalized;

        // Preserve the random suffix when possible (e.g. slug-abc12)
        const suffixMatch = normalized.match(/-([a-z0-9]{4,8})$/);
        if (suffixMatch) {
          const suffix = suffixMatch[1];
          const baseBudget = Math.max(3, max - suffix.length - 1);
          const base = normalized.slice(0, baseBudget).replace(/-+$/g, "") || "trial";
          return `${base}-${suffix}`;
        }

        return normalized.slice(0, max).replace(/-+$/g, "") || "trial";
      };
      // Keep a conservative ID budget for environments where the column is still narrower.
      const safeBaseId = clampId(input.id, 22);
      const demoId = toDemoId(mode, safeBaseId);
      const clamp = (value: string | undefined, max: number) => {
        if (!value) return value;
        return value.length > max ? value.slice(0, max) : value;
      };
      const clampRequired = (value: string, max: number) => {
        return value.length > max ? value.slice(0, max) : value;
      };

      const insertData = {
        id: demoId,
        title: clampRequired(trialInput.title, 500),
        protocolNumber: clamp(trialInput.protocolNumber, 100),
        investigationalProduct: clamp(trialInput.investigationalProduct, 255),
        indication: clamp(trialInput.indication, 255),
        nctNumber: clamp(trialInput.nctNumber, 50),
        currentVersion: clamp(trialInput.currentVersion, 50),
        amendmentVersion: clamp(trialInput.amendmentVersion, 50),
        releaseDate: clamp(trialInput.releaseDate, 50),
        sampleSize: clamp(trialInput.sampleSize, 50),
        numberOfSites: clamp(trialInput.numberOfSites, 50),
        studyDuration: clamp(trialInput.studyDuration, 100),
        studyDesignType: clamp(trialInput.studyDesignType, 255),
        primaryObjective: trialInput.primaryObjective,
        primaryEndpoint: trialInput.primaryEndpoint,
        description: trialInput.description,
        phase: clamp(trialInput.phase, 50),
        status: trialInput.status,
        sponsor: clamp(trialInput.sponsor, 255),
        location: clamp(trialInput.location, 255),
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        principalInvestigator: clamp(trialInput.principalInvestigator, 255),
        enrolledPatients: trialInput.enrolledPatients,
        targetPatients: trialInput.targetPatients,
        completionPercentage: trialInput.completionPercentage,
        createdBy: ctx.user.id,
      };

      let didInsert = false;
      const mutableInsertData: Record<string, unknown> = { ...insertData };
      const removedColumns: string[] = [];
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          await db.insert(trials).values(mutableInsertData as any);
          didInsert = true;
          break;
        } catch (error) {
          const { rawMessage, code, sqlState } = extractDbErrorDetails(error);
          const unknownColumnMatch = rawMessage.match(/Unknown column '([^']+)'/i);
          if (unknownColumnMatch) {
            const column = unknownColumnMatch[1];
            if (column in mutableInsertData) {
              delete mutableInsertData[column];
              removedColumns.push(column);
              console.warn(`[trials.create] Retrying without missing column '${column}'`);
              continue;
            }
            throw new Error(
              `Database schema mismatch. Missing column '${column}'. Please run migrations and retry.`
            );
          }

          const isStatusEnumMismatch =
            /Data truncated for column 'status'/i.test(rawMessage) ||
            (/column 'status'/i.test(rawMessage) && /Incorrect/i.test(rawMessage)) ||
            code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
            code === "WARN_DATA_TRUNCATED";
          if (isStatusEnumMismatch) {
            if ("status" in mutableInsertData) {
              delete mutableInsertData.status;
              removedColumns.push("status");
              console.warn("[trials.create] Retrying without status due enum mismatch");
              continue;
            }
            throw new Error("Database schema is outdated for trial status. Run migrations and restart the server.");
          }

          const dataTooLongMatch = rawMessage.match(/Data too long for column '([^']+)'/i);
          if (dataTooLongMatch) {
            const column = dataTooLongMatch[1];
            if (column === "id" && typeof mutableInsertData.id === "string") {
              const currentId = mutableInsertData.id;
              const colonIndex = currentId.indexOf(":");
              const prefix = colonIndex >= 0 ? currentId.slice(0, colonIndex + 1) : "";
              const body = colonIndex >= 0 ? currentId.slice(colonIndex + 1) : currentId;
              if (body.length > 8) {
                const nextBody = body.slice(0, Math.max(8, body.length - 4)).replace(/-+$/g, "");
                mutableInsertData.id = `${prefix}${nextBody || "trial"}`;
                console.warn(`[trials.create] Retrying with shorter id '${mutableInsertData.id}'`);
                continue;
              }
            }
            throw new Error(`Field '${column}' is too long. Please shorten it and try again.`);
          }
          if (/Duplicate entry/i.test(rawMessage) || code === "ER_DUP_ENTRY") {
            throw new Error("A similar trial already exists. Please try creating it again.");
          }
          console.error("[trials.create] Insert failed", {
            code,
            sqlState,
            rawMessage,
            payload: mutableInsertData,
          });
          throw new Error("Could not create trial. Please review the entered values and try again.");
        }
      }

      if (!didInsert) {
        throw new Error("Could not create trial after compatibility retries.");
      }
      const createdTrialId = String(mutableInsertData.id ?? demoId);
      if (removedColumns.length > 0) {
        console.warn(
          `[trials.create] Created trial with compatibility mode. Missing DB columns skipped: ${removedColumns.join(", ")}`
        );
      }

      await logTelemetryEvent({
        eventType: "trial_created",
        action: "created",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: createdTrialId,
        payload: {
          title: trialInput.title,
          demoMode: mode,
        },
      });

      const [createdTrial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, createdTrialId))
        .limit(1);

      return createdTrial
        ? serializeTrial(createdTrial)
        : serializeTrial({ id: createdTrialId } as { id: string });
    }),

  // Update trial fields
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
      title: z.string().optional(),
      protocolNumber: z.string().optional(),
      investigationalProduct: z.string().optional(),
      indication: z.string().optional(),
      nctNumber: z.string().optional(),
      currentVersion: z.string().optional(),
      amendmentVersion: z.string().optional(),
      releaseDate: z.string().optional(),
      sampleSize: z.string().optional(),
      numberOfSites: z.string().optional(),
      studyDuration: z.string().optional(),
      studyDesignType: z.string().optional(),
      primaryObjective: z.string().optional(),
      primaryEndpoint: z.string().optional(),
      description: z.string().optional(),
      phase: z.string().optional(),
      status: z.enum(["not-started", "active", "recruiting", "on-hold", "completed", "terminated"]).optional(),
      sponsor: z.string().optional(),
      location: z.string().optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      principalInvestigator: z.string().optional(),
      enrolledPatients: z.number().optional(),
      targetPatients: z.number().optional(),
      completionPercentage: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { id, demoMode, ...updates } = input;
      const mode = (demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, id, mode !== "building");
      
      // Convert date strings to Date objects if provided
      const processedUpdates: any = {};
      const clamp = (value: string | undefined, max: number) => {
        if (!value) return value;
        return value.length > max ? value.slice(0, max) : value;
      };
      if (updates.title !== undefined) processedUpdates.title = clamp(updates.title, 500);
      if (updates.protocolNumber !== undefined) processedUpdates.protocolNumber = clamp(updates.protocolNumber, 100);
      if (updates.investigationalProduct !== undefined) processedUpdates.investigationalProduct = clamp(updates.investigationalProduct, 255);
      if (updates.indication !== undefined) processedUpdates.indication = clamp(updates.indication, 255);
      if (updates.nctNumber !== undefined) processedUpdates.nctNumber = clamp(updates.nctNumber, 50);
      if (updates.currentVersion !== undefined) processedUpdates.currentVersion = clamp(updates.currentVersion, 50);
      if (updates.amendmentVersion !== undefined) processedUpdates.amendmentVersion = clamp(updates.amendmentVersion, 50);
      if (updates.releaseDate !== undefined) processedUpdates.releaseDate = clamp(updates.releaseDate, 50);
      if (updates.sampleSize !== undefined) processedUpdates.sampleSize = clamp(updates.sampleSize, 50);
      if (updates.numberOfSites !== undefined) processedUpdates.numberOfSites = clamp(updates.numberOfSites, 50);
      if (updates.studyDuration !== undefined) processedUpdates.studyDuration = clamp(updates.studyDuration, 100);
      if (updates.studyDesignType !== undefined) processedUpdates.studyDesignType = clamp(updates.studyDesignType, 255);
      if (updates.primaryObjective !== undefined) processedUpdates.primaryObjective = updates.primaryObjective;
      if (updates.primaryEndpoint !== undefined) processedUpdates.primaryEndpoint = updates.primaryEndpoint;
      if (updates.description !== undefined) processedUpdates.description = updates.description;
      if (updates.phase !== undefined) processedUpdates.phase = clamp(updates.phase, 50);
      if (updates.status !== undefined) processedUpdates.status = updates.status;
      if (updates.sponsor !== undefined) processedUpdates.sponsor = clamp(updates.sponsor, 255);
      if (updates.location !== undefined) processedUpdates.location = clamp(updates.location, 255);
      if (updates.principalInvestigator !== undefined) processedUpdates.principalInvestigator = clamp(updates.principalInvestigator, 255);
      if (updates.enrolledPatients !== undefined) processedUpdates.enrolledPatients = updates.enrolledPatients;
      if (updates.targetPatients !== undefined) processedUpdates.targetPatients = updates.targetPatients;
      if (updates.completionPercentage !== undefined) processedUpdates.completionPercentage = updates.completionPercentage;
      if (updates.startDate) {
        processedUpdates.startDate = new Date(updates.startDate);
      }
      if (updates.endDate) {
        processedUpdates.endDate = new Date(updates.endDate);
      }

      const mutableUpdates: Record<string, unknown> = { ...processedUpdates };
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          if (Object.keys(mutableUpdates).length > 0) {
            await db
              .update(trials)
              .set(mutableUpdates as any)
              .where(eq(trials.id, resolvedId));
          }
          break;
        } catch (error) {
          const { rawMessage, code, sqlState } = extractDbErrorDetails(error);
          const unknownColumnMatch = rawMessage.match(/Unknown column '([^']+)'/i);
          if (unknownColumnMatch) {
            const column = unknownColumnMatch[1];
            if (column in mutableUpdates) {
              delete mutableUpdates[column];
              console.warn(`[trials.update] Retrying without missing column '${column}'`);
              continue;
            }
            throw new Error(
              `Database schema mismatch. Missing column '${column}'. Please run migrations and retry.`
            );
          }
          const isStatusEnumMismatch =
            /Data truncated for column 'status'/i.test(rawMessage) ||
            (/column 'status'/i.test(rawMessage) && /Incorrect/i.test(rawMessage)) ||
            code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" ||
            code === "WARN_DATA_TRUNCATED";
          if (isStatusEnumMismatch) {
            if ("status" in mutableUpdates) {
              delete mutableUpdates.status;
              console.warn("[trials.update] Retrying without status due enum mismatch");
              continue;
            }
            throw new Error("Database schema is outdated for trial status. Run migrations and restart the server.");
          }
          const dataTooLongMatch = rawMessage.match(/Data too long for column '([^']+)'/i);
          if (dataTooLongMatch) {
            const column = dataTooLongMatch[1];
            throw new Error(`Field '${column}' is too long. Please shorten it and try again.`);
          }
          console.error("[trials.update] Update failed", {
            code,
            sqlState,
            rawMessage,
            payload: mutableUpdates,
          });
          throw new Error("Could not update trial. Please review the entered values and try again.");
        }
      }

      // Return updated trial
      const [updatedTrial] = await db
        .select()
        .from(trials)
        .where(eq(trials.id, resolvedId))
        .limit(1);

      await logTelemetryEvent({
        eventType: "trial_edited",
        action: "edited",
        entityType: "trial",
        entityId: resolvedId,
        payload: {
          updates,
          demoMode: mode,
        },
      });

      return updatedTrial ? serializeTrial(updatedTrial) : null;
    }),

  // Delete a trial
  delete: protectedProcedure
    .input(z.object({
      id: z.string(),
      demoMode: z.enum(["sample", "full", "building"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const resolvedId = await resolveTrialId(db, mode, input.id, mode !== "building");

      const [existingTrial] = await db
        .select({ id: trials.id, title: trials.title })
        .from(trials)
        .where(eq(trials.id, resolvedId))
        .limit(1);

      if (!existingTrial) {
        return { success: true };
      }

      const protocolRows = await db
        .select({ id: protocols.id })
        .from(protocols)
        .where(eq(protocols.trialId, resolvedId));
      const protocolIds = protocolRows.map((row) => row.id);

      const scaffoldRows = await db
        .select({ id: taskScaffolds.id })
        .from(taskScaffolds)
        .where(eq(taskScaffolds.trialId, resolvedId));
      const scaffoldIds = scaffoldRows.map((row) => row.id);

      const phaseRows = scaffoldIds.length
        ? await db
            .select({ id: phases.id })
            .from(phases)
            .where(inArray(phases.scaffoldId, scaffoldIds))
        : [];
      const phaseIds = phaseRows.map((row) => row.id);

      const taskRows = phaseIds.length
        ? await db
            .select({ id: tasks.id })
            .from(tasks)
            .where(inArray(tasks.phaseId, phaseIds))
        : [];
      const taskIds = taskRows.map((row) => row.id);

      await db.transaction(async (tx) => {
        if (taskIds.length > 0) {
          await tx.delete(taskDependencies).where(inArray(taskDependencies.taskId, taskIds));
          await tx.delete(taskDependencies).where(inArray(taskDependencies.dependsOnTaskId, taskIds));
          await tx.delete(tasks).where(inArray(tasks.id, taskIds));
        }

        if (phaseIds.length > 0) {
          await tx.delete(phaseTransitions).where(inArray(phaseTransitions.fromPhaseId, phaseIds));
          await tx.delete(phaseTransitions).where(inArray(phaseTransitions.toPhaseId, phaseIds));
          await tx.delete(phases).where(inArray(phases.id, phaseIds));
        }

        if (scaffoldIds.length > 0) {
          await tx.delete(taskScaffolds).where(inArray(taskScaffolds.id, scaffoldIds));
        }

        if (protocolIds.length > 0) {
          await tx.delete(protocolSections).where(inArray(protocolSections.protocolId, protocolIds));
          await tx.delete(protocolChunks).where(inArray(protocolChunks.protocolId, protocolIds));
          await tx.delete(fileSearchDocuments).where(inArray(fileSearchDocuments.protocolId, protocolIds));
          await tx
            .delete(telemetryEvents)
            .where(inArray(telemetryEvents.entityId, protocolIds.map((id) => String(id))));
        }

        await tx.delete(protocols).where(eq(protocols.trialId, resolvedId));
        await tx.delete(fileSearchStores).where(eq(fileSearchStores.trialId, resolvedId));

        await tx.delete(aiFeatureSnapshots).where(eq(aiFeatureSnapshots.trialId, resolvedId));
        await tx.delete(aiAnalyticsRollups).where(eq(aiAnalyticsRollups.trialId, resolvedId));
        await tx.delete(aiTrainingExamples).where(eq(aiTrainingExamples.trialId, resolvedId));
        await tx.delete(knowledgeGraphNodes).where(eq(knowledgeGraphNodes.trialId, resolvedId));
        await tx.delete(knowledgeGraphEdges).where(eq(knowledgeGraphEdges.trialId, resolvedId));

        await tx.delete(telemetryEvents).where(eq(telemetryEvents.entityId, resolvedId));
        await tx.delete(trials).where(eq(trials.id, resolvedId));
      });

      await logTelemetryEvent({
        eventType: "trial_deleted",
        action: "deleted",
        userId: String(ctx.user.id),
        entityType: "trial",
        entityId: resolvedId,
        payload: { demoMode: mode, title: existingTrial.title },
      });

      return { success: true };
    }),
});
