import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Plus, Calendar, User, Link as LinkIcon, Edit2, Trash2, GripVertical, AlertCircle, List, BarChart3, Workflow } from "lucide-react";
import { toast } from "sonner";
import { logEvent } from "@/lib/telemetry";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Task {
  id: string;
  name: string;
  suggestedDate: Date | null;
  suggestedAssigneeId: number | null;
  dependencies: Array<{ sourceTaskId?: string; targetTaskId?: string; sourceTaskName?: string | null }>;
  status: string;
  category?: string | null;
  assignedRole?: string | null;
  estimatedDuration?: number | null;
  priority?: "critical" | "high" | "medium" | "low" | null;
  aiConfidence?: number | null;
  conditionalNote?: string | null;
  protocolReference?: {
    section?: string | null;
    page?: number | null;
    extractedText?: string | null;
  };
}

interface Phase {
  id: string;
  name: string;
  color: string;
  tasks: Task[];
}

interface ProtocolSection {
  id: string;
  name: string;
  dateReference: string | null;
  pageReference: string | null;
  pageStart?: number | null;
  linkedTaskIds?: string[];
  linkedPhaseIds?: string[];
  children?: ProtocolSection[];
}

interface TaskScaffoldViewProps {
  phases: Phase[];
  sections: ProtocolSection[];
  onConfirm: () => void;
  onAddTask: () => void;
  onEditTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks?: (phaseId: string, orderedTaskIds: string[]) => void;
  onOpenProtocolPage?: (page: number | null | undefined, sectionName: string) => void;
}

// Sortable Section Component
function SortableSection({
  section,
  isSelected,
  linkedTaskCount,
  linkedPhaseCount,
  onToggle,
  onEdit,
  onOpenSource,
}: {
  section: ProtocolSection;
  isSelected: boolean;
  linkedTaskCount: number;
  linkedPhaseCount: number;
  onToggle: () => void;
  onEdit: () => void;
  onOpenSource?: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`group flex items-center gap-2 py-2 rounded px-2 -mx-2 transition-colors border ${
          isDragging
            ? "bg-blue-100 border-blue-200"
            : isSelected
            ? "bg-blue-50 border-blue-100"
            : "border-transparent hover:bg-gray-50"
        }`}
        title={`${linkedTaskCount} task${linkedTaskCount === 1 ? "" : "s"} across ${linkedPhaseCount} phase${
          linkedPhaseCount === 1 ? "" : "s"
        }`}
      >
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
          <GripVertical className="h-4 w-4 text-gray-300" />
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="rounded border-gray-300"
        />
        <div className="flex-1 flex items-center justify-between">
          <span className="text-sm text-gray-700">{section.name}</span>
          <div className="flex items-center gap-2">
            {linkedTaskCount > 0 ? (
              <span className="text-[10px] font-medium bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                {linkedTaskCount} task{linkedTaskCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {section.dateReference && (
              <span className="text-xs text-gray-400">{section.dateReference}</span>
            )}
            {section.pageReference && (
              <span className="text-xs text-gray-400">{section.pageReference}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenSource}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
          aria-label={`Open protocol source for ${section.name}`}
        >
          <LinkIcon className="h-3.5 w-3.5 text-gray-400" />
        </button>
        <button
          onClick={onEdit}
          className="p-1 hover:bg-gray-200 rounded transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Edit section"
        >
          <Edit2 className="h-3.5 w-3.5 text-gray-500" />
        </button>
      </div>
    </div>
  );
}

