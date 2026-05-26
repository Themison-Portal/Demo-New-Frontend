import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { callBackend } from "./_core/backendClient";
import type { Task, TaskCategory, TaskPriority, TaskStatus, ExecutionMap } from "@shared/map";

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
    phaseId: getPhaseIdForTask(backendTask.category),
    mapId: mapId,
    name: backendTask.title || "",
    description: backendTask.description || "",
    category: (backendTask.category || "custom") as TaskCategory,
    priority: (backendTask.priority || "medium") as TaskPriority,
    status: (backendTask.status || "todo") as TaskStatus,
    blockedReason: null,
    blockedSince: null,
    assignedRole: null,
    assignedUserId: null,
    suggestedAssignee: backendTask.assigned_user?.full_name || null,
    suggestedDate: null,
    dueDate: backendTask.due_date ? new Date(backendTask.due_date).toISOString() : null,
    estimatedDuration: null,
    startDate: null,
    completedDate: null,
    orderInPhase: 0,
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
    .query(async ({ input, ctx }) => {
      try {
        const trial = await callBackend(`/api/trials/${input.trialId}`, { user: ctx.user });
        if (!trial) return null;
        return mockMap(input.trialId);
      } catch (err) {
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
    .query(async ({ input, ctx }) => {
      try {
        const backendTasks = await callBackend<any[]>(`/api/tasks`, { user: ctx.user });
        const trialIds = input.trialIds.length > 0 ? input.trialIds : Array.from(new Set(backendTasks.map(t => t.trial_id)));

        return trialIds.map(trialId => {
          const filtered = backendTasks.filter(t => t.trial_id === trialId);
          return {
            map: mockMap(trialId),
            phases: mockPhases(trialId),
            tasks: filtered.map(t => mapBackendTaskToClient(t, trialId)),
            dependencies: [],
            transitions: [],
            protocolMapSections: [],
          };
        });
      } catch (err) {
        console.error("Error in loadWorkspace proxy:", err);
        return [];
      }
    }),

  load: protectedProcedure
    .input(z.object({ mapId: z.string() }))
    .query(async ({ input, ctx }) => {
      try {
        const backendTasks = await callBackend<any[]>(`/api/tasks`, {
          query: { trial_id: input.mapId },
          user: ctx.user,
        });

        return {
          map: mockMap(input.mapId),
          phases: mockPhases(input.mapId),
          tasks: backendTasks.map(t => mapBackendTaskToClient(t, input.mapId)),
          dependencies: [],
          transitions: [],
          protocolMapSections: [],
        };
      } catch (err) {
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
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const trialId = input.mapId;
      const category = input.task.category || getCategoryForPhaseId(input.phaseId);
      
      const body = {
        trial_id: trialId,
        title: input.task.name,
        description: input.task.description || "",
        status: input.task.status === "waiting" ? "todo" : input.task.status,
        priority: input.task.priority,
        due_date: input.task.dueDate ? input.task.dueDate.split("T")[0] : null,
        category: category,
      };

      try {
        const createdTask = await callBackend(`/api/tasks`, {
          method: "POST",
          body,
          user: ctx.user,
        });
        return mapBackendTaskToClient(createdTask, trialId);
      } catch (err) {
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
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
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

      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "PATCH",
          body,
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        console.error("Error in updateTask proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update task in backend",
        });
      }
    }),

  removeTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "DELETE",
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
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
    .mutation(async ({ input, ctx }) => {
      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "PATCH",
          body: { status: input.status },
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
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
    .mutation(async ({ input, ctx }) => {
      // Map phase move to category change
      const nextCategory = getCategoryForPhaseId(input.phaseId);
      try {
        await callBackend(`/api/tasks/${input.taskId}`, {
          method: "PATCH",
          body: { category: nextCategory },
          user: ctx.user,
        });
        return { success: true };
      } catch (err) {
        console.error("Error in moveTask proxy:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to move task in backend",
        });
      }
    }),

  reorderTasks: protectedProcedure
    .input(z.object({ mapId: z.string(), phaseId: z.string(), orderedIds: z.array(z.string()).min(1) }))
    .mutation(() => ({ success: true })),

  updatePhase: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  removePhase: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  reorderPhases: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  importLegacyScaffold: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true, mapId: "mock-map-id" })),

  create: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  update: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  launch: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  confirmSuggested: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true, updated: 0 })),

  archive: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  createPhase: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  addDependency: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  removeDependency: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  addTransition: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  updateTransition: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  removeTransition: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  logTelemetry: protectedProcedure
    .input(z.any())
    .mutation(() => ({ success: true })),

  listTelemetry: protectedProcedure
    .input(z.any())
    .query(() => []),

  getTaskStatusDurations: protectedProcedure
    .input(z.any())
    .query(() => ({
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
    })),
});
