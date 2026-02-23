import { useSyncExternalStore } from "react";
import { mapApi } from "@/lib/mapClient";
import { trackMapEvent } from "@/lib/mapTelemetry";
import type {
  DependencyType,
  ExecutionMap,
  MapViewType,
  Phase,
  PhaseTransition,
  ProtocolMapSection,
  Task,
  TaskDependency,
  TaskStatus,
  TelemetryEventType,
} from "@/types/map";
import { VALID_STATUS_TRANSITIONS } from "@/types/map";

interface MapFilters {
  protocolSectionId?: string;
  phaseId?: string;
  assigneeId?: number;
  statuses?: TaskStatus[];
  myTasksOnly: boolean;
}

type ChangeTaskStatusArgs = {
  taskId: string;
  newStatus: TaskStatus;
  reason?: string;
};

type MapStoreShape = {
  map: ExecutionMap | null;
  phases: Phase[];
  tasks: Task[];
  dependencies: TaskDependency[];
  transitions: PhaseTransition[];
  protocolMapSections: ProtocolMapSection[];
  activeView: MapViewType;
  filters: MapFilters;
  isLoading: boolean;
  error: string | null;
  loadMap: (mapId: string) => Promise<void>;
  setActiveView: (view: MapViewType) => void;
  setFilter: (filter: Partial<MapFilters>) => void;
  clearFilters: () => void;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  moveTask: (taskId: string, toPhaseId: string, newOrder: number) => Promise<void>;
  addTask: (phaseId: string, task: Partial<Task>) => Promise<Task>;
  removeTask: (taskId: string) => Promise<void>;
  changeTaskStatus: (taskId: string, newStatus: TaskStatus, reason?: string) => Promise<void>;
  updatePhase: (phaseId: string, updates: Partial<Phase>) => Promise<void>;
  addPhase: (phase: Partial<Phase>) => Promise<Phase>;
  removePhase: (phaseId: string) => Promise<void>;
  reorderPhases: (orderedIds: string[]) => Promise<void>;
  reorderTasks: (phaseId: string, orderedIds: string[]) => Promise<void>;
  addDependency: (dep: Partial<TaskDependency>) => Promise<TaskDependency>;
  removeDependency: (depId: string) => Promise<void>;
  addTransition: (transition: Partial<PhaseTransition>) => Promise<PhaseTransition>;
  removeTransition: (transitionId: string) => Promise<void>;
  updateTransition: (transitionId: string, updates: Partial<PhaseTransition>) => Promise<void>;
  launchMap: () => Promise<void>;
  archiveMap: () => Promise<void>;
  trackEvent: (
    eventType: TelemetryEventType,
    targetId?: string,
    targetType?: "task" | "phase" | "dependency" | "map",
    payload?: Record<string, unknown>
  ) => Promise<void>;
  getFilteredTasks: () => Task[];
  getTasksByPhase: () => Record<string, Task[]>;
  getTasksByStatus: () => Record<TaskStatus, Task[]>;
  getTaskDependencies: (taskId: string) => TaskDependency[];
  getPhaseTasks: (phaseId: string) => Task[];
  validateDependency: (sourceId: string, targetId: string) => boolean;
};

const listeners = new Set<() => void>();
let currentUserId: number | null = null;

const defaultFilters: MapFilters = {
  protocolSectionId: undefined,
  phaseId: undefined,
  assigneeId: undefined,
  statuses: undefined,
  myTasksOnly: false,
};

