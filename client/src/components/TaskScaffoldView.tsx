import { useState } from "react";
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
  id: number;
  name: string;
  suggestedDate: Date | null;
  suggestedAssigneeId: number | null;
  dependencies: any[];
  status: string;
}

interface Phase {
  id: number;
  name: string;
  color: string;
  tasks: Task[];
}

interface ProtocolSection {
  id: number;
  name: string;
  dateReference: string | null;
  pageReference: string | null;
  children?: ProtocolSection[];
}

interface TaskScaffoldViewProps {
  phases: Phase[];
  sections: ProtocolSection[];
  onConfirm: () => void;
  onAddTask: () => void;
  onEditTask: (taskId: number) => void;
  onDeleteTask: (taskId: number) => void;
}

// Sortable Section Component
function SortableSection({ section, isSelected, onToggle, onEdit }: { section: ProtocolSection; isSelected: boolean; onToggle: () => void; onEdit: () => void }) {
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
      <div className={`group flex items-center gap-2 py-2 rounded px-2 -mx-2 transition-colors ${isDragging ? 'bg-blue-100' : 'hover:bg-gray-50'}`}>
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
          {section.dateReference && (
            <span className="text-xs text-gray-400">{section.dateReference}</span>
          )}
          {section.pageReference && (
            <span className="text-xs text-gray-400">{section.pageReference}</span>
          )}
        </div>
        <LinkIcon className="h-3.5 w-3.5 text-gray-400" />
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
function SortableTask({ task, phaseId, onEdit, onDelete }: { task: Task; phaseId: number; onEdit: () => void; onDelete: () => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `${phaseId}-${task.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={`group flex items-center gap-3 py-3 px-4 bg-white rounded-lg border border-gray-200 transition-all ${isDragging ? 'shadow-lg' : 'hover:shadow-sm'}`}>
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <GripVertical className="h-4 w-4 text-gray-300" />
      </div>
      <div className="flex-1">
        <div className="text-sm text-gray-900">{task.name}</div>
        {task.suggestedDate && (
          <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
            <Calendar className="h-3 w-3" />
            {task.suggestedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        )}
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
}: TaskScaffoldViewProps) {
  const [activeView, setActiveView] = useState<"list" | "timeline" | "canvas">("list");
  const [selectedSections, setSelectedSections] = useState<Set<number>>(new Set());
  const [reorderedSections, setReorderedSections] = useState<ProtocolSection[]>(() => sections);
  const [reorderedPhases, setReorderedPhases] = useState<Phase[]>(() => phases);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const toggleSection = (sectionId: number) => {
    const newSelected = new Set(selectedSections);
    if (newSelected.has(sectionId)) {
      newSelected.delete(sectionId);
    } else {
      newSelected.add(sectionId);
    }
    setSelectedSections(newSelected);
  };

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
      
      const [activePhaseId, activeTaskId] = activeId.split('-').map(Number);
      const [overPhaseId, overTaskId] = overId.split('-').map(Number);

      if (activePhaseId === overPhaseId) {
        setReorderedPhases((phases) => {
          return phases.map((phase) => {
            if (phase.id === activePhaseId) {
              const oldIndex = phase.tasks.findIndex((t) => t.id === activeTaskId);
              const newIndex = phase.tasks.findIndex((t) => t.id === overTaskId);
              logEvent({
                eventType: "feature_used",
                action: "reorder_task",
                entityType: "task",
                payload: { phaseId: activePhaseId, from: oldIndex, to: newIndex },
              });
              return {
                ...phase,
                tasks: arrayMove(phase.tasks, oldIndex, newIndex),
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
    const colorMap: Record<string, string> = {
      blue: "bg-blue-500",
      green: "bg-green-500",
      yellow: "bg-yellow-500",
      red: "bg-red-500",
      purple: "bg-purple-500",
    };
    return colorMap[color] || "bg-gray-500";
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

  return (
    <div className="flex gap-4 h-full">
      {/* Left Panel: Protocol Map */}
      <div className="w-80 bg-white rounded-lg border border-gray-200 p-6 overflow-y-auto">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Protocol Map</h2>
        <p className="text-xs text-gray-500 mb-4">Click a section to filter timeline</p>

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
                  onToggle={() => toggleSection(section.id)}
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
                {reorderedPhases.map((phase) => (
                  <div key={phase.id} className="space-y-3">
                    {/* Phase Header */}
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${getPhaseColor(phase.color)}`} />
                      <h3 className="text-sm font-semibold text-gray-900">{phase.name}</h3>
                      <span className="text-xs text-gray-500">({phase.tasks.length})</span>
                    </div>

                    {/* Tasks */}
                    <SortableContext
                      items={phase.tasks.map((t) => `${phase.id}-${t.id}`)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {phase.tasks.map((task) => (
                          <SortableTask
                            key={task.id}
                            task={task}
                            phaseId={phase.id}
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
              </div>
            </DndContext>
          )}

          {activeView === "timeline" && (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <BarChart3 className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>Timeline view coming soon</p>
              </div>
            </div>
          )}

          {activeView === "canvas" && (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <Workflow className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                <p>Canvas view coming soon</p>
              </div>
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
