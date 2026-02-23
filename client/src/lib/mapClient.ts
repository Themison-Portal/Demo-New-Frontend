import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../server/routers";
import type {
  DependencyType,
  MapStatus,
  PhaseType,
  Role,
  TaskCategory,
  TaskPriority,
  TaskStatus,
  TelemetryEventType,
} from "@/types/map";

const mapTrpcClient = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

export const mapApi = {
  getByTrial: (input: { trialId: string; includeArchived?: boolean }) =>
    mapTrpcClient.map.getByTrial.query(input),

  importLegacyScaffold: (input: {
    trialId: string;
    protocolId: number;
    mapId?: string;
    clearExisting?: boolean;
    demoMode?: "sample" | "full" | "building";
    trialStartDate?: string;
    trialEndDate?: string;
    assignmentMembers?: Array<{
      id: string | number;
      name?: string;
      role?: string;
      clinicalRole?: string;
    }>;
  }) => mapTrpcClient.map.importLegacyScaffold.mutate(input),

  loadMap: (mapId: string) => mapTrpcClient.map.load.query({ mapId }),

  createMap: (input: {
    trialId: string;
    protocolId: number;
    status?: MapStatus;
    version?: number;
    metadata?: Record<string, unknown>;
  }) => mapTrpcClient.map.create.mutate(input),

  updateMap: (input: {
    mapId: string;
    status?: MapStatus;
    version?: number;
    metadata?: Record<string, unknown>;
  }) => mapTrpcClient.map.update.mutate(input),

  launchMap: (mapId: string) => mapTrpcClient.map.launch.mutate({ mapId }),
  archiveMap: (mapId: string) => mapTrpcClient.map.archive.mutate({ mapId }),

  createPhase: (input: {
    mapId: string;
    name: string;
    phaseType?: PhaseType;
    color?: string;
    displayOrder?: number;
    estimatedDate?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    protocolRef?: Record<string, unknown> | null;
    canvasX?: number | null;
    canvasY?: number | null;
  }) => mapTrpcClient.map.createPhase.mutate(input),

  updatePhase: (input: {
    phaseId: string;
    updates: {
      name?: string;
      phaseType?: PhaseType;
      displayOrder?: number;
      color?: string;
      estimatedDate?: string | null;
      windowStart?: string | null;
      windowEnd?: string | null;
      protocolRef?: Record<string, unknown> | null;
      canvasX?: number | null;
      canvasY?: number | null;
    };
  }) => mapTrpcClient.map.updatePhase.mutate(input),

  removePhase: (phaseId: string) => mapTrpcClient.map.removePhase.mutate({ phaseId }),
  reorderPhases: (input: { mapId: string; orderedIds: string[] }) =>
    mapTrpcClient.map.reorderPhases.mutate(input),

  createTask: (input: {
    mapId: string;
    phaseId: string;
    task: {
      name: string;
      description?: string;
      category?: TaskCategory;
      priority?: TaskPriority;
      status?: TaskStatus;
      assignedRole?: Role | null;
      assignedUserId?: number | null;
      suggestedAssignee?: string | null;
      suggestedDate?: string | null;
      dueDate?: string | null;
      estimatedDuration?: number | null;
      canvasX?: number | null;
      canvasY?: number | null;
      createdBy?: "ai" | "user";
      aiConfidence?: number | null;
      conditionalNote?: string | null;
      isCustom?: boolean;
      tags?: string[];
      protocolRefs?: Array<Record<string, unknown>>;
    };
  }) => mapTrpcClient.map.createTask.mutate(input),

  updateTask: (input: { taskId: string; updates: Record<string, unknown> }) =>
    mapTrpcClient.map.updateTask.mutate(input),
  removeTask: (taskId: string) => mapTrpcClient.map.removeTask.mutate({ taskId }),
  moveTask: (input: { taskId: string; phaseId: string; orderInPhase: number }) =>
    mapTrpcClient.map.moveTask.mutate(input),
  reorderTasks: (input: { mapId: string; phaseId: string; orderedIds: string[] }) =>
    mapTrpcClient.map.reorderTasks.mutate(input),
  changeTaskStatus: (input: { taskId: string; status: TaskStatus; reason?: string }) =>
    mapTrpcClient.map.changeTaskStatus.mutate(input),

  addDependency: (input: {
    mapId: string;
    sourceTaskId: string;
    targetTaskId: string;
    dependencyType?: DependencyType;
    conditionLabel?: string;
  }) => mapTrpcClient.map.addDependency.mutate(input),
  removeDependency: (dependencyId: string) =>
    mapTrpcClient.map.removeDependency.mutate({ dependencyId }),

  addTransition: (input: {
    mapId: string;
    fromPhaseId: string;
    toPhaseId: string;
    conditionLabel?: string;
    isDefault?: boolean;
  }) => mapTrpcClient.map.addTransition.mutate(input),
  updateTransition: (input: {
    transitionId: string;
    updates: { conditionLabel?: string | null; isDefault?: boolean };
  }) => mapTrpcClient.map.updateTransition.mutate(input),
  removeTransition: (transitionId: string) =>
    mapTrpcClient.map.removeTransition.mutate({ transitionId }),

  logTelemetry: (input: {
    mapId: string;
    trialId: string;
    eventType: TelemetryEventType | string;
    targetId?: string;
    targetType?: "task" | "phase" | "dependency" | "map";
    payload?: Record<string, unknown>;
  }) => mapTrpcClient.map.logTelemetry.mutate(input),

  listTelemetry: (input: { mapId: string; eventTypes?: string[]; limit?: number }) =>
    mapTrpcClient.map.listTelemetry.query(input),
};