const mapStoreState: MapStoreShape = {
  map: null,
  phases: [],
  tasks: [],
  dependencies: [],
  transitions: [],
  protocolMapSections: [],
  activeView: "scaffold",
  filters: defaultFilters,
  isLoading: false,
  error: null,

  async loadMap(mapId) {
    mapStoreState.isLoading = true;
    mapStoreState.error = null;
    emit();
    try {
      const result = await mapApi.loadMap(mapId);
      mapStoreState.map = result.map as unknown as ExecutionMap;
      mapStoreState.phases = (result.phases ?? []) as unknown as Phase[];
      mapStoreState.tasks = (result.tasks ?? []) as unknown as Task[];
      mapStoreState.dependencies = (result.dependencies ?? []) as unknown as TaskDependency[];
      mapStoreState.transitions = (result.transitions ?? []) as unknown as PhaseTransition[];
      mapStoreState.protocolMapSections =
        (result.protocolMapSections ?? []) as unknown as ProtocolMapSection[];
    } catch (error) {
      mapStoreState.error = error instanceof Error ? error.message : "Failed to load map";
      throw error;
    } finally {
      mapStoreState.isLoading = false;
      emit();
    }
  },

  setActiveView(view) {
    const previousView = mapStoreState.activeView;
    if (previousView === view) return;
    mapStoreState.activeView = view;
    emit();
    void mapStoreState.trackEvent("view.switched", mapStoreState.map?.id, "map", {
      fromView: previousView,
      toView: view,
    });
  },

  setFilter(filter) {
    mapStoreState.filters = { ...mapStoreState.filters, ...filter };
    emit();
  },

  clearFilters() {
    mapStoreState.filters = { ...defaultFilters };
    emit();
  },

  async updateTask(taskId, updates) {
    const prevTasks = [...mapStoreState.tasks];
    const existing = mapStoreState.tasks.find((task) => task.id === taskId);
    if (!existing) throw new Error("Task not found");

    mapStoreState.tasks = mapStoreState.tasks.map((task) =>
      task.id === taskId ? { ...task, ...updates, updatedAt: new Date().toISOString() } : task
    );
    emit();

    try {
      await mapApi.updateTask({
        taskId,
        updates: updates as unknown as Record<string, unknown>,
      });
      await mapStoreState.trackEvent("task.modified", taskId, "task", {
        fieldsChanged: Object.keys(updates),
      });
    } catch (error) {
      mapStoreState.tasks = prevTasks;
      emit();
      throw error;
    }
  },

  async moveTask(taskId, toPhaseId, newOrder) {
    const prevTasks = [...mapStoreState.tasks];
    mapStoreState.tasks = mapStoreState.tasks.map((task) =>
      task.id === taskId ? { ...task, phaseId: toPhaseId, orderInPhase: newOrder } : task
    );
    emit();

    try {
      await mapApi.moveTask({ taskId, phaseId: toPhaseId, orderInPhase: newOrder });
      await mapStoreState.trackEvent("task.modified", taskId, "task", {
        toPhaseId,
        orderInPhase: newOrder,
      });
    } catch (error) {
      mapStoreState.tasks = prevTasks;
      emit();
      throw error;
    }
  },

  async addTask(phaseId, task) {
    if (!mapStoreState.map) throw new Error("No map loaded");
    const now = new Date().toISOString();
    const tempId = `temp-${Date.now()}`;
    const optimisticTask: Task = {
      id: tempId,
      phaseId,
      mapId: mapStoreState.map.id,
      name: task.name ?? "New task",
      description: task.description ?? null,
      category: task.category ?? "custom",
      priority: task.priority ?? "medium",
      status: task.status ?? (mapStoreState.map.status === "active" ? "todo" : "suggested"),
      blockedReason: null,
      blockedSince: null,
      assignedRole: task.assignedRole ?? null,
      assignedUserId: task.assignedUserId ?? null,
      suggestedAssignee: task.suggestedAssignee ?? null,
      suggestedDate: task.suggestedDate ?? null,
      dueDate: task.dueDate ?? null,
      estimatedDuration: task.estimatedDuration ?? null,
      startDate: task.startDate ?? null,
      completedDate: task.completedDate ?? null,
      orderInPhase: task.orderInPhase ?? mapStoreState.getPhaseTasks(phaseId).length,
      canvasX: task.canvasX ?? null,
      canvasY: task.canvasY ?? null,
      createdBy: task.createdBy ?? "user",
      aiConfidence: task.aiConfidence ?? null,
      conditionalNote: task.conditionalNote ?? null,
      isCustom: task.isCustom ?? true,
      tags: task.tags ?? [],
      protocolRefs: task.protocolRefs ?? [],
      createdAt: now,
      updatedAt: now,
    };

    mapStoreState.tasks = [...mapStoreState.tasks, optimisticTask];
    emit();

    try {
      const created = (await mapApi.createTask({
        mapId: mapStoreState.map.id,
        phaseId,
        task: {
          name: task.name ?? "New task",
          description: task.description ?? undefined,
          category: task.category ?? "custom",
          priority: task.priority ?? "medium",
          status: task.status ?? (mapStoreState.map.status === "active" ? "todo" : "suggested"),
          assignedRole: task.assignedRole ?? null,
          assignedUserId: task.assignedUserId ?? null,
          suggestedAssignee: task.suggestedAssignee ?? null,
          suggestedDate: task.suggestedDate ?? null,
          dueDate: task.dueDate ?? null,
          estimatedDuration: task.estimatedDuration ?? null,
          canvasX: task.canvasX ?? null,
          canvasY: task.canvasY ?? null,
          createdBy: task.createdBy ?? "user",
          aiConfidence: task.aiConfidence ?? null,
          conditionalNote: task.conditionalNote ?? null,
          isCustom: task.isCustom ?? true,
          tags: task.tags ?? [],
          protocolRefs: ((task.protocolRefs ?? []) as unknown) as Array<Record<string, unknown>>,
        },
      })) as unknown as Task;
      mapStoreState.tasks = mapStoreState.tasks.map((row) => (row.id === tempId ? created : row));
      emit();
      return created;
    } catch (error) {
      mapStoreState.tasks = mapStoreState.tasks.filter((row) => row.id !== tempId);
      emit();
      throw error;
    }
  },

  async removeTask(taskId) {
    const prevTasks = [...mapStoreState.tasks];
    const prevDeps = [...mapStoreState.dependencies];
    mapStoreState.tasks = mapStoreState.tasks.filter((task) => task.id !== taskId);
    mapStoreState.dependencies = mapStoreState.dependencies.filter(
      (dep) => dep.sourceTaskId !== taskId && dep.targetTaskId !== taskId
    );
    emit();
    try {
      await mapApi.removeTask(taskId);
      await mapStoreState.trackEvent("task.rejected", taskId, "task", { removed: true });
    } catch (error) {
      mapStoreState.tasks = prevTasks;
      mapStoreState.dependencies = prevDeps;
      emit();
      throw error;
    }
  },

  async changeTaskStatus(taskId, newStatus, reason) {
    const task = mapStoreState.tasks.find((row) => row.id === taskId);
    if (!task) throw new Error("Task not found");
    const allowed = VALID_STATUS_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid task status transition: ${task.status} -> ${newStatus}`);
    }
    if (newStatus === "blocked" && !reason?.trim()) {
      throw new Error("Blocked status requires a reason");
    }

    const prevTasks = [...mapStoreState.tasks];
    const now = new Date().toISOString();
    mapStoreState.tasks = mapStoreState.tasks.map((row) => {
      if (row.id !== taskId) return row;
      const next: Task = { ...row, status: newStatus, updatedAt: now };
      if (row.status === "todo" && newStatus === "in_progress" && !row.startDate) {
        next.startDate = now;
      }
      if (newStatus === "done") {
        next.completedDate = now;
      }
      if (newStatus === "blocked") {
        next.blockedReason = reason ?? "";
        next.blockedSince = now;
      }
      if (row.status === "blocked" && newStatus === "in_progress") {
        next.blockedReason = null;
        next.blockedSince = null;
      }
      return next;
    });
    emit();

    try {
      const payload: ChangeTaskStatusArgs = { taskId, newStatus, reason };
      await mapApi.changeTaskStatus({
        taskId: payload.taskId,
        status: payload.newStatus,
        reason: payload.reason,
      });
      await mapStoreState.trackEvent("kanban.card_moved", taskId, "task", {
        fromStatus: task.status,
        toStatus: newStatus,
      });
    } catch (error) {
      mapStoreState.tasks = prevTasks;
      emit();
      throw error;
    }
  },

  async updatePhase(phaseId, updates) {
    const prevPhases = [...mapStoreState.phases];
    mapStoreState.phases = mapStoreState.phases.map((phase) =>
      phase.id === phaseId ? { ...phase, ...updates, updatedAt: new Date().toISOString() } : phase
    );
    emit();
    try {
      await mapApi.updatePhase({
        phaseId,
        updates: updates as {
          name?: string;
          phaseType?: "screening" | "baseline" | "treatment_visit" | "follow_up" | "end_of_study" | "unscheduled" | "screen_fail" | "early_termination" | "custom";
          displayOrder?: number;
          color?: string;
          estimatedDate?: string | null;
          windowStart?: string | null;
          windowEnd?: string | null;
          protocolRef?: Record<string, unknown> | null;
          canvasX?: number | null;
          canvasY?: number | null;
        },
      });
      await mapStoreState.trackEvent("task.modified", phaseId, "phase", {
        fieldsChanged: Object.keys(updates),
      });
    } catch (error) {
      mapStoreState.phases = prevPhases;
      emit();
      throw error;
    }
  },

  async addPhase(phase) {
    if (!mapStoreState.map) throw new Error("No map loaded");
    const now = new Date().toISOString();
    const tempId = `temp-phase-${Date.now()}`;
    const optimisticPhase: Phase = {
      id: tempId,
      mapId: mapStoreState.map.id,
      name: phase.name ?? "New phase",
      phaseType: phase.phaseType ?? "custom",
      displayOrder: phase.displayOrder ?? mapStoreState.phases.length,
      color: phase.color ?? "#3B82F6",
      estimatedDate: phase.estimatedDate ?? null,
      windowStart: phase.windowStart ?? null,
      windowEnd: phase.windowEnd ?? null,
      protocolRef: phase.protocolRef ?? null,
      canvasX: phase.canvasX ?? null,
      canvasY: phase.canvasY ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mapStoreState.phases = [...mapStoreState.phases, optimisticPhase];
    emit();

    try {
      const created = (await mapApi.createPhase({
        mapId: mapStoreState.map.id,
        name: optimisticPhase.name,
        phaseType: optimisticPhase.phaseType,
        color: optimisticPhase.color,
        displayOrder: optimisticPhase.displayOrder,
        estimatedDate: optimisticPhase.estimatedDate,
        windowStart: optimisticPhase.windowStart,
        windowEnd: optimisticPhase.windowEnd,
        protocolRef: optimisticPhase.protocolRef ?? null,
        canvasX: optimisticPhase.canvasX ?? null,
        canvasY: optimisticPhase.canvasY ?? null,
      })) as unknown as Phase;

      mapStoreState.phases = mapStoreState.phases.map((row) => (row.id === tempId ? created : row));
      emit();
      return created;
    } catch (error) {
      mapStoreState.phases = mapStoreState.phases.filter((row) => row.id !== tempId);
      emit();
      throw error;
    }
  },

  async removePhase(phaseId) {
    const prevPhases = [...mapStoreState.phases];
    const prevTasks = [...mapStoreState.tasks];
    const prevTransitions = [...mapStoreState.transitions];
    mapStoreState.phases = mapStoreState.phases.filter((phase) => phase.id !== phaseId);
    mapStoreState.tasks = mapStoreState.tasks.filter((task) => task.phaseId !== phaseId);
    mapStoreState.transitions = mapStoreState.transitions.filter(
      (transition) => transition.fromPhaseId !== phaseId && transition.toPhaseId !== phaseId
    );
    emit();
    try {
      await mapApi.removePhase(phaseId);
      await mapStoreState.trackEvent("task.rejected", phaseId, "phase", { removed: true });
    } catch (error) {
      mapStoreState.phases = prevPhases;
      mapStoreState.tasks = prevTasks;
      mapStoreState.transitions = prevTransitions;
      emit();
      throw error;
    }
  },

  async reorderPhases(orderedIds) {
    if (!mapStoreState.map) throw new Error("No map loaded");
    const prevPhases = [...mapStoreState.phases];
    const orderLookup = new Map(orderedIds.map((id, index) => [id, index]));
    mapStoreState.phases = mapStoreState.phases
      .map((phase) => ({
        ...phase,
        displayOrder: orderLookup.get(phase.id) ?? phase.displayOrder,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
    emit();
    try {
      await mapApi.reorderPhases({ mapId: mapStoreState.map.id, orderedIds });
      await mapStoreState.trackEvent("task.modified", mapStoreState.map.id, "map", { orderedIds });
    } catch (error) {
      mapStoreState.phases = prevPhases;
      emit();
      throw error;
    }
  },

  async reorderTasks(phaseId, orderedIds) {
    if (!mapStoreState.map) throw new Error("No map loaded");
    const prevTasks = [...mapStoreState.tasks];
    const orderLookup = new Map(orderedIds.map((id, index) => [id, index]));
    mapStoreState.tasks = mapStoreState.tasks.map((task) =>
      task.phaseId === phaseId && orderLookup.has(task.id)
        ? { ...task, orderInPhase: orderLookup.get(task.id) as number, updatedAt: new Date().toISOString() }
        : task
    );
    emit();
    try {
      await mapApi.reorderTasks({ mapId: mapStoreState.map.id, phaseId, orderedIds });
      await mapStoreState.trackEvent("task.modified", mapStoreState.map.id, "map", {
        phaseId,
        orderedIds,
      });
    } catch (error) {
      mapStoreState.tasks = prevTasks;
      emit();
      throw error;
    }
  },

  async addDependency(dep) {
    if (!mapStoreState.map) throw new Error("No map loaded");
    if (!dep.sourceTaskId || !dep.targetTaskId) {
      throw new Error("Dependency requires sourceTaskId and targetTaskId");
    }
    if (!mapStoreState.validateDependency(dep.sourceTaskId, dep.targetTaskId)) {
      throw new Error("Dependency would create a cycle");
    }

    const tempId = `temp-dep-${Date.now()}`;
    const optimistic: TaskDependency = {
      id: tempId,
      sourceTaskId: dep.sourceTaskId,
      targetTaskId: dep.targetTaskId,
      dependencyType: dep.dependencyType ?? "finish_to_start",
      conditionLabel: dep.conditionLabel ?? null,
      isCrossPhase: dep.isCrossPhase ?? false,
      createdAt: new Date().toISOString(),
    };
    const prevDeps = [...mapStoreState.dependencies];
    mapStoreState.dependencies = [...mapStoreState.dependencies, optimistic];
    emit();

    try {
      const created = (await mapApi.addDependency({
        mapId: mapStoreState.map.id,
        sourceTaskId: dep.sourceTaskId,
        targetTaskId: dep.targetTaskId,
        dependencyType: dep.dependencyType as DependencyType | undefined,
        conditionLabel: dep.conditionLabel ?? undefined,
      })) as unknown as TaskDependency;
      mapStoreState.dependencies = mapStoreState.dependencies.map((row) =>
        row.id === tempId ? created : row
      );
      emit();
      return created;
    } catch (error) {
      mapStoreState.dependencies = prevDeps;
      emit();
      throw error;
    }
  },

  async removeDependency(depId) {
    const prevDeps = [...mapStoreState.dependencies];
    mapStoreState.dependencies = mapStoreState.dependencies.filter((dep) => dep.id !== depId);
    emit();
    try {
      await mapApi.removeDependency(depId);
      await mapStoreState.trackEvent("dependency.removed", depId, "dependency");
    } catch (error) {
      mapStoreState.dependencies = prevDeps;
      emit();
      throw error;
    }
  },

  async addTransition(transition) {
    if (!mapStoreState.map) throw new Error("No map loaded");
    if (!transition.fromPhaseId || !transition.toPhaseId) {
      throw new Error("Transition requires fromPhaseId and toPhaseId");
    }
    const tempId = `temp-transition-${Date.now()}`;
    const optimistic: PhaseTransition = {
      id: tempId,
      fromPhaseId: transition.fromPhaseId,
      toPhaseId: transition.toPhaseId,
      conditionLabel: transition.conditionLabel ?? null,
      isDefault: transition.isDefault ?? true,
      createdAt: new Date().toISOString(),
    };
    const prevTransitions = [...mapStoreState.transitions];
    mapStoreState.transitions = [...mapStoreState.transitions, optimistic];
    emit();
    try {
      const created = (await mapApi.addTransition({
        mapId: mapStoreState.map.id,
        fromPhaseId: transition.fromPhaseId,
        toPhaseId: transition.toPhaseId,
        conditionLabel: transition.conditionLabel ?? undefined,
        isDefault: transition.isDefault ?? true,
      })) as unknown as PhaseTransition;
      mapStoreState.transitions = mapStoreState.transitions.map((row) =>
        row.id === tempId ? created : row
      );
      emit();
      return created;
    } catch (error) {
      mapStoreState.transitions = prevTransitions;
      emit();
      throw error;
    }
  },

  async removeTransition(transitionId) {
    const prevTransitions = [...mapStoreState.transitions];
    mapStoreState.transitions = mapStoreState.transitions.filter((item) => item.id !== transitionId);
    emit();
    try {
      await mapApi.removeTransition(transitionId);
      await mapStoreState.trackEvent("task.modified", transitionId, "phase", {
        transitionRemoved: true,
      });
    } catch (error) {
      mapStoreState.transitions = prevTransitions;
      emit();
      throw error;
    }
  },

  async updateTransition(transitionId, updates) {
    const prevTransitions = [...mapStoreState.transitions];
    mapStoreState.transitions = mapStoreState.transitions.map((item) =>
      item.id === transitionId ? { ...item, ...updates } : item
    );
    emit();
    try {
      await mapApi.updateTransition({
        transitionId,
        updates: {
          conditionLabel: updates.conditionLabel ?? null,
          isDefault: updates.isDefault,
        },
      });
      await mapStoreState.trackEvent("task.modified", transitionId, "phase", {
        transitionUpdated: true,
      });
    } catch (error) {
      mapStoreState.transitions = prevTransitions;
      emit();
      throw error;
    }
  },

  async launchMap() {
    if (!mapStoreState.map) throw new Error("No map loaded");

    const prevMap = mapStoreState.map;
    const prevTasks = [...mapStoreState.tasks];
    mapStoreState.map = {
      ...mapStoreState.map,
      status: "active",
      launchedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mapStoreState.tasks = mapStoreState.tasks.map((task) =>
      task.status === "confirmed" ? { ...task, status: "todo", updatedAt: new Date().toISOString() } : task
    );
    emit();

    try {
      await mapApi.launchMap(mapStoreState.map.id);
      const totalTasks = mapStoreState.tasks.length;
      const accepted = prevTasks.filter((task) => task.status === "confirmed").length;
      const modified = prevTasks.filter((task) => task.isCustom).length;
      await mapStoreState.trackEvent("map.launched", mapStoreState.map.id, "map", {
        totalTasks,
        acceptedPct: totalTasks > 0 ? accepted / totalTasks : 0,
        modifiedPct: totalTasks > 0 ? modified / totalTasks : 0,
      });
    } catch (error) {
      mapStoreState.map = prevMap;
      mapStoreState.tasks = prevTasks;
      emit();
      throw error;
    }
  },

  async archiveMap() {
    if (!mapStoreState.map) throw new Error("No map loaded");
    const prevMap = mapStoreState.map;
    mapStoreState.map = { ...mapStoreState.map, status: "archived", updatedAt: new Date().toISOString() };
    emit();
    try {
      await mapApi.archiveMap(mapStoreState.map.id);
      await mapStoreState.trackEvent("amendment.reviewed", mapStoreState.map.id, "map", {
        archived: true,
      });
    } catch (error) {
      mapStoreState.map = prevMap;
      emit();
      throw error;
    }
  },

  async trackEvent(eventType, targetId, targetType, payload) {
    if (!mapStoreState.map) return;
    await trackMapEvent(mapStoreState.map.id, mapStoreState.map.trialId, eventType, {
      targetId,
      targetType,
      payload,
    });
  },

  getFilteredTasks() {
    const { filters } = mapStoreState;
    let rows = [...mapStoreState.tasks];

    if (filters.protocolSectionId) {
      const section = mapStoreState.protocolMapSections.find((item) => item.id === filters.protocolSectionId);
      const linked = new Set(section?.linkedTaskIds ?? []);
      rows = rows.filter((task) => linked.has(task.id));
    }

    if (filters.phaseId) {
      rows = rows.filter((task) => task.phaseId === filters.phaseId);
    }

    if (filters.assigneeId !== undefined) {
      rows = rows.filter((task) => task.assignedUserId === filters.assigneeId);
    }

    if (filters.statuses?.length) {
      const statusSet = new Set(filters.statuses);
      rows = rows.filter((task) => statusSet.has(task.status));
    }

    if (filters.myTasksOnly && currentUserId !== null) {
      rows = rows.filter((task) => task.assignedUserId === currentUserId);
    }

    return rows;
  },

  getTasksByPhase() {
    const byPhase: Record<string, Task[]> = {};
    for (const task of mapStoreState.getFilteredTasks()) {
      if (!byPhase[task.phaseId]) byPhase[task.phaseId] = [];
      byPhase[task.phaseId].push(task);
    }
    return byPhase;
  },

  getTasksByStatus() {
    const statuses: TaskStatus[] = [
      "suggested",
      "confirmed",
      "todo",
      "in_progress",
      "blocked",
      "waiting",
      "done",
      "skipped",
      "cancelled",
    ];
    const byStatus: Record<TaskStatus, Task[]> = {
      suggested: [],
      confirmed: [],
      todo: [],
      in_progress: [],
      blocked: [],
      waiting: [],
      done: [],
      skipped: [],
      cancelled: [],
    };
    for (const status of statuses) {
      byStatus[status] = mapStoreState.tasks.filter((task) => task.status === status);
    }
    return byStatus;
  },

  getTaskDependencies(taskId) {
    return mapStoreState.dependencies.filter(
      (dep) => dep.sourceTaskId === taskId || dep.targetTaskId === taskId
    );
  },

  getPhaseTasks(phaseId) {
    return mapStoreState.tasks
      .filter((task) => task.phaseId === phaseId)
      .sort((a, b) => a.orderInPhase - b.orderInPhase);
  },

  validateDependency(sourceId, targetId) {
    if (sourceId === targetId) return false;
    const graph = new Map<string, string[]>();
    for (const dep of mapStoreState.dependencies) {
      const edges = graph.get(dep.sourceTaskId) ?? [];
      edges.push(dep.targetTaskId);
      graph.set(dep.sourceTaskId, edges);
    }
    const sourceEdges = graph.get(sourceId) ?? [];
    sourceEdges.push(targetId);
    graph.set(sourceId, sourceEdges);

    const stack = [targetId];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === sourceId) return false;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const next of graph.get(node) ?? []) {
        stack.push(next);
      }
    }
    return true;
  },
};

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeMapStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMapStore<T>(selector: (store: MapStoreShape) => T): T {
  return useSyncExternalStore(
    subscribeMapStore,
    () => selector(mapStoreState),
    () => selector(mapStoreState)
  );
}

export function getMapStore() {
  return mapStoreState;
}

export function setMapStoreCurrentUser(userId: number | null) {
  currentUserId = userId;
}
