import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import { mapRouterLocal } from "./mapRouter.local";
import { isConnectionError, checkBackendOnline, setBackendOffline } from "./_core/fallbackHelper";
import { getDb } from "./db";
import { resolveBeTrialIdForRead } from "./_core/coreBackendDocs";
import type { DemoMode } from "./_core/demoMode";
import type { Task, TaskCategory, TaskPriority, TaskStatus, ExecutionMap, TaskDependency, DependencyType } from "@shared/map";

const TASK_STATUSES = [
  "suggested",
  "confirmed",
  "todo",
  "in_progress",
  "blocked",
  "waiting",
  "done",
  "skipped",
  "cancelled",
] as const;

function getCategoryForPhaseId(phaseId: string): string {
  if (phaseId === "screening") return "consent";
  if (phaseId === "baseline") return "baseline";
  if (phaseId === "treatment") return "assessment";
  if (phaseId === "follow_up") return "follow_up";
  return "custom";
}

function getPhaseIdForTask(category: string | null | undefined): string {
  const cat = String(category || "").toLowerCase();
  if (["consent", "eligibility", "regulatory"].includes(cat)) {
    return "screening";
  }
  if (["vital_signs", "lab_sample", "baseline"].includes(cat)) {
    return "baseline";
  }
  if (["drug_administration", "imaging", "assessment"].includes(cat)) {
    return "treatment";
  }
  if (["follow_up", "questionnaire"].includes(cat)) {
    return "follow_up";
  }
  return "screening";
}

function mapBackendTaskToClient(backendTask: any, mapId: string): Task {
  return {
    id: backendTask.id,
    phaseId: backendTask.phase_id || getPhaseIdForTask(backendTask.category),
    mapId: mapId,
    name: backendTask.title || "",
    description: backendTask.description || "",
    category: (backendTask.category || "custom") as TaskCategory,
    priority: (backendTask.priority || "medium") as TaskPriority,
    status: (backendTask.status || "todo") as TaskStatus,
    blockedReason: backendTask.blocked_reason || null,
    blockedSince: backendTask.blocked_since ? new Date(backendTask.blocked_since).toISOString() : null,
    assignedRole: backendTask.assigned_role || null,
    assignedUserId: backendTask.assigned_to || null,
    suggestedAssignee: backendTask.suggested_assignee || backendTask.assigned_user?.full_name || null,
    suggestedDate: backendTask.suggested_date ? new Date(backendTask.suggested_date).toISOString() : null,
    dueDate: backendTask.due_date ? new Date(backendTask.due_date).toISOString() : null,
    estimatedDuration: null,
    startDate: null,
    completedDate: null,
    orderInPhase: backendTask.order_in_phase || 0,
    canvasX: null,
    canvasY: null,
    createdBy: "user",
    aiConfidence: null,
    conditionalNote: null,
    isCustom: true,
    tags: [],
    protocolRefs: [],
    createdAt: backendTask.created_at || new Date().toISOString(),
    updatedAt: backendTask.updated_at || new Date().toISOString(),
  };
}

function mapBackendDependencyToClient(backendDep: any): TaskDependency {
  return {
    id: backendDep.id,
    sourceTaskId: backendDep.source_task_id,
    targetTaskId: backendDep.target_task_id,
    dependencyType: (backendDep.dependency_type || "finish_to_start") as DependencyType,
    conditionLabel: backendDep.condition_label || null,
    isCrossPhase: backendDep.is_cross_phase || false,
    createdAt: backendDep.created_at || new Date().toISOString(),
  };
}