// Sortable Task Component
function SortableTask({
  task,
  phaseId,
  onEdit,
  onDelete,
  onOpenSource,
  highlightSource,
  dependencyLabel,
}: {
  task: Task;
  phaseId: string;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSource?: () => void;
  highlightSource: boolean;
  dependencyLabel?: string | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `${phaseId}::${task.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 py-3 px-4 bg-white rounded-lg border transition-all ${
        isDragging ? "shadow-lg border-blue-200" : highlightSource ? "border-blue-200 bg-blue-50/40" : "border-gray-200 hover:shadow-sm"
      }`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-4 w-4 text-gray-300" />
      </div>
      <div className="flex-1">
        <div className="text-sm text-gray-900">{task.name}</div>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
          {task.assignedRole && (
            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              <User className="h-3 w-3 mr-1" />
              {task.assignedRole.replace(/_/g, " ").toUpperCase()}
            </span>
          )}
          {typeof task.estimatedDuration === "number" && (
            <span className="inline-flex items-center gap-1">
              ⏱ {task.estimatedDuration} min
            </span>
          )}
          {task.priority && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                task.priority === "critical"
                  ? "bg-red-100 text-red-700"
                  : task.priority === "high"
                  ? "bg-orange-100 text-orange-700"
                  : task.priority === "medium"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {task.priority}
            </span>
          )}
          {task.protocolReference?.section || task.protocolReference?.page ? (
            <button
              type="button"
              onClick={onOpenSource}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              <LinkIcon className="h-3 w-3" />
              {task.protocolReference?.section || "Protocol"}
              {task.protocolReference?.page ? ` · p.${task.protocolReference.page}` : ""}
            </button>
          ) : null}
          {typeof task.aiConfidence === "number" ? (
            <span className="inline-flex items-center gap-1">
              ⚡ {task.aiConfidence.toFixed(2)}
            </span>
          ) : null}
          {task.suggestedDate && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {task.suggestedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
          {dependencyLabel ? <span>Depends on: {dependencyLabel}</span> : null}
          {task.conditionalNote ? (
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
              ⚠ {task.conditionalNote}
            </span>
          ) : null}
          {typeof task.aiConfidence === "number" && task.aiConfidence < 0.85 ? (
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
              ⚠ Needs review
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
          aria-label="Edit task"
        >
          <Edit2 className="h-4 w-4 text-gray-500" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4 text-gray-500" />
        </button>
      </div>
    </div>
  );
}

/**
 * Task Scaffold View - Two-panel layout with Protocol Map and Task Scaffold
 * Supports List, Timeline, and Canvas views
 */
export function TaskScaffoldView({
  phases,
  sections,
  onConfirm,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onReorderTasks,
  onOpenProtocolPage,
}: TaskScaffoldViewProps) {
  const [activeView, setActiveView] = useState<"list" | "timeline" | "canvas">("list");
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [reorderedSections, setReorderedSections] = useState<ProtocolSection[]>(() => sections);
  const [reorderedPhases, setReorderedPhases] = useState<Phase[]>(() => phases);

  useEffect(() => {
    setReorderedSections(sections);
  }, [sections]);

  useEffect(() => {
    setReorderedPhases(phases);
  }, [phases]);

  const normalize = (value: string | null | undefined) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const toggleSection = (sectionId: string) => {
    const newSelected = new Set(selectedSections);
    if (newSelected.has(sectionId)) {
      newSelected.delete(sectionId);
    } else {
      newSelected.add(sectionId);
    }
    setSelectedSections(newSelected);
  };

  const sectionById = useMemo(() => new Map(reorderedSections.map((section) => [section.id, section])), [reorderedSections]);

  const selectedSectionList = useMemo(
    () => Array.from(selectedSections).map((id) => sectionById.get(id)).filter(Boolean) as ProtocolSection[],
    [selectedSections, sectionById]
  );

  const selectedTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of selectedSectionList) {
      for (const taskId of section.linkedTaskIds ?? []) ids.add(taskId);
    }
    return ids;
  }, [selectedSectionList]);

  const fallbackTaskMatchesSection = (task: Task, section: ProtocolSection) => {
    const sectionName = normalize(section.name);
    const taskSection = normalize(task.protocolReference?.section);
    const taskName = normalize(task.name);
    return (
      (taskSection && (taskSection.includes(sectionName) || sectionName.includes(taskSection))) ||
      taskName.includes(sectionName) ||
      sectionName.includes(taskName)
    );
  };

  const filteredPhases = useMemo(() => {
    if (selectedSectionList.length === 0) return reorderedPhases;
    return reorderedPhases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.filter((task) => {
        if (selectedTaskIds.size > 0) return selectedTaskIds.has(task.id);
        return selectedSectionList.some((section) => fallbackTaskMatchesSection(task, section));
      }),
    }));
  }, [reorderedPhases, selectedTaskIds, selectedSectionList]);

  const visiblePhases = useMemo(
    () => filteredPhases.filter((phase) => phase.tasks.length > 0),
    [filteredPhases]
  );

  const totalTaskCount = useMemo(
    () => reorderedPhases.reduce((sum, phase) => sum + phase.tasks.length, 0),
    [reorderedPhases]
  );
  const visibleTaskCount = useMemo(
    () => filteredPhases.reduce((sum, phase) => sum + phase.tasks.length, 0),
    [filteredPhases]
  );

  const sectionTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const section of reorderedSections) {
      const explicit = section.linkedTaskIds?.length;
      const count =
        typeof explicit === "number" && explicit > 0
          ? explicit
          : reorderedPhases.reduce((sum, phase) => {
              return (
                sum +
                phase.tasks.filter((task) => fallbackTaskMatchesSection(task, section)).length
              );
            }, 0);
      counts.set(section.id, count);
    }
    return counts;
  }, [reorderedSections, reorderedPhases, fallbackTaskMatchesSection]);

  const timelineRows = useMemo(() => {
    const rows = visiblePhases.flatMap((phase) =>
      phase.tasks.map((task) => ({
        task,
        phaseName: phase.name,
        ts: task.suggestedDate ? new Date(task.suggestedDate).getTime() : Number.MAX_SAFE_INTEGER,
      }))
    );
    rows.sort((a, b) => a.ts - b.ts || a.phaseName.localeCompare(b.phaseName));
    return rows;
  }, [visiblePhases]);

  const handleSectionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setReorderedSections((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        toast("Section reordered");
        logEvent({
          eventType: "feature_used",
          action: "reorder_section",
          entityType: "protocol_section",
          payload: { from: oldIndex, to: newIndex },
        });
        return newOrder;
      });
    }
  };

  const handleTaskDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const activeId = String(active.id);
      const overId = String(over.id);
      
      const [activePhaseId, activeTaskId] = activeId.split("::");
      const [overPhaseId, overTaskId] = overId.split("::");

      if (activePhaseId === overPhaseId) {
        setReorderedPhases((phases) => {
          return phases.map((phase) => {
            if (phase.id === activePhaseId) {
              const oldIndex = phase.tasks.findIndex((t) => t.id === activeTaskId);
              const newIndex = phase.tasks.findIndex((t) => t.id === overTaskId);
              const reordered = arrayMove(phase.tasks, oldIndex, newIndex);
              if (onReorderTasks) {
                onReorderTasks(activePhaseId, reordered.map((task) => task.id));
              }
              logEvent({
                eventType: "feature_used",
                action: "reorder_task",
                entityType: "task",
                payload: { phaseId: activePhaseId, from: oldIndex, to: newIndex },
              });
              return {
                ...phase,
                tasks: reordered,
              };
            }
            return phase;
          });
        });
        toast("Task reordered");
      }
    }
  };

  const getPhaseColor = (color: string) => {
    if (color?.startsWith("#")) return color;
    const colorMap: Record<string, string> = {
      blue: "#3B82F6",
      green: "#10B981",
      yellow: "#F59E0B",
      red: "#EF4444",
      purple: "#8B5CF6",
    };
    return colorMap[color] || "#6B7280";
  };

  const handleViewChange = (next: "list" | "timeline" | "canvas") => {
    setActiveView(next);
    logEvent({
      eventType: "feature_used",
      action: "change_view",
      entityType: "task_scaffold",
      payload: { view: next },
    });
  };

  const sectionFilterBadges =
    selectedSectionList.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Filtered by:</span>
        {selectedSectionList.map((section) => (
          <button
            key={`filter-${section.id}`}
            type="button"
            onClick={() => toggleSection(section.id)}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
          >
            {section.name}
            <span aria-hidden>×</span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="flex gap-4 h-full">
      {/* Left Panel: Protocol Map */}
      <div className="w-80 bg-white rounded-lg border border-gray-200 p-6 overflow-y-auto">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Protocol Map</h2>
        <p className="text-xs text-gray-500 mb-4">
          Select sections to focus linked tasks across List, Timeline, and Canvas.
        </p>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleSectionDragEnd}
        >
          <SortableContext
            items={reorderedSections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {reorderedSections.map((section) => (
                <SortableSection
                  key={section.id}
                  section={section}
                  isSelected={selectedSections.has(section.id)}
                  linkedTaskCount={sectionTaskCounts.get(section.id) ?? 0}
                  linkedPhaseCount={section.linkedPhaseIds?.length ?? 0}
                  onToggle={() => toggleSection(section.id)}
                  onOpenSource={() => onOpenProtocolPage?.(section.pageStart, section.name)}
                  onEdit={() => toast("Edit section: " + section.name)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Right Panel: Task Scaffold */}
      <div className="flex-1 bg-white rounded-lg border border-gray-200 flex flex-col h-full">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Task Scaffold</h2>
              <p className="text-sm text-gray-500">Review and edit tasks. Assignments are suggested based on team roles.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  logEvent({
                    eventType: "task_created",
                    action: "start_create",
                    entityType: "task",
                  });
                  onAddTask();
                }}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Tasks
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  logEvent({
                    eventType: "trial_setup_completed",
                    action: "confirm",
                    entityType: "task_scaffold",
                  });
                  onConfirm();
                }}
              >
                <Check className="h-4 w-4 mr-1" />
                Confirm & Launch
              </Button>
            </div>
          </div>

          {/* View Tabs */}
          <div className="flex items-center gap-1 border-b border-gray-200">
            <button
              onClick={() => handleViewChange("list")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeView === "list"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <List className="h-4 w-4" />
              List
            </button>
            <button
              onClick={() => handleViewChange("timeline")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeView === "timeline"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Timeline
            </button>
            <button
              onClick={() => handleViewChange("canvas")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeView === "canvas"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Workflow className="h-4 w-4" />
              Canvas
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeView === "list" && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTaskDragEnd}
            >
              <div className="space-y-4">
                <div className="text-xs text-gray-500">
                  Showing {visibleTaskCount} of {totalTaskCount} tasks
                  {selectedSectionList.length > 0 ? " from selected protocol sections" : ""}
                </div>
                {sectionFilterBadges}
                {visiblePhases.map((phase) => (
                  <div key={phase.id} className="space-y-3">
                    {/* Phase Header */}
                    <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getPhaseColor(phase.color) }} />
                      <h3 className="text-sm font-semibold text-gray-900">{phase.name}</h3>
                      <span className="text-xs text-gray-500">({phase.tasks.length})</span>
                    </div>

                    {/* Tasks */}
                    <SortableContext
                      items={phase.tasks.map((t) => `${phase.id}::${t.id}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {phase.tasks.map((task) => (
                          <SortableTask
                            key={task.id}
                            task={task}
                            phaseId={phase.id}
                            highlightSource={selectedTaskIds.size > 0 ? selectedTaskIds.has(task.id) : selectedSectionList.length > 0}
                            dependencyLabel={
                              task.dependencies?.length
                                ? task.dependencies
                                    .map((dep) => dep.sourceTaskName)
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .join(", ")
                                : null
                            }
                            onOpenSource={() =>
                              onOpenProtocolPage?.(task.protocolReference?.page ?? null, task.protocolReference?.section || task.name)
                            }
                            onEdit={() => {
                              logEvent({
                                eventType: "task_edited",
                                action: "start_edit",
                                entityType: "task",
                                entityId: String(task.id),
                              });
                              onEditTask(task.id);
                            }}
                            onDelete={() => {
                              logEvent({
                                eventType: "task_deleted",
                                action: "start_delete",
                                entityType: "task",
                                entityId: String(task.id),
                              });
                              onDeleteTask(task.id);
                            }}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </div>
                ))}
                {visiblePhases.length === 0 && (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                    No tasks are currently linked to the selected protocol sections.
                  </div>
                )}
              </div>
            </DndContext>
          )}

          {activeView === "timeline" && (
            <div className="space-y-3">
              <div className="text-xs text-gray-500">
                Showing {timelineRows.length} scheduled task{timelineRows.length === 1 ? "" : "s"} in timeline order.
              </div>
              {sectionFilterBadges}
              {timelineRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                  No scheduled tasks available for the selected protocol scope.
                </div>
              ) : (
                <div className="space-y-2">
                  {timelineRows.map(({ task, phaseName }) => (
                    <div key={`timeline-${task.id}`} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{task.name}</div>
                          <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-1.5">
                            <span>{phaseName}</span>
                            {(task.protocolReference?.section || task.protocolReference?.page) && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenProtocolPage?.(
                                    task.protocolReference?.page ?? null,
                                    task.protocolReference?.section || task.name
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                              >
                                <LinkIcon className="h-3 w-3" />
                                {task.protocolReference?.section || "Protocol"}
                                {task.protocolReference?.page ? ` · p.${task.protocolReference.page}` : ""}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs font-medium text-gray-600 whitespace-nowrap">
                          {task.suggestedDate
                            ? new Date(task.suggestedDate).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "No date"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeView === "canvas" && (
            <div className="space-y-4">
              <div className="text-xs text-gray-500">
                Operational canvas of the same protocol-linked tasks, grouped by phase.
              </div>
              {sectionFilterBadges}
              {visiblePhases.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                  No phase cards to show for the selected protocol sections.
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {visiblePhases.map((phase) => (
                    <div key={`canvas-${phase.id}`} className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getPhaseColor(phase.color) }} />
                        <h3 className="text-sm font-semibold text-gray-900">{phase.name}</h3>
                        <span className="text-xs text-gray-500">({phase.tasks.length})</span>
                      </div>
                      <div className="space-y-2">
                        {phase.tasks.map((task) => (
                          <div key={`canvas-task-${task.id}`} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="text-sm text-gray-900">{task.name}</div>
                            {(task.protocolReference?.section || task.protocolReference?.page) && (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenProtocolPage?.(
                                    task.protocolReference?.page ?? null,
                                    task.protocolReference?.section || task.name
                                  )
                                }
                                className="mt-1 text-xs text-gray-500 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                              >
                                <LinkIcon className="h-3 w-3" />
                                {task.protocolReference?.section || "Protocol"}
                                {task.protocolReference?.page ? ` · p.${task.protocolReference.page}` : ""}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Warning Banner */}
        <div className="p-4 bg-yellow-50 border-t border-yellow-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-900">Review before confirming</p>
              <p className="text-sm text-yellow-700">AI-generated tasks may need adjustments. Edit, add, or remove tasks to match your site's workflow.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
