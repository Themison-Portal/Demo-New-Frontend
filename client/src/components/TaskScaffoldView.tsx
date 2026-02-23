import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Plus, Minus, Calendar, User, Link as LinkIcon, Edit2, Trash2, GripVertical, AlertCircle, List, BarChart3, Workflow } from "lucide-react";
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
  startDate?: Date | null;
  suggestedDate: Date | null;
  dueDate?: Date | null;
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
  view?: "list" | "timeline" | "canvas";
  onViewChange?: (view: "list" | "timeline" | "canvas") => void;
  timelineStartDate?: Date | string | null;
  timelineEndDate?: Date | string | null;
}

function getISOWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Sortable Section Component
function SortableSection({
  section,
  isSelected,
  linkedTaskCount,
  linkedPhaseCount,
  onToggle,
  onSelectOnly,
  onEdit,
  onOpenSource,
}: {
  section: ProtocolSection;
  isSelected: boolean;
  linkedTaskCount: number;
  linkedPhaseCount: number;
  onToggle: () => void;
  onSelectOnly: () => void;
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
        role="button"
        tabIndex={0}
        onClick={onSelectOnly}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectOnly();
          }
        }}
      >
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing"
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-gray-300" />
        </div>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          onClick={(event) => event.stopPropagation()}
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
          onClick={(event) => {
            event.stopPropagation();
            onOpenSource?.();
          }}
          className="p-1 rounded hover:bg-gray-100 transition-colors"
          aria-label={`Open protocol source for ${section.name}`}
        >
          <LinkIcon className="h-3.5 w-3.5 text-gray-400" />
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
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
      onClick={onEdit}
      className={`group flex items-center gap-3 py-3 px-4 bg-white rounded-lg border transition-all cursor-pointer ${
        isDragging ? "shadow-lg border-blue-200" : highlightSource ? "border-blue-200 bg-blue-50/40" : "border-gray-200 hover:shadow-sm"
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
        onClick={(event) => event.stopPropagation()}
      >
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
              onClick={(event) => {
                event.stopPropagation();
                onOpenSource?.();
              }}
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
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
          aria-label="Edit task"
        >
          <Edit2 className="h-4 w-4 text-gray-500" />
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
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
  view,
  onViewChange,
  timelineStartDate,
  timelineEndDate,
}: TaskScaffoldViewProps) {
  const [internalView, setInternalView] = useState<"list" | "timeline" | "canvas">("list");
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [reorderedSections, setReorderedSections] = useState<ProtocolSection[]>(() => sections);
  const [reorderedPhases, setReorderedPhases] = useState<Phase[]>(() => phases);
  const [timelineDayWidth, setTimelineDayWidth] = useState(56);
  const activeView = view ?? internalView;

  useEffect(() => {
    setReorderedSections(sections);
  }, [sections]);

  useEffect(() => {
    setReorderedPhases(phases);
  }, [phases]);

  const TIMELINE_DAY_WIDTH = timelineDayWidth;
  const TIMELINE_DAY_WIDTH_MIN = 36;
  const TIMELINE_DAY_WIDTH_MAX = 96;
  const TIMELINE_DAY_WIDTH_STEP = 8;
  const TIMELINE_NAME_COL_WIDTH = 340;

  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const addDays = (value: Date, days: number) => {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  };
  const diffDays = (start: Date, end: Date) => {
    const msPerDay = 24 * 60 * 60 * 1000;
    const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.round((endUtc - startUtc) / msPerDay);
  };
  const parseMaybeDate = (value: unknown): Date | null => {
    if (!value) return null;
    const parseDateOnlyLocal = (input: string): Date | null => {
      const trimmed = String(input || "").trim();
      const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      const parsed = new Date(year, month - 1, day);
      if (
        parsed.getFullYear() !== year ||
        parsed.getMonth() !== month - 1 ||
        parsed.getDate() !== day
      ) {
        return null;
      }
      return parsed;
    };
    const date =
      value instanceof Date ? value : parseDateOnlyLocal(String(value)) ?? new Date(String(value));
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };
  const inferPhaseOffsetDays = (phaseName: string, phaseIndex: number) => {
    const text = String(phaseName || "").toLowerCase();

    const cXdY = text.match(/c(?:ycle)?\s*(\d+)\s*d(?:ay)?\s*(\d+)/i);
    if (cXdY) {
      const cycle = Math.max(1, Number(cXdY[1]));
      const day = Math.max(1, Number(cXdY[2]));
      return (cycle - 1) * 28 + (day - 1);
    }

    const cycleDay = text.match(/cycle\s*(\d+).*day\s*(-?\d+)/i);
    if (cycleDay) {
      const cycle = Math.max(1, Number(cycleDay[1]));
      const day = Number(cycleDay[2]);
      return (cycle - 1) * 28 + (day >= 1 ? day - 1 : day);
    }

    const dayOnly = text.match(/day\s*(-?\d+)/i);
    if (dayOnly) {
      const day = Number(dayOnly[1]);
      return day >= 1 ? day - 1 : day;
    }

    const week = text.match(/week\s*(\d+)/i);
    if (week) {
      return (Math.max(1, Number(week[1])) - 1) * 7;
    }

    if (text.includes("screen")) return -14;
    if (text.includes("baseline")) return 0;
    if (text.includes("end of treatment") || text.includes("eot")) return 56;
    if (text.includes("follow")) {
      const followDay = text.match(/(\d+)\s*day/i);
      if (followDay) return Number(followDay[1]);
      return 90 + phaseIndex * 7;
    }

    const cycle = text.match(/cycle\s*(\d+)/i);
    if (cycle) return (Math.max(1, Number(cycle[1])) - 1) * 28;

    return phaseIndex * 7;
  };
  const inferPhaseTimingWindow = (phaseName: string, phaseIndex: number, contextText?: string) => {
    const text = `${String(phaseName || "")} ${String(contextText || "")}`.toLowerCase();
    const phaseText = String(phaseName || "").toLowerCase();
    const isFollowPhase = /(follow|end of treatment|eot|termination)/.test(phaseText);
    const isScreenPhase = /(screen)/.test(phaseText);
    const anchorOffset = inferPhaseOffsetDays(phaseName, phaseIndex);
    const anchorDayToken = text.match(/\bday\s*(-?\d{1,3})\b/i);
    const anchorDay = anchorDayToken ? Number(anchorDayToken[1]) : null;
    const anchorFromText =
      anchorDay !== null && Number.isFinite(anchorDay)
        ? anchorDay >= 1
          ? anchorDay - 1
          : anchorDay
        : null;
    const resolvedAnchor = anchorFromText ?? anchorOffset;

    const rangeMatch =
      text.match(/(?:window[^a-z0-9-+]{0,12})?(?:day\s*)?(-?\d{1,3})\s*(?:to|[-–])\s*(?:day\s*)?(-?\d{1,3})\b/i) ||
      text.match(/day\s*(-?\d{1,3})\s*(?:to|[-–])\s*day?\s*(-?\d{1,3})\b/i);
    if (rangeMatch) {
      const rawA = Number(rangeMatch[1]);
      const rawB = Number(rangeMatch[2]);
      const startOffset = Math.min(rawA, rawB) >= 1 ? Math.min(rawA, rawB) - 1 : Math.min(rawA, rawB);
      const endOffset = Math.max(rawA, rawB) >= 1 ? Math.max(rawA, rawB) - 1 : Math.max(rawA, rawB);
      return { anchorOffset: resolvedAnchor, startOffset, endOffset };
    }

    if (isFollowPhase) {
      const followRange = text.match(/(\d{1,3})\s*(?:and|&)\s*(\d{1,3})\s*day/i);
      if (followRange) {
        const rawA = Number(followRange[1]);
        const rawB = Number(followRange[2]);
        const startOffset = Math.min(rawA, rawB) - 1;
        const endOffset = Math.max(rawA, rawB) - 1;
        return { anchorOffset: resolvedAnchor, startOffset, endOffset };
      }
    }

    const plusMinus = text.match(/[±\u00b1]\s*(\d+)\s*day/i);
    if (plusMinus) {
      let delta = Math.max(0, Number(plusMinus[1]));
      if (isScreenPhase) delta = Math.min(delta, 3);
      else if (!isFollowPhase) delta = Math.min(delta, 7);
      return { anchorOffset: resolvedAnchor, startOffset: resolvedAnchor - delta, endOffset: resolvedAnchor + delta };
    }

    const plusOnly = text.match(/\+\s*(\d+)\s*day/i);
    if (plusOnly) {
      let delta = Math.max(0, Number(plusOnly[1]));
      if (isScreenPhase) delta = Math.min(delta, 3);
      else if (!isFollowPhase) delta = Math.min(delta, 7);
      return { anchorOffset: resolvedAnchor, startOffset: resolvedAnchor, endOffset: resolvedAnchor + delta };
    }

    const minusOnly = text.match(/-\s*(\d+)\s*day/i);
    if (minusOnly) {
      let delta = Math.max(0, Number(minusOnly[1]));
      if (isScreenPhase) delta = Math.min(delta, 3);
      else if (!isFollowPhase) delta = Math.min(delta, 7);
      return { anchorOffset: resolvedAnchor, startOffset: resolvedAnchor - delta, endOffset: resolvedAnchor };
    }

    return { anchorOffset: resolvedAnchor, startOffset: resolvedAnchor, endOffset: resolvedAnchor };
  };
  const hexToRgba = (hex: string, alpha: number) => {
    const normalized = String(hex || "").replace("#", "");
    if (normalized.length !== 6) return `rgba(59, 130, 246, ${alpha})`;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

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

  const selectOnlySection = (sectionId: string) => {
    setSelectedSections(new Set([sectionId]));
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
        typeof explicit === "number"
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
    const trialStartAnchor = parseMaybeDate(timelineStartDate);
    const explicitDates = visiblePhases
      .flatMap((phase) =>
        phase.tasks.flatMap((task) => [
          parseMaybeDate(task.startDate),
          parseMaybeDate(task.suggestedDate),
          parseMaybeDate(task.dueDate),
        ])
      )
      .filter(Boolean) as Date[];
    const anchorDate = trialStartAnchor
      ? startOfDay(trialStartAnchor)
      : explicitDates.length
      ? startOfDay(
          explicitDates.reduce((min, current) => (current < min ? current : min), explicitDates[0])
        )
      : startOfDay(new Date());

    const rows = visiblePhases.flatMap((phase, phaseIndex) =>
      phase.tasks.map((task, taskIndex) => {
        const taskContextText = `${task.protocolReference?.section || ""} ${task.protocolReference?.extractedText || ""}`;
        const timing = inferPhaseTimingWindow(phase.name, phaseIndex, taskContextText);
        const startExplicit = parseMaybeDate(task.startDate) || parseMaybeDate(task.suggestedDate);
        const dueExplicit = parseMaybeDate(task.dueDate);
        const hasExplicitDates = Boolean(startExplicit || dueExplicit);

        let start: Date;
        let end: Date;

        if (hasExplicitDates) {
          const resolvedStart = startExplicit ?? dueExplicit ?? startOfDay(new Date());
          const resolvedEnd = dueExplicit ?? startExplicit ?? resolvedStart;
          start = startOfDay(resolvedStart);
          end = startOfDay(resolvedEnd);
        } else {
          const staggerDays = Math.floor(taskIndex / 6);
          const fallbackStart = addDays(anchorDate, timing.startOffset + staggerDays);
          const fallbackEnd = addDays(anchorDate, timing.endOffset + staggerDays);
          const fallbackDurationDays = Math.max(
            1,
            Math.ceil((Math.max(30, Number(task.estimatedDuration || 30)) || 30) / 480)
          );
          start = startOfDay(fallbackStart);
          const endCandidate =
            fallbackEnd >= fallbackStart
              ? fallbackEnd
              : addDays(start, fallbackDurationDays - 1);
          end = endCandidate < start ? start : endCandidate;
        }

        if (end < start) {
          end = start;
        }
        const spanDays = Math.max(1, diffDays(start, end) + 1);
        return {
          task,
          phaseName: phase.name,
          phaseColor: getPhaseColor(phase.color),
          start,
          end,
          spanDays,
          ts: start.getTime(),
        };
      })
    );
    rows.sort((a, b) => a.ts - b.ts || a.phaseName.localeCompare(b.phaseName) || a.task.name.localeCompare(b.task.name));
    return rows;
  }, [visiblePhases, timelineStartDate]);

  const timelineBounds = useMemo(() => {
    const datedRows = timelineRows.filter((row) => row.start && row.end);
    const trialStart = parseMaybeDate(timelineStartDate);
    const trialEnd = parseMaybeDate(timelineEndDate);

    if (trialStart || trialEnd) {
      const fallbackAnchor = startOfDay(new Date());
      const minStart = datedRows.length
        ? datedRows.reduce((min, row) => (row.start! < min ? row.start! : min), datedRows[0].start!)
        : fallbackAnchor;
      const maxEnd = datedRows.length
        ? datedRows.reduce((max, row) => (row.end! > max ? row.end! : max), datedRows[0].end!)
        : addDays(fallbackAnchor, 21);
      const startBase = trialStart ? startOfDay(trialStart) : minStart;
      const rawEndBase = trialEnd ? startOfDay(trialEnd) : maxEnd;
      const endBase = rawEndBase < startBase ? startBase : rawEndBase;
      const start = addDays(startBase, -2);
      const end = addDays(endBase, 2);
      return { start, end, totalDays: Math.max(1, diffDays(start, end) + 1) };
    }

    if (!datedRows.length) {
      const today = startOfDay(new Date());
      const start = addDays(today, -3);
      const end = addDays(today, 21);
      return { start, end, totalDays: diffDays(start, end) + 1 };
    }
    const minStart = datedRows.reduce((min, row) => (row.start! < min ? row.start! : min), datedRows[0].start!);
    const maxEnd = datedRows.reduce((max, row) => (row.end! > max ? row.end! : max), datedRows[0].end!);
    const start = addDays(minStart, -2);
    const end = addDays(maxEnd, 2);
    return { start, end, totalDays: Math.max(1, diffDays(start, end) + 1) };
  }, [timelineRows, timelineStartDate, timelineEndDate]);

  const timelineDays = useMemo(
    () =>
      Array.from({ length: timelineBounds.totalDays }, (_, index) => {
        const date = addDays(timelineBounds.start, index);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        return { index, date, isWeekend };
      }),
    [timelineBounds]
  );

  const timelineWeekSegments = useMemo(() => {
    const segments: Array<{ startIndex: number; span: number; label: string }> = [];
    if (!timelineDays.length) return segments;
    let cursor = 0;
    while (cursor < timelineDays.length) {
      const current = timelineDays[cursor];
      const weekStart = startOfDay(current.date);
      const dayOfWeek = weekStart.getDay() === 0 ? 7 : weekStart.getDay();
      const remainingInWeek = 8 - dayOfWeek;
      const span = Math.min(remainingInWeek, timelineDays.length - cursor);
      const weekLabel = `W${getISOWeek(weekStart)} · ${weekStart.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`;
      segments.push({ startIndex: cursor, span, label: weekLabel });
      cursor += span;
    }
    return segments;
  }, [timelineDays]);

  const todayIndex = useMemo(() => {
    const today = startOfDay(new Date());
    const index = diffDays(timelineBounds.start, today);
    if (index < 0 || index >= timelineBounds.totalDays) return null;
    return index;
  }, [timelineBounds]);

  const timelineWidth = timelineBounds.totalDays * TIMELINE_DAY_WIDTH;

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

  function getPhaseColor(color: string) {
    if (color?.startsWith("#")) return color;
    const colorMap: Record<string, string> = {
      blue: "#3B82F6",
      green: "#10B981",
      yellow: "#F59E0B",
      red: "#EF4444",
      purple: "#8B5CF6",
    };
    return colorMap[color] || "#6B7280";
  }

  const handleViewChange = (next: "list" | "timeline" | "canvas") => {
    if (!view) {
      setInternalView(next);
    }
    onViewChange?.(next);
    logEvent({
      eventType: "feature_used",
      action: "change_view",
      entityType: "task_scaffold",
      payload: { view: next },
    });
  };

  const canZoomIn = timelineDayWidth < TIMELINE_DAY_WIDTH_MAX;
  const canZoomOut = timelineDayWidth > TIMELINE_DAY_WIDTH_MIN;

  const handleZoomIn = () => {
    setTimelineDayWidth((current) => Math.min(TIMELINE_DAY_WIDTH_MAX, current + TIMELINE_DAY_WIDTH_STEP));
    logEvent({
      eventType: "feature_used",
      action: "timeline_zoom_in",
      entityType: "task_scaffold",
      payload: { dayWidth: Math.min(TIMELINE_DAY_WIDTH_MAX, timelineDayWidth + TIMELINE_DAY_WIDTH_STEP) },
    });
  };

  const handleZoomOut = () => {
    setTimelineDayWidth((current) => Math.max(TIMELINE_DAY_WIDTH_MIN, current - TIMELINE_DAY_WIDTH_STEP));
    logEvent({
      eventType: "feature_used",
      action: "timeline_zoom_out",
      entityType: "task_scaffold",
      payload: { dayWidth: Math.max(TIMELINE_DAY_WIDTH_MIN, timelineDayWidth - TIMELINE_DAY_WIDTH_STEP) },
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
    <div className="flex gap-4 h-full min-h-0 overflow-hidden">
      {/* Left Panel: Protocol Map */}
      <div className="w-80 h-full bg-white rounded-lg border border-gray-200 p-6 overflow-y-auto">
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
                  onSelectOnly={() => selectOnlySection(section.id)}
                  onOpenSource={() => onOpenProtocolPage?.(section.pageStart, section.name)}
                  onEdit={() => toast("Edit section: " + section.name)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Right Panel: Task Scaffold */}
      <div className="flex-1 bg-white rounded-lg border border-gray-200 flex flex-col h-full min-h-0 overflow-hidden">
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
          <div className="flex items-end justify-between border-b border-gray-200">
            <div className="flex items-center gap-1">
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
            {activeView === "timeline" ? (
              <div className="pb-2 text-xs text-gray-500">
                Showing {timelineRows.length} task{timelineRows.length === 1 ? "" : "s"} in Gantt timeline view.
              </div>
            ) : activeView === "list" ? (
              <div className="pb-2 text-xs text-gray-500">
                Showing {visibleTaskCount} of {totalTaskCount} task{totalTaskCount === 1 ? "" : "s"}
                {selectedSectionList.length > 0 ? " from selected protocol sections" : ""}
              </div>
            ) : null}
          </div>
        </div>

        {/* Content Area */}
        <div
          className={
            activeView === "timeline"
              ? "flex-1 min-h-0 overflow-hidden p-0"
              : "flex-1 min-h-0 overflow-y-auto p-6"
          }
        >
          {activeView === "list" && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTaskDragEnd}
            >
              <div className="space-y-4">
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
            <div className="h-full min-h-0 flex flex-col">
              {sectionFilterBadges ? <div className="px-6 py-3 border-b border-gray-100">{sectionFilterBadges}</div> : null}
              {timelineRows.length === 0 ? (
                <div className="mx-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-600">
                  No scheduled tasks available for the selected protocol scope.
                </div>
              ) : (
                <div className="relative border-y border-gray-200 bg-white flex-1 min-h-[420px] overflow-hidden rounded-none">
                  <div className="absolute right-2 top-2 z-40 flex flex-col rounded-md border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <button
                      type="button"
                      onClick={handleZoomIn}
                      disabled={!canZoomIn}
                      className="h-7 w-7 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Zoom in timeline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleZoomOut}
                      disabled={!canZoomOut}
                      className="h-7 w-7 border-t border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Zoom out timeline"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="h-full overflow-auto">
                    <div style={{ minWidth: TIMELINE_NAME_COL_WIDTH + timelineWidth }}>
                      <div className="sticky top-0 z-30 bg-white border-b border-gray-200">
                        <div
                          className="grid"
                          style={{
                            gridTemplateColumns: `${TIMELINE_NAME_COL_WIDTH}px ${timelineWidth}px`,
                          }}
                        >
                          <div className="sticky left-0 z-40 bg-white border-r border-gray-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Task / Phase
                          </div>
                          <div className="relative">
                            <div className="flex border-b border-gray-100">
                              {timelineWeekSegments.map((segment, index) => (
                                <div
                                  key={`week-${index}`}
                                  className="h-7 px-2 text-[11px] text-gray-500 border-r border-gray-100 flex items-center"
                                  style={{ width: segment.span * TIMELINE_DAY_WIDTH }}
                                >
                                  {segment.label}
                                </div>
                              ))}
                            </div>
                            <div className="flex">
                              {timelineDays.map((day) => (
                                <div
                                  key={`day-head-${day.index}`}
                                  className={`h-9 border-r border-gray-100 px-1.5 flex flex-col items-center justify-center text-[10px] ${
                                    day.isWeekend ? "bg-gray-50 text-gray-400" : "text-gray-600"
                                  }`}
                                  style={{ width: TIMELINE_DAY_WIDTH }}
                                >
                                  <span>{day.date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}</span>
                                  <span className="font-medium">{day.date.getDate()}</span>
                                </div>
                              ))}
                            </div>
                            {todayIndex !== null ? (
                              <div
                                className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-400"
                                style={{ left: todayIndex * TIMELINE_DAY_WIDTH + TIMELINE_DAY_WIDTH / 2 }}
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div>
                        {timelineRows.map((row) => {
                          const startIndex = row.start ? diffDays(timelineBounds.start, row.start) : null;
                          const barLeft = startIndex !== null ? startIndex * TIMELINE_DAY_WIDTH + 4 : 0;
                          const barWidth = Math.max(44, row.spanDays * TIMELINE_DAY_WIDTH - 8);
                          const barBackground = hexToRgba(row.phaseColor, 0.14);
                          const barBorder = hexToRgba(row.phaseColor, 0.42);
                          return (
                            <div
                              key={`timeline-${row.task.id}`}
                              className="grid border-b border-gray-100 last:border-b-0"
                              style={{
                                gridTemplateColumns: `${TIMELINE_NAME_COL_WIDTH}px ${timelineWidth}px`,
                                minHeight: 62,
                              }}
                            >
                              <div
                                className="sticky left-0 z-20 bg-white border-r border-gray-200 px-4 py-2.5 cursor-pointer"
                                onClick={() => onEditTask(row.task.id)}
                              >
                                <div className="text-sm font-medium text-gray-900 truncate">{row.task.name}</div>
                                <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-1.5">
                                  <span>{row.phaseName}</span>
                                  {row.start ? (
                                    <span>
                                      {row.start.toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                      {row.end && row.end.getTime() !== row.start.getTime()
                                        ? ` → ${row.end.toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                          })}`
                                        : ""}
                                    </span>
                                  ) : (
                                    <span className="text-gray-400">Unscheduled</span>
                                  )}
                                </div>
                              </div>

                              <div className="relative">
                                {timelineDays.map((day) =>
                                  day.isWeekend ? (
                                    <div
                                      key={`weekend-${row.task.id}-${day.index}`}
                                      className="absolute top-0 bottom-0 bg-gray-50"
                                      style={{
                                        left: day.index * TIMELINE_DAY_WIDTH,
                                        width: TIMELINE_DAY_WIDTH,
                                      }}
                                    />
                                  ) : null
                                )}
                                <div
                                  className="absolute inset-y-0 left-0 right-0"
                                  style={{
                                    backgroundImage: `repeating-linear-gradient(to right, transparent, transparent ${TIMELINE_DAY_WIDTH - 1}px, #f1f5f9 ${TIMELINE_DAY_WIDTH - 1}px, #f1f5f9 ${TIMELINE_DAY_WIDTH}px)`,
                                  }}
                                />
                                {todayIndex !== null ? (
                                  <div
                                    className="pointer-events-none absolute top-0 bottom-0 w-px bg-red-400 z-20"
                                    style={{ left: todayIndex * TIMELINE_DAY_WIDTH + TIMELINE_DAY_WIDTH / 2 }}
                                  />
                                ) : null}
                                {startIndex !== null ? (
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onEditTask(row.task.id)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        onEditTask(row.task.id);
                                      }
                                    }}
                                    className="absolute top-1/2 -translate-y-1/2 h-7 rounded-md border px-2.5 text-[11px] font-medium flex items-center truncate z-10"
                                    style={{
                                      left: barLeft,
                                      width: barWidth,
                                      backgroundColor: barBackground,
                                      borderColor: barBorder,
                                      color: row.phaseColor,
                                      cursor: "pointer",
                                    }}
                                    title={`${row.task.name}: ${row.start?.toLocaleDateString()}${
                                      row.end ? ` - ${row.end.toLocaleDateString()}` : ""
                                    }`}
                                  >
                                    <span className="truncate">
                                      {row.task.priority ? `${row.task.priority.toUpperCase()} · ` : ""}
                                      {row.task.assignedRole
                                        ? row.task.assignedRole.replace(/_/g, " ").toUpperCase()
                                        : "TASK"}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="absolute inset-0 flex items-center px-3 text-xs text-gray-400">
                                    Unscheduled task
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
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
                          <div
                            key={`canvas-task-${task.id}`}
                            className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 cursor-pointer hover:border-blue-200 hover:bg-blue-50/40 transition-colors"
                            onClick={() => onEditTask(task.id)}
                          >
                            <div className="text-sm text-gray-900">{task.name}</div>
                            {(task.protocolReference?.section || task.protocolReference?.page) && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenProtocolPage?.(
                                    task.protocolReference?.page ?? null,
                                    task.protocolReference?.section || task.name
                                  )
                                }}
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