const mockPhases = (mapId: string) => [
  {
    id: "screening",
    mapId,
    name: "Screening Phase",
    phaseType: "screening" as const,
    displayOrder: 0,
    color: "#3b82f6",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "baseline",
    mapId,
    name: "Baseline Phase",
    phaseType: "baseline" as const,
    displayOrder: 1,
    color: "#10b981",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "treatment",
    mapId,
    name: "Treatment Phase",
    phaseType: "treatment_visit" as const,
    displayOrder: 2,
    color: "#f59e0b",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "follow_up",
    mapId,
    name: "Follow-up Phase",
    phaseType: "follow_up" as const,
    displayOrder: 3,
    color: "#8b5cf6",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockMap = (trialId: string): ExecutionMap => ({
  id: trialId,
  trialId,
  protocolId: 1,
  status: "active",
  version: 1,
  metadata: {},
  createdBy: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export const mapRouter = router({
  getByTrial: protectedProcedure
    .input(
      z.object({
        trialId: z.string(),
        includeArchived: z.boolean().optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const db = await getDb();
        if (!db) return null;
        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialId = await resolveBeTrialIdForRead(mode, input.trialId);
        if (!beTrialId) return null;

        const trial = await callBackend(`/api/trials/${beTrialId}`, { user: ctx.user });
        if (!trial) return null;
        return mockMap(input.trialId);
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for getByTrial.");
          const caller = mapRouterLocal.createCaller(opts.ctx);
          return caller.getByTrial(input);
        }
        console.error("Error in getByTrial proxy:", err);
        return null;
      }
    }),

  loadWorkspace: protectedProcedure
    .input(
      z.object({
        trialIds: z.array(z.string()).default([]),
        includeArchived: z.boolean().optional(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const backendTasks = await callBackend<any[]>(`/api/tasks`, { user: ctx.user });

        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrials = await callBackend<any[]>("/api/trials", {
          query: { demo_mode: mode },
          user: ctx.user,
        }).catch(() => []);

        const slugToUuid = new Map<string, string>();
        const uuidToSlug = new Map<string, string>();
        for (const t of (beTrials ?? [])) {
          const clientSlug = t.slug || t.id;
          const beUuid = t.id;
          slugToUuid.set(clientSlug, beUuid);
          uuidToSlug.set(beUuid, clientSlug);
        }

        const trialSlugs = input.trialIds.length > 0
          ? input.trialIds
          : Array.from(new Set(backendTasks.map(t => uuidToSlug.get(t.trial_id) || t.trial_id)));

        // Fetch dependencies for each trial
        const dependenciesByTrial = new Map<string, any[]>();
        for (const trialSlug of trialSlugs) {
          const trialUuid = slugToUuid.get(trialSlug) || trialSlug;
          try {
            const deps = await callBackend<any[]>(`/api/task-dependencies`, {
              query: { trial_id: trialUuid },
              user: ctx.user,
            });
            dependenciesByTrial.set(trialUuid, deps);
          } catch (depErr) {
            console.error(`Error fetching dependencies for trial ${trialSlug} (UUID ${trialUuid}):`, depErr);
            dependenciesByTrial.set(trialUuid, []);
          }
        }

        return trialSlugs.map(trialSlug => {
          const trialUuid = slugToUuid.get(trialSlug) || trialSlug;
          const filtered = backendTasks.filter(t => t.trial_id === trialUuid);
          const trialDeps = dependenciesByTrial.get(trialUuid) || [];
          return {
            map: mockMap(trialSlug),
            phases: mockPhases(trialSlug),
            tasks: filtered.map(t => mapBackendTaskToClient(t, trialSlug)),
            dependencies: trialDeps.map(mapBackendDependencyToClient),
            transitions: [],
            protocolMapSections: [],
          };
        });
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for loadWorkspace.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.loadWorkspace(input);
        }
        console.error("Error in loadWorkspace proxy:", err);
        return [];
      }
    }),

  load: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .query(async (opts) => {
      const { input, ctx } = opts;
      try {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        const mode = (input.demoMode ?? "sample") as DemoMode;
        const beTrialId = await resolveBeTrialIdForRead(mode, input.mapId);
        if (!beTrialId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Trial not found for mapId: ${input.mapId}`,
          });
        }

        const [backendTasks, backendDeps] = await Promise.all([
          callBackend<any[]>(`/api/tasks`, {
            query: { trial_id: beTrialId },
            user: ctx.user,
          }),
          callBackend<any[]>(`/api/task-dependencies`, {
            query: { trial_id: beTrialId },
            user: ctx.user,
          }).catch(err => {
            console.error("Failed to load task dependencies:", err);
            return [];
          }),
        ]);

        return {
          map: mockMap(input.mapId),
          phases: mockPhases(input.mapId),
          tasks: backendTasks.map(t => mapBackendTaskToClient(t, input.mapId)),
          dependencies: backendDeps.map(mapBackendDependencyToClient),
          transitions: [],
          protocolMapSections: [],
        };
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for load.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.load({ mapId: input.mapId });
        }
        console.error("Error in load proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to load execution map details from backend",
        });
      }
    }),

  createTask: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        phaseId: z.string(),
        task: z.object({
          name: z.string().min(1).max(500),
          description: z.string().optional(),
          category: z.string().default("custom"),
          priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
          status: z.enum(TASK_STATUSES).default("todo"),
          dueDate: z.string().datetime().nullable().optional(),
          assignedRole: z.any().optional(),
          assignedUserId: z.any().optional(),
          suggestedAssignee: z.any().optional(),
          suggestedDate: z.any().optional(),
          blockedReason: z.any().optional(),
          blockedSince: z.any().optional(),
          estimatedDuration: z.any().optional(),
          createdBy: z.any().optional(),
          protocolRefs: z.any().optional(),
          isCustom: z.any().optional(),
          tags: z.any().optional(),
          orderInPhase: z.any().optional(),
        }),
        demoMode: z.enum(["sample", "full", "building"]).optional(),
      })
    )
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      const trialId = input.mapId;
      const category = input.task.category || getCategoryForPhaseId(input.phaseId);

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const mode = (input.demoMode ?? "sample") as DemoMode;
      const beTrialId = await resolveBeTrialIdForRead(mode, trialId);
      if (!beTrialId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Trial not found for mapId: ${trialId}`,
        });
      }
      
      const body = {
        trial_id: beTrialId,
        title: input.task.name,
        description: input.task.description || "",
        status: input.task.status === "waiting" ? "todo" : input.task.status,
        priority: input.task.priority,
        due_date: input.task.dueDate ? input.task.dueDate.split("T")[0] : null,
        category: category,
        phase_id: input.phaseId,
        assigned_role: input.task.assignedRole || null,
        assigned_to: input.task.assignedUserId || null,
        blocked_reason: input.task.blockedReason || null,
        blocked_since: input.task.blockedSince ? input.task.blockedSince : null,
        order_in_phase: input.task.orderInPhase || 0,
        suggested_date: input.task.suggestedDate ? input.task.suggestedDate : null,
        suggested_assignee: input.task.suggestedAssignee || null,
      };

      try {
        const createdTask = await callBackend(`/api/tasks`, {
          method: "POST",
          body,
          user: ctx.user,
        });
        return mapBackendTaskToClient(createdTask, trialId);
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for createTask.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.createTask({
            mapId: input.mapId,
            phaseId: input.phaseId,
            task: input.task as any,
          });
        }
        console.error("Error in createTask proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create task in backend",
        });
      }
    }),

  updateTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        updates: z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          priority: z.enum(["critical", "high", "medium", "low"]).optional(),
          status: z.enum(TASK_STATUSES).optional(),
          dueDate: z.string().nullable().optional(),
          assignedRole: z.any().optional(),
          assignedUserId: z.any().optional(),
          suggestedAssignee: z.any().optional(),
          suggestedDate: z.any().optional(),
          blockedReason: z.any().optional(),
          blockedSince: z.any().optional(),
          estimatedDuration: z.any().optional(),
          createdBy: z.any().optional(),
          protocolRefs: z.any().optional(),
          isCustom: z.any().optional(),
          tags: z.any().optional(),
          phaseId: z.any().optional(),
          orderInPhase: z.any().optional(),
        }),
      })
    )
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      const updates = input.updates;
      const body: any = {};
      
      if (updates.name !== undefined) body.title = updates.name;
      if (updates.description !== undefined) body.description = updates.description;
      if (updates.status !== undefined) body.status = updates.status;
      if (updates.priority !== undefined) body.priority = updates.priority;
      if (updates.dueDate !== undefined) {
        body.due_date = updates.dueDate ? updates.dueDate.split("T")[0] : null;
      }
      if (updates.category !== undefined) body.category = updates.category;
      if (updates.assignedRole !== undefined) body.assigned_role = updates.assignedRole;
      if (updates.assignedUserId !== undefined) body.assigned_to = updates.assignedUserId;
      if (updates.blockedReason !== undefined) body.blocked_reason = updates.blockedReason;
      if (updates.blockedSince !== undefined) body.blocked_since = updates.blockedSince;
      if (updates.suggestedDate !== undefined) body.suggested_date = updates.suggestedDate;
      if (updates.suggestedAssignee !== undefined) body.suggested_assignee = updates.suggestedAssignee;
      if (updates.phaseId !== undefined) body.phase_id = updates.phaseId;
      if (updates.orderInPhase !== undefined) body.order_in_phase = updates.orderInPhase;

      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "PATCH",
          body,
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for updateTask.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.updateTask(input as any);
        }
        console.error("Error in updateTask proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update task in backend",
        });
      }
    }),

  removeTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "DELETE",
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for removeTask.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.removeTask(input);
        }
        console.error("Error in removeTask proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete task in backend",
        });
      }
    }),

  changeTaskStatus: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        status: z.enum(TASK_STATUSES),
        reason: z.string().optional(),
      })
    )
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "PATCH",
          body: { status: input.status },
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for changeTaskStatus.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.changeTaskStatus(input);
        }
        console.error("Error in changeTaskStatus proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update task status in backend",
        });
      }
    }),

  moveTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        phaseId: z.string(),
        orderInPhase: z.number().min(0),
      })
    )
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      const nextCategory = getCategoryForPhaseId(input.phaseId);
      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "PATCH",
          body: {
            phase_id: input.phaseId,
            order_in_phase: input.orderInPhase,
            category: nextCategory,
          },
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for moveTask.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.moveTask(input);
        }
        console.error("Error in moveTask proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to move task in backend",
        });
      }
    }),

  addDependency: protectedProcedure
    .input(
      z.object({
        mapId: z.string(),
        sourceTaskId: z.string(),
        targetTaskId: z.string(),
        dependencyType: z.string().default("finish_to_start"),
        conditionLabel: z.string().nullable().optional(),
        isCrossPhase: z.boolean().default(false),
      })
    )
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      try {
        const created = await callBackend(`/api/task-dependencies`, {
          method: "POST",
          body: {
            source_task_id: input.sourceTaskId,
            target_task_id: input.targetTaskId,
            dependency_type: input.dependencyType,
            condition_label: input.conditionLabel || null,
            is_cross_phase: input.isCrossPhase,
          },
          user: ctx.user,
        });
        return mapBackendDependencyToClient(created);
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for addDependency.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.addDependency(input as any);
        }
        console.error("Error in addDependency proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create task dependency in backend",
        });
      }
    }),

  removeDependency: protectedProcedure
    .input(
      z.object({
        dependencyId: z.string(),
      })
    )
    .mutation(async (opts) => {
      const { input, ctx } = opts;
      try {
        await callBackend(`/api/task-dependencies/${input.dependencyId}`, {
          method: "DELETE",
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        if (isConnectionError(err)) {
          setBackendOffline();
          console.warn("[mapRouter] Backend offline. Falling back to local database for removeDependency.");
          const caller = mapRouterLocal.createCaller(ctx);
          return caller.removeDependency(input);
        }
        console.error("Error in removeDependency proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete task dependency in backend",
        });
      }
    }),

  // --- Local Database-only operations wrapped in status check ---
  reorderTasks: protectedProcedure
    .input(z.object({ mapId: z.string(), phaseId: z.string(), orderedIds: z.array(z.string()).min(1) }))
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for reorderTasks.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.reorderTasks(opts.input);
    }),

  updatePhase: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for updatePhase.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.updatePhase(opts.input);
    }),

  removePhase: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for removePhase.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.removePhase(opts.input);
    }),

  reorderPhases: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for reorderPhases.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.reorderPhases(opts.input);
    }),

  importLegacyScaffold: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true, mapId: "mock-map-id" };
      console.warn("[mapRouter] Backend offline. Falling back to local database for importLegacyScaffold.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.importLegacyScaffold(opts.input);
    }),

  create: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for create.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.create(opts.input);
    }),

  update: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for update.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.update(opts.input);
    }),

  launch: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for launch.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.launch(opts.input);
    }),

  confirmSuggested: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true, updated: 0 };
      console.warn("[mapRouter] Backend offline. Falling back to local database for confirmSuggested.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.confirmSuggested(opts.input);
    }),

  archive: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for archive.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.archive(opts.input);
    }),

  createPhase: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for createPhase.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.createPhase(opts.input);
    }),

  addTransition: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for addTransition.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.addTransition(opts.input);
    }),

  updateTransition: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for updateTransition.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.updateTransition(opts.input);
    }),

  removeTransition: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for removeTransition.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.removeTransition(opts.input);
    }),

  logTelemetry: protectedProcedure
    .input(z.any())
    .mutation(async (opts) => {
      if (await checkBackendOnline()) return { success: true };
      console.warn("[mapRouter] Backend offline. Falling back to local database for logTelemetry.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.logTelemetry(opts.input);
    }),

  listTelemetry: protectedProcedure
    .input(z.any())
    .query(async (opts) => {
      if (await checkBackendOnline()) return [];
      console.warn("[mapRouter] Backend offline. Falling back to local database for listTelemetry.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.listTelemetry(opts.input);
    }),

  getTaskStatusDurations: protectedProcedure
    .input(z.any())
    .query(async (opts) => {
      if (await checkBackendOnline()) {
        return {
          rows: [],
          statusSeconds: {
            suggested: 0,
            confirmed: 0,
            todo: 0,
            in_progress: 0,
            blocked: 0,
            waiting: 0,
            done: 0,
            skipped: 0,
            cancelled: 0,
          },
        };
      }
      console.warn("[mapRouter] Backend offline. Falling back to local database for getTaskStatusDurations.");
      const caller = mapRouterLocal.createCaller(opts.ctx);
      return caller.getTaskStatusDurations(opts.input);
    }),
});
