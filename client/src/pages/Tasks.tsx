import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  KanbanSquare,
  ListChecks,
  Network,
  CalendarRange,
  ArrowRight,
  Filter,
  Search,
  X,
  ArrowLeft,
  Plus,
  Trash2,
  ListTodo,
  PlayCircle,
  AlertTriangle,
  PauseCircle,
  CheckCircle2,
  CircleDot,
  Maximize2,
  Check,
  SkipForward,
  XCircle,
  Minus,
  MousePointer2,
  Hand,
  PenLine,
  StickyNote,
  Square,
  Circle,
  Type,
  Link2,
  GripVertical,
  User,
  Link as LinkIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import type {
  ExecutionMap,
  Phase,
  Task,
  TaskDependency,
  TaskStatus,
  ProtocolMapSection,
  MapStatus,
  TaskCategory,
  TaskPriority,
} from "@/types/map";
import { KANBAN_COLUMNS_ACTIVE, KANBAN_COLUMNS_WIZARD, VALID_STATUS_TRANSITIONS } from "@/types/map";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type TaskManagerView = "kanban" | "timeline" | "list" | "wall";

type LoadedMapPayload = {
  map: ExecutionMap;
  phases: Phase[];
  tasks: Task[];
  dependencies: TaskDependency[];
  transitions: Array<Record<string, unknown>>;
  protocolMapSections: ProtocolMapSection[];
};

const ALL_SCOPE = "all";

const STATUS_LABELS: Record<TaskStatus, string> = {
  suggested: "Suggested",
  confirmed: "Confirmed",
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  waiting: "Waiting",
  done: "Done",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<TaskStatus, string> = {
  suggested: "bg-slate-100 text-slate-700",
  confirmed: "bg-blue-100 text-blue-700",
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  waiting: "bg-violet-100 text-violet-700",
  done: "bg-emerald-100 text-emerald-700",
  skipped: "bg-zinc-100 text-zinc-600",
  cancelled: "bg-zinc-100 text-zinc-600",
};

const STATUS_HEADER_PILL: Record<TaskStatus, string> = {
  suggested: "bg-slate-100 text-slate-700",
  confirmed: "bg-blue-100 text-blue-700",
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  blocked: "bg-red-100 text-red-700",
  waiting: "bg-violet-100 text-violet-700",
  done: "bg-emerald-100 text-emerald-700",
  skipped: "bg-zinc-100 text-zinc-600",
  cancelled: "bg-zinc-100 text-zinc-600",
};

const STATUS_COLUMN_ICON: Record<TaskStatus, LucideIcon> = {
  suggested: CircleDot,
  confirmed: Check,
  todo: ListTodo,
  in_progress: PlayCircle,
  blocked: AlertTriangle,
  waiting: PauseCircle,
  done: CheckCircle2,
  skipped: SkipForward,
  cancelled: XCircle,
};

const TASK_STATUS_OPTIONS: TaskStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "waiting",
  "done",
  "skipped",
  "cancelled",
];

const TASK_PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];

const TASK_CATEGORY_OPTIONS: TaskCategory[] = [
  "consent",
  "eligibility",
  "lab_sample",
  "vital_signs",
  "imaging",
  "drug_administration",
  "assessment",
  "questionnaire",
  "data_entry",
  "coordination",
  "documentation",
  "follow_up",
  "safety_reporting",
  "regulatory",
  "custom",
];

const ASSIGNED_ROLE_OPTIONS = [
  "pi",
  "sub_i",
  "crc",
  "nurse",
  "pharmacist",
  "lab_tech",
  "data_manager",
  "regulatory_coordinator",
  "study_coordinator",
  "custom",
] as const;

type TaskModalMode = "create" | "edit";

type TaskFormState = {
  title: string;
  description: string;
  trialId: string;
  phaseId: string;
  category: TaskCategory;
  status: TaskStatus;
  priority: TaskPriority;
  assignedRole: string;
  assigneeMemberId: string;
  dueDate: string;
  sourceSection: string;
  sourcePage: string;
  sourceText: string;
};

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function dayDiff(a: Date, b: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / oneDay);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getISOWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getPhaseColor(color?: string | null): string {
  if (!color) return "#3B82F6";
  if (String(color).startsWith("#")) return String(color);
  const colorMap: Record<string, string> = {
    blue: "#3B82F6",
    green: "#10B981",
    yellow: "#F59E0B",
    red: "#EF4444",
    purple: "#8B5CF6",
  };
  return colorMap[String(color).toLowerCase()] || "#3B82F6";
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = String(hex || "").replace("#", "");
  if (normalized.length !== 6) return `rgba(59, 130, 246, ${alpha})`;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function inferPhaseOffsetDays(phaseName: string, phaseIndex: number): number {
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
  if (week) return (Math.max(1, Number(week[1])) - 1) * 7;

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
}

function inferPhaseTimingWindow(phaseName: string, phaseIndex: number, contextText?: string) {
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
}

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(["done", "skipped", "cancelled"]);

function getTaskDeadline(task: Task): Date | null {
  return parseDate(task.dueDate) || parseDate(task.suggestedDate);
}

function getDeadlineState(task: Task) {
  if (TERMINAL_TASK_STATUSES.has(task.status)) return null;
  const deadline = getTaskDeadline(task);
  if (!deadline) return { label: "No deadline", className: "bg-gray-100 text-gray-600", overdue: false };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const delta = dayDiff(today, dueDay);

  if (delta < 0) {
    return {
      label: `Overdue ${Math.abs(delta)}d`,
      className: "bg-red-100 text-red-700",
      overdue: true,
    };
  }
  if (delta === 0) {
    return { label: "Due today", className: "bg-amber-100 text-amber-700", overdue: false };
  }
  if (delta <= 3) {
    return { label: `Due in ${delta}d`, className: "bg-blue-100 text-blue-700", overdue: false };
  }
  return {
    label: `Due ${deadline.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    className: "bg-slate-100 text-slate-700",
    overdue: false,
  };
}

function toStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] || status;
}

function toDateLabel(value?: string | null): string {
  const parsed = parseDate(value);
  if (!parsed) return "No date";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function toDateInputValue(value?: string | null): string {
  const parsed = parseDate(value);
  if (!parsed) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapStatusLabel(status: MapStatus): string {
  if (status === "active") return "Active";
  if (status === "draft") return "Draft";
  if (status === "revised") return "Revised";
  return "Archived";
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

function titleCase(value: string): string {
  if (!value) return value;
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Tasks() {
  const [location, setLocation] = useLocation();
  const { getCurrentDataMode, state } = useDemoState();
  const currentDataMode = getCurrentDataMode();

  const params = useMemo(() => {
    const raw = location.includes("?") ? location.split("?")[1] : "";
    return new URLSearchParams(raw);
  }, [location]);

  const trialFromQuery = params.get("trialId")?.toLowerCase() ?? ALL_SCOPE;
  const filterFromQuery = params.get("filter")?.toLowerCase() ?? "";

  const [view, setView] = useState<TaskManagerView>("kanban");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [teamAssignmentVersion, setTeamAssignmentVersion] = useState(0);
  const sampleSeedSyncAttemptedRef = useRef(false);
  const [trialScope, setTrialScope] = useState<string>(trialFromQuery || ALL_SCOPE);
  const [statusFilter, setStatusFilter] = useState<string>(filterFromQuery || "all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState<TaskModalMode>("create");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [dependencyTaskIds, setDependencyTaskIds] = useState<string[]>([]);
  const [isWallFullscreenOpen, setIsWallFullscreenOpen] = useState(false);
  const [isWallFullscreenVisible, setIsWallFullscreenVisible] = useState(false);
  const [timelineDayWidth, setTimelineDayWidth] = useState(56);
  const [wallTool, setWallTool] = useState<
    "select" | "pan" | "pen" | "note" | "rect" | "circle" | "text" | "link" | "node" | "add"
  >("pan");
  const [wallTransform, setWallTransform] = useState({ scale: 1, x: 72, y: 56 });
  const [wallIsPanning, setWallIsPanning] = useState(false);
  const wallViewportRef = useRef<HTMLDivElement | null>(null);
  const wallPanStartRef = useRef<{ pointerX: number; pointerY: number; originX: number; originY: number } | null>(
    null
  );
  const wallInitializedRef = useRef(false);
  const [taskForm, setTaskForm] = useState<TaskFormState>({
    title: "",
    description: "",
    trialId: "",
    phaseId: "",
    category: "custom",
    status: "todo",
    priority: "medium",
    assignedRole: "",
    assigneeMemberId: "",
    dueDate: "",
    sourceSection: "",
    sourcePage: "",
    sourceText: "",
  });

  useEffect(() => {
    setTrialScope(trialFromQuery || ALL_SCOPE);
  }, [trialFromQuery]);

  useEffect(() => {
    setStatusFilter(filterFromQuery || "all");
  }, [filterFromQuery]);

  useEffect(() => {
    if (searchOpen) {
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
      });
    }
  }, [searchOpen]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (!event.key.startsWith(`trial-team:${currentDataMode}:`)) return;
      setTeamAssignmentVersion((version) => version + 1);
    };
    const onTeamUpdated = () => {
      setTeamAssignmentVersion((version) => version + 1);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("trial-team-updated", onTeamUpdated as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("trial-team-updated", onTeamUpdated as EventListener);
    };
  }, [currentDataMode]);

  const { data: trials = [], isLoading: trialsLoading } = trpc.trials.list.useQuery({
    demoMode: currentDataMode,
  });
  const utils = trpc.useUtils();

  const resolvedTrialId = useMemo(() => {
    if (trialScope === ALL_SCOPE) return null;
    const matched = trials.find((trial) => trial.id.toLowerCase() === trialScope.toLowerCase());
    return matched?.id ?? null;
  }, [trialScope, trials]);

  const selectedTrial = useMemo(
    () => (resolvedTrialId ? trials.find((trial) => trial.id === resolvedTrialId) ?? null : null),
    [trials, resolvedTrialId]
  );

  const mapSummaryQuery = trpc.map.getByTrial.useQuery(
    { trialId: resolvedTrialId || "", includeArchived: false, demoMode: currentDataMode },
    { enabled: Boolean(resolvedTrialId) }
  );
  const syncSampleSeedMutation = trpc.demo.loadSampleData.useMutation();

  const mapDetailQuery = trpc.map.load.useQuery(
    { mapId: mapSummaryQuery.data?.id || "" },
    {
      enabled: Boolean(
        resolvedTrialId && mapSummaryQuery.data?.id && mapSummaryQuery.data?.status === "active"
      ),
    }
  );

  const workspaceMapQuery = trpc.map.loadWorkspace.useQuery(
    {
      trialIds: trials.map((trial) => trial.id),
      includeArchived: false,
      demoMode: currentDataMode,
    },
    {
      enabled: trialScope === ALL_SCOPE && trials.length > 0,
    }
  );

  const loadedMaps = useMemo<LoadedMapPayload[]>(() => {
    if (trialScope === ALL_SCOPE) {
      return ((workspaceMapQuery.data as LoadedMapPayload[] | undefined) ?? []).filter(Boolean);
    }
    const single = mapDetailQuery.data as LoadedMapPayload | undefined;
    return single ? [single] : [];
  }, [trialScope, workspaceMapQuery.data, mapDetailQuery.data]);

  const activeLoadedMaps = useMemo(
    () => loadedMaps.filter((entry) => entry.map.status === "active"),
    [loadedMaps]
  );

  useEffect(() => {
    if (currentDataMode !== "sample") return;
    if (trialScope !== ALL_SCOPE) return;
    if (trialsLoading || workspaceMapQuery.isLoading) return;
    if (trials.length === 0) return;
    if (activeLoadedMaps.length > 0) return;
    if (syncSampleSeedMutation.isPending) return;
    if (sampleSeedSyncAttemptedRef.current) return;

    sampleSeedSyncAttemptedRef.current = true;
    void (async () => {
      try {
        const syncResult = await syncSampleSeedMutation.mutateAsync();
        await Promise.all([
          utils.trials.list.invalidate({ demoMode: currentDataMode }),
          utils.documents.list.invalidate(),
          utils.map.loadWorkspace.invalidate(),
          utils.map.getByTrial.invalidate(),
          utils.map.load.invalidate(),
        ]);
        if (syncResult.backfilledOperationalData || syncResult.restoredFromSavedDefault) {
          toast.success("Sample execution plans synced");
        } else {
          toast.message("Sample data already loaded");
        }
      } catch (error) {
        sampleSeedSyncAttemptedRef.current = false;
        console.warn("Failed to sync sample execution plans:", error);
      }
    })();
  }, [
    currentDataMode,
    trialScope,
    trialsLoading,
    workspaceMapQuery.isLoading,
    trials.length,
    activeLoadedMaps.length,
    syncSampleSeedMutation,
    utils.trials.list,
    utils.documents.list,
    utils.map.loadWorkspace,
    utils.map.getByTrial,
    utils.map.load,
  ]);

  const maps = useMemo(() => activeLoadedMaps.map((entry) => entry.map), [activeLoadedMaps]);

  const phases = useMemo(
    () =>
      activeLoadedMaps
        .flatMap((entry) => entry.phases)
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [activeLoadedMaps]
  );

  const tasks = useMemo(() => {
    return activeLoadedMaps
      .flatMap((entry) => entry.tasks)
      .slice()
      .sort((a, b) => {
        if (a.phaseId !== b.phaseId) return a.phaseId.localeCompare(b.phaseId);
        if (a.orderInPhase !== b.orderInPhase) return a.orderInPhase - b.orderInPhase;
        return a.name.localeCompare(b.name);
      });
  }, [activeLoadedMaps]);

  const dependencies = useMemo(
    () => activeLoadedMaps.flatMap((entry) => entry.dependencies),
    [activeLoadedMaps]
  );

  const trialById = useMemo(() => new Map(trials.map((trial) => [trial.id, trial])), [trials]);
  const mapById = useMemo(() => new Map(maps.map((map) => [map.id, map])), [maps]);
  const mapByTrialId = useMemo(() => {
    const lookup = new Map<string, ExecutionMap>();
    for (const map of maps) {
      if (!lookup.has(map.trialId)) lookup.set(map.trialId, map);
    }
    return lookup;
  }, [maps]);
  const teamMemberById = useMemo(
    () => new Map((state.teamMembers || []).map((member) => [String(member.id), member])),
    [state.teamMembers]
  );

  const phaseById = useMemo(() => new Map(phases.map((phase) => [phase.id, phase])), [phases]);

  const taskTrialById = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const task of tasks) {
      const map = mapById.get(task.mapId);
      if (map) lookup.set(task.id, map.trialId);
    }
    return lookup;
  }, [tasks, mapById]);

  const trialTeamMemberIdsByTrial = useMemo(() => {
    const lookup = new Map<string, string[]>();
    if (typeof window === "undefined") return lookup;
    const prefix = `trial-team:${currentDataMode}:`;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      const trialId = key.slice(prefix.length).toLowerCase();
      if (!trialId) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        const ids = parsed.map((entry) => String(entry)).filter(Boolean);
        if (!ids.length) continue;
        const existing = lookup.get(trialId) || [];
        const merged = Array.from(new Set([...existing, ...ids]));
        lookup.set(trialId, merged);
      } catch {
        continue;
      }
    }
    return lookup;
  }, [currentDataMode, teamAssignmentVersion]);

  const normalizeRoleToken = (value?: string | null): string => {
    const token = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!token) return "";
    if (token === "pi" || token.includes("principalinvestigator")) return "pi";
    if (token === "subi" || token === "subinvestigator" || token.includes("subinvestigator")) return "sub_i";
    if (token === "crc" || token.includes("clinicalresearchcoordinator")) return "crc";
    if (token.includes("nurse")) return "nurse";
    if (token.includes("pharmac")) return "pharmacist";
    if (token.includes("lab")) return "lab_tech";
    if (token.includes("datamanager")) return "data_manager";
    if (token.includes("regulatory")) return "regulatory_coordinator";
    if (token.includes("studycoordinator")) return "study_coordinator";
    return token;
  };

  const formatRoleLabel = (role?: string | null): string => {
    const raw = String(role || "").trim().toLowerCase();
    if (!raw) return "Unassigned";
    const alias: Record<string, string> = {
      pi: "PI",
      sub_i: "Sub-I",
      crc: "CRC",
      nurse: "Nurse",
      pharmacist: "Pharmacist",
      lab_tech: "Lab Tech",
      data_manager: "Data Manager",
      regulatory_coordinator: "Regulatory Coordinator",
      study_coordinator: "Study Coordinator",
    };
    return alias[raw] || titleCase(raw);
  };

  const formatMemberRoleLabel = (member?: { role?: string; clinicalRole?: string } | null): string => {
    if (!member) return "";
    const candidate = member.clinicalRole || member.role || "";
    return formatRoleLabel(normalizeRoleToken(candidate) || candidate);
  };

  const resolveOwnerLabel = (task: Task): string => {
    const trialId = (taskTrialById.get(task.id) || resolvedTrialId || "").toLowerCase();
    const assignedIds = trialId ? trialTeamMemberIdsByTrial.get(trialId) || [] : [];
    const assignedMembers = assignedIds
      .map((memberId) => teamMemberById.get(memberId))
      .filter(Boolean) as Array<{ id: string; name: string; role?: string; clinicalRole?: string }>;

    if (task.assignedUserId != null) {
      const direct = assignedMembers.find((member) => {
        const memberId = String(member.id);
        return memberId === String(task.assignedUserId) || memberId === `member-${task.assignedUserId}`;
      });
      if (direct) {
        const roleLabel = formatMemberRoleLabel(direct);
        return roleLabel ? `${direct.name} · ${roleLabel}` : direct.name;
      }
    }

    const taskRoleToken = normalizeRoleToken(task.assignedRole || "");
    if (taskRoleToken) {
      const roleMatched = assignedMembers.filter((member) => {
        const memberRole = member.clinicalRole || member.role || "";
        return normalizeRoleToken(memberRole) === taskRoleToken;
      });
      if (roleMatched.length >= 1) {
        const match = roleMatched[0];
        const roleLabel = formatRoleLabel(task.assignedRole);
        return `${match.name} · ${roleLabel}`;
      }
      return `${formatRoleLabel(task.assignedRole)} - Unassigned`;
    }
    return "Unassigned";
  };

  const assigneeOptions = useMemo(
    () =>
      Array.from(new Set(tasks.map((task) => (task.assignedRole ? String(task.assignedRole) : "unassigned"))).values()).sort(
        (a, b) => a.localeCompare(b)
      ),
    [tasks]
  );
  const priorityOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => String(task.priority || "none"))).values()).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(tasks.map((task) => String(task.category || "none"))).values()).sort((a, b) => a.localeCompare(b)),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    const term = normalize(search);
    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      const taskAssignee = task.assignedRole ? String(task.assignedRole) : "unassigned";
      if (assigneeFilter !== "all" && taskAssignee !== assigneeFilter) return false;
      const taskPriority = String(task.priority || "none");
      if (priorityFilter !== "all" && taskPriority !== priorityFilter) return false;
      const taskCategory = String(task.category || "none");
      if (categoryFilter !== "all" && taskCategory !== categoryFilter) return false;

      if (!term) return true;

      const phaseName = phaseById.get(task.phaseId)?.name || "";
      const trialId = taskTrialById.get(task.id) || "";
      const trial = trialById.get(trialId);
      const trialText = `${trial?.investigationalProduct || trial?.title || ""} ${trial?.sponsor || ""}`;
      const protocolText = (task.protocolRefs || [])
        .map((ref) => [ref.section, ref.extractedText, ref.page].filter(Boolean).join(" "))
        .join(" ");

      const haystack = normalize(
        [
          task.name,
          task.description || "",
          task.assignedRole || "",
          task.priority,
          task.status,
          phaseName,
          trialText,
          protocolText,
        ]
          .filter(Boolean)
          .join(" ")
      );

      return haystack.includes(term);
    });
  }, [
    tasks,
    search,
    statusFilter,
    assigneeFilter,
    priorityFilter,
    categoryFilter,
    phaseById,
    taskTrialById,
    trialById,
  ]);

  const filteredTaskIds = useMemo(() => new Set(filteredTasks.map((task) => task.id)), [filteredTasks]);

  const visibleDependencies = useMemo(
    () =>
      dependencies.filter(
        (dependency) =>
          filteredTaskIds.has(dependency.sourceTaskId) && filteredTaskIds.has(dependency.targetTaskId)
      ),
    [dependencies, filteredTaskIds]
  );

  const statusesForKanban = useMemo(() => {
    const anyActiveMap = maps.some((map) => map.status === "active");
    const base = anyActiveMap ? KANBAN_COLUMNS_ACTIVE : KANBAN_COLUMNS_WIZARD;
    const extras = Array.from(new Set(filteredTasks.map((task) => task.status))).filter(
      (status) => !base.includes(status)
    );
    return [...base, ...(extras as TaskStatus[])];
  }, [maps, filteredTasks]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const status of statusesForKanban) grouped[status] = [];
    for (const task of filteredTasks) {
      if (!grouped[task.status]) grouped[task.status] = [];
      grouped[task.status].push(task);
    }
    return grouped;
  }, [filteredTasks, statusesForKanban]);

  const TIMELINE_DAY_WIDTH = timelineDayWidth;
  const TIMELINE_DAY_WIDTH_MIN = 36;
  const TIMELINE_DAY_WIDTH_MAX = 96;
  const TIMELINE_DAY_WIDTH_STEP = 8;
  const TIMELINE_NAME_COL_WIDTH = 340;
  const WALL_ZOOM_MIN = 0.6;
  const WALL_ZOOM_MAX = 2;
  const WALL_ZOOM_STEP = 0.1;
  const wallZoom = wallTransform.scale;
  const canWallZoomIn = wallZoom < WALL_ZOOM_MAX;
  const canWallZoomOut = wallZoom > WALL_ZOOM_MIN;

  const phaseIndexById = useMemo(() => {
    const lookup = new Map<string, number>();
    phases
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .forEach((phase, index) => {
        lookup.set(phase.id, index);
      });
    return lookup;
  }, [phases]);

  const taskIndexInPhaseById = useMemo(() => {
    const lookup = new Map<string, number>();
    phases.forEach((phase) => {
      filteredTasks
        .filter((task) => task.phaseId === phase.id)
        .slice()
        .sort((a, b) => a.orderInPhase - b.orderInPhase || a.name.localeCompare(b.name))
        .forEach((task, index) => {
          lookup.set(task.id, index);
        });
    });
    return lookup;
  }, [filteredTasks, phases]);

  const timelineRows = useMemo(() => {
    const explicitTaskDates = filteredTasks
      .flatMap((task) => [parseDate(task.startDate), parseDate(task.suggestedDate), parseDate(task.dueDate)])
      .filter(Boolean) as Date[];
    const explicitPhaseDates = phases
      .flatMap((phase) => [parseDate(phase.windowStart), parseDate(phase.windowEnd), parseDate(phase.estimatedDate)])
      .filter(Boolean) as Date[];
    const anchorCandidates = [...explicitTaskDates, ...explicitPhaseDates];
    const anchorDate = anchorCandidates.length
      ? startOfDay(
          anchorCandidates.reduce((min, current) => (current < min ? current : min), anchorCandidates[0])
        )
      : startOfDay(new Date());

    return filteredTasks
      .map((task) => {
        const phase = phaseById.get(task.phaseId) || null;
        const phaseName = phase?.name || "Unassigned phase";
        const phaseIndex = phase ? (phaseIndexById.get(phase.id) ?? 0) : 0;
        const taskContextText = (task.protocolRefs || [])
          .map((ref) => `${String(ref.section || "")} ${String(ref.extractedText || "")}`)
          .join(" ");
        const timing = inferPhaseTimingWindow(phaseName, phaseIndex, taskContextText);
        const explicitStart = parseDate(task.startDate) || parseDate(task.suggestedDate);
        const explicitDue = parseDate(task.dueDate);
        const phaseWindowStart = parseDate(phase?.windowStart);
        const phaseWindowEnd = parseDate(phase?.windowEnd);
        const phaseEstimatedDate = parseDate(phase?.estimatedDate);
        const phaseTaskIndex = taskIndexInPhaseById.get(task.id) ?? 0;
        const staggerDays = Math.floor(phaseTaskIndex / 6);
        const fallbackStart = addDays(anchorDate, timing.startOffset + staggerDays);
        const fallbackEnd = addDays(anchorDate, timing.endOffset + staggerDays);
        const explicitAnchor = explicitStart || explicitDue || phaseEstimatedDate || phaseWindowStart || phaseWindowEnd;
        const relativeStartOffset = timing.startOffset - timing.anchorOffset;
        const relativeEndOffset = timing.endOffset - timing.anchorOffset;
        const explicitWindowStart = explicitAnchor
          ? addDays(startOfDay(explicitAnchor), relativeStartOffset)
          : null;
        const explicitWindowEnd = explicitAnchor
          ? addDays(startOfDay(explicitAnchor), relativeEndOffset)
          : null;

        let start = startOfDay(explicitWindowStart || explicitStart || phaseWindowStart || fallbackStart);
        let endCandidate = explicitDue
          ? startOfDay(explicitDue)
          : explicitWindowEnd
          ? explicitWindowEnd
          : phaseWindowEnd
          ? startOfDay(phaseWindowEnd)
          : fallbackEnd >= fallbackStart
          ? fallbackEnd
          : start;

        if (phaseWindowStart) {
          const windowStart = startOfDay(phaseWindowStart);
          if (start < windowStart) start = windowStart;
        }
        if (phaseWindowEnd) {
          const windowEnd = startOfDay(phaseWindowEnd);
          if (endCandidate > windowEnd) endCandidate = windowEnd;
        }

        if (endCandidate < start) {
          const fallbackDurationDays = Math.max(
            1,
            Math.ceil((Math.max(30, Number(task.estimatedDuration || 30)) || 30) / 480)
          );
          endCandidate = addDays(start, fallbackDurationDays - 1);
        }

        const end = endCandidate < start ? start : endCandidate;
        const spanDays = start && end ? Math.max(1, dayDiff(start, end) + 1) : 0;
        return {
          task,
          phase,
          start,
          end,
          spanDays,
          phaseColor: getPhaseColor(phase?.color),
          ts: start ? start.getTime() : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => {
        const phaseSort = (a.phase?.displayOrder ?? 999) - (b.phase?.displayOrder ?? 999);
        if (phaseSort !== 0) return phaseSort;
        if (a.ts !== b.ts) return a.ts - b.ts;
        if (a.task.orderInPhase !== b.task.orderInPhase) return a.task.orderInPhase - b.task.orderInPhase;
        return a.task.name.localeCompare(b.task.name);
      });
  }, [filteredTasks, phaseById, phases, phaseIndexById, taskIndexInPhaseById]);

  const timelineBounds = useMemo(() => {
    const datedRows = timelineRows.filter((row) => row.start && row.end);
    if (!datedRows.length) {
      const today = startOfDay(new Date());
      const start = addDays(today, -3);
      const end = addDays(today, 21);
      return { start, end, totalDays: dayDiff(start, end) + 1 };
    }
    const minStart = datedRows.reduce((min, row) => (row.start! < min ? row.start! : min), datedRows[0].start!);
    const maxEnd = datedRows.reduce((max, row) => (row.end! > max ? row.end! : max), datedRows[0].end!);
    const start = addDays(minStart, -2);
    const end = addDays(maxEnd, 2);
    return { start, end, totalDays: Math.max(1, dayDiff(start, end) + 1) };
  }, [timelineRows]);

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
    const index = dayDiff(timelineBounds.start, today);
    if (index < 0 || index >= timelineBounds.totalDays) return null;
    return index;
  }, [timelineBounds]);

  const timelineWidth = timelineBounds.totalDays * TIMELINE_DAY_WIDTH;
  const canZoomIn = timelineDayWidth < TIMELINE_DAY_WIDTH_MAX;
  const canZoomOut = timelineDayWidth > TIMELINE_DAY_WIDTH_MIN;

  const phaseTaskColumns = useMemo(() => {
    return phases
      .map((phase) => {
        const phaseTasks = filteredTasks
          .filter((task) => task.phaseId === phase.id)
          .sort((a, b) => a.orderInPhase - b.orderInPhase);
        return {
          phase,
          tasks: phaseTasks,
        };
      })
      .filter((entry) => entry.tasks.length > 0);
  }, [filteredTasks, phases]);

  const wallLayout = useMemo(() => {
    const nodeWidth = 235;
    const nodeHeight = 72;
    const lanePaddingX = 18;
    const laneHeaderHeight = 44;
    const laneTopPadding = 62;
    const phaseGap = 315;
    const taskGap = 104;
    const laneXStart = 52;
    const laneY = 28;
    const nodeXOffset = lanePaddingX;
    const nodeYStart = laneY + laneTopPadding;
    const laneWidth = nodeWidth + lanePaddingX * 2;

    const nodes: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      task: Task;
      phase: Phase;
    }> = [];
    const phaseLanes: Array<{
      id: string;
      phase: Phase;
      x: number;
      y: number;
      width: number;
      height: number;
      taskCount: number;
    }> = [];

    const indexByTask = new Map<
      string,
      { x: number; y: number; width: number; height: number; phaseId: string; taskIndex: number }
    >();

    phaseTaskColumns.forEach(({ phase, tasks: phaseTasks }, phaseIndex) => {
      const laneX = laneXStart + phaseIndex * phaseGap;
      const laneTaskCount = Math.max(1, phaseTasks.length);
      const laneHeight = laneTopPadding + laneTaskCount * taskGap + 24;

      phaseLanes.push({
        id: phase.id,
        phase,
        x: laneX,
        y: laneY,
        width: laneWidth,
        height: laneHeight,
        taskCount: phaseTasks.length,
      });

      phaseTasks.forEach((task, taskIndex) => {
        const x = laneX + nodeXOffset;
        const y = nodeYStart + taskIndex * taskGap;
        nodes.push({ id: task.id, x, y, width: nodeWidth, height: nodeHeight, task, phase });
        indexByTask.set(task.id, { x, y, width: nodeWidth, height: nodeHeight, phaseId: phase.id, taskIndex });
      });
    });

    const edges: Array<{ id: string; path: string; type: "dependency" | "sequence" }> = [];
    const edgeIdSet = new Set<string>();

    for (const dependency of visibleDependencies) {
      const source = indexByTask.get(dependency.sourceTaskId);
      const target = indexByTask.get(dependency.targetTaskId);
      if (!source || !target) continue;

      const samePhase = source.phaseId === target.phaseId;
      const sourceCenterX = source.x + source.width / 2;
      const targetCenterX = target.x + target.width / 2;
      const sx = samePhase ? sourceCenterX : source.x + source.width;
      const sy = samePhase ? source.y + source.height : source.y + source.height / 2;
      const tx = samePhase ? targetCenterX : target.x;
      const ty = samePhase ? target.y : target.y + target.height / 2;

      let path: string;
      if (samePhase) {
        const midY = sy + Math.max(18, (ty - sy) / 2);
        path = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
      } else {
        const bend = Math.max(52, (tx - sx) / 2);
        path = `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`;
      }

      const edgeId = dependency.id || `${dependency.sourceTaskId}->${dependency.targetTaskId}`;
      if (edgeIdSet.has(edgeId)) continue;
      edgeIdSet.add(edgeId);
      edges.push({ id: edgeId, path, type: "dependency" });
    }

    phaseTaskColumns.forEach(({ phase, tasks: phaseTasks }) => {
      for (let i = 0; i < phaseTasks.length - 1; i += 1) {
        const source = indexByTask.get(phaseTasks[i].id);
        const target = indexByTask.get(phaseTasks[i + 1].id);
        if (!source || !target) continue;
        const edgeId = `seq:${phase.id}:${phaseTasks[i].id}->${phaseTasks[i + 1].id}`;
        if (edgeIdSet.has(edgeId)) continue;
        const sx = source.x + source.width / 2;
        const sy = source.y + source.height;
        const tx = target.x + target.width / 2;
        const ty = target.y;
        const midY = sy + Math.max(12, (ty - sy) / 2);
        const path = `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
        edges.push({ id: edgeId, path, type: "sequence" });
      }
    });

    const contentWidth = Math.max(1200, phaseTaskColumns.length * phaseGap + laneXStart + 220);
    const tallestColumn = phaseTaskColumns.reduce((max, entry) => Math.max(max, entry.tasks.length), 0);
    const contentHeight = Math.max(620, laneY + laneTopPadding + Math.max(1, tallestColumn) * taskGap + 120);

    return { nodes, edges, phaseLanes, contentWidth, contentHeight };
  }, [phaseTaskColumns, visibleDependencies]);

  const resetWallView = () => {
    const viewport = wallViewportRef.current;
    if (!viewport) {
      setWallTransform({ scale: 1, x: 72, y: 56 });
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const paddedWidth = Math.max(320, rect.width - 96);
    const paddedHeight = Math.max(280, rect.height - 96);
    const fitScale = Math.min(paddedWidth / wallLayout.contentWidth, paddedHeight / wallLayout.contentHeight);
    const scale = Math.max(WALL_ZOOM_MIN, Math.min(1, fitScale));
    const x = Math.max(20, (rect.width - wallLayout.contentWidth * scale) / 2);
    const y = Math.max(20, (rect.height - wallLayout.contentHeight * scale) / 2);
    setWallTransform({
      scale: Math.round(scale * 100) / 100,
      x: Math.round(x),
      y: Math.round(y),
    });
  };

  const updateWallZoom = (delta: number, focus?: { x: number; y: number }) => {
    setWallTransform((current) => {
      const targetScale = Math.min(WALL_ZOOM_MAX, Math.max(WALL_ZOOM_MIN, current.scale + delta));
      const nextScale = Math.round(targetScale * 100) / 100;
      if (nextScale === current.scale) return current;

      const viewport = wallViewportRef.current;
      const rect = viewport?.getBoundingClientRect();
      const focusX = focus?.x ?? (rect ? rect.width / 2 : 0);
      const focusY = focus?.y ?? (rect ? rect.height / 2 : 0);
      const worldX = (focusX - current.x) / current.scale;
      const worldY = (focusY - current.y) / current.scale;

      return {
        scale: nextScale,
        x: Math.round(focusX - worldX * nextScale),
        y: Math.round(focusY - worldY * nextScale),
      };
    });
  };

  useEffect(() => {
    if (view !== "wall") return;
    if (wallInitializedRef.current) return;
    resetWallView();
    wallInitializedRef.current = true;
  }, [view, wallLayout.contentWidth, wallLayout.contentHeight]);

  useEffect(() => {
    wallInitializedRef.current = false;
  }, [trialScope, statusFilter, assigneeFilter, priorityFilter, categoryFilter, search]);

  useEffect(() => {
    if (!isWallFullscreenOpen || typeof window === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsWallFullscreenVisible(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isWallFullscreenOpen]);

  useEffect(() => {
    if (!isWallFullscreenOpen || isWallFullscreenVisible || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      setIsWallFullscreenOpen(false);
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [isWallFullscreenOpen, isWallFullscreenVisible]);

  const openWallFullscreen = () => {
    if (isWallFullscreenOpen) return;
    setIsWallFullscreenOpen(true);
    if (typeof window === "undefined") {
      setIsWallFullscreenVisible(true);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setIsWallFullscreenVisible(true);
      });
    });
  };

  const topMetrics = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter((task) => task.status === "done").length;
    const blocked = filteredTasks.filter((task) => task.status === "blocked").length;
    const overdue = filteredTasks.filter((task) => Boolean(getDeadlineState(task)?.overdue)).length;
    const dueSoon = filteredTasks.filter((task) => {
      if (TERMINAL_TASK_STATUSES.has(task.status)) return false;
      const due = getTaskDeadline(task);
      if (!due) return false;
      const delta = dayDiff(new Date(), due);
      return delta >= 0 && delta <= 7;
    }).length;

    return { total, completed, blocked, overdue, dueSoon };
  }, [filteredTasks]);

  const isLoading =
    trialsLoading ||
    (trialScope === ALL_SCOPE
      ? workspaceMapQuery.isLoading
      : mapSummaryQuery.isLoading || mapDetailQuery.isLoading);

  const updateTaskRouteParams = (next: { trialScope?: string; status?: string }) => {
    const routeParams = new URLSearchParams();
    const nextScope = next.trialScope !== undefined ? next.trialScope : trialScope;
    const nextStatus = next.status !== undefined ? next.status : statusFilter;

    if (nextScope && nextScope !== ALL_SCOPE) routeParams.set("trialId", nextScope);
    if (nextStatus && nextStatus !== "all") routeParams.set("filter", nextStatus);

    const query = routeParams.toString();
    setLocation(query ? `/tasks?${query}` : "/tasks");
  };

  const getTrialLabelForTask = (taskId: string): string => {
    const trialId = taskTrialById.get(taskId) || "";
    const trial = trialById.get(trialId);
    return trial ? trial.investigationalProduct || trial.title : "Trial";
  };

  const activeTrialOptions = useMemo(
    () => trials.filter((trial) => mapByTrialId.has(trial.id)),
    [trials, mapByTrialId]
  );

  const defaultCreateTrialId = useMemo(() => {
    if (resolvedTrialId && mapByTrialId.has(resolvedTrialId)) return resolvedTrialId;
    return activeTrialOptions[0]?.id ?? "";
  }, [resolvedTrialId, mapByTrialId, activeTrialOptions]);

  const selectedMapForTaskForm = useMemo(
    () => (taskForm.trialId ? mapByTrialId.get(taskForm.trialId) ?? null : null),
    [taskForm.trialId, mapByTrialId]
  );

  const phaseOptionsForTaskForm = useMemo(
    () =>
      selectedMapForTaskForm
        ? phases
            .filter((phase) => phase.mapId === selectedMapForTaskForm.id)
            .slice()
            .sort((a, b) => a.displayOrder - b.displayOrder)
        : [],
    [phases, selectedMapForTaskForm]
  );

  const assignedMembersForTaskFormTrial = useMemo(() => {
    const trialId = taskForm.trialId.toLowerCase();
    if (!trialId) return [];
    const memberIds = trialTeamMemberIdsByTrial.get(trialId) || [];
    return memberIds
      .map((memberId) => teamMemberById.get(memberId))
      .filter(Boolean) as Array<{ id: string; name: string; role?: string; clinicalRole?: string }>;
  }, [taskForm.trialId, trialTeamMemberIdsByTrial, teamMemberById]);

  const dependencyCandidates = useMemo(() => {
    if (!selectedMapForTaskForm) return [];
    return tasks
      .filter((task) => task.mapId === selectedMapForTaskForm.id && task.id !== editingTaskId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, selectedMapForTaskForm, editingTaskId]);

  useEffect(() => {
    if (!taskModalOpen || !selectedMapForTaskForm) return;
    if (phaseOptionsForTaskForm.length === 0) return;
    const hasSelectedPhase = phaseOptionsForTaskForm.some((phase) => phase.id === taskForm.phaseId);
    if (!hasSelectedPhase) {
      setTaskForm((prev) => ({ ...prev, phaseId: phaseOptionsForTaskForm[0].id }));
    }
  }, [taskModalOpen, selectedMapForTaskForm, phaseOptionsForTaskForm, taskForm.phaseId]);

  const changeTaskStatusMutation = trpc.map.changeTaskStatus.useMutation({
    onSuccess: async () => {
      if (trialScope === ALL_SCOPE) {
        await utils.map.loadWorkspace.invalidate();
      } else {
        if (mapSummaryQuery.data?.id) {
          await utils.map.load.invalidate({ mapId: mapSummaryQuery.data.id });
        }
        if (resolvedTrialId) {
          await utils.map.getByTrial.invalidate({ trialId: resolvedTrialId, includeArchived: false });
        }
      }
    },
    onError: (error) => {
      toast.error(`Failed to move task: ${error.message}`);
    },
  });

  const createTaskMutation = trpc.map.createTask.useMutation();
  const updateTaskMutation = trpc.map.updateTask.useMutation();
  const moveTaskMutation = trpc.map.moveTask.useMutation();
  const removeTaskMutation = trpc.map.removeTask.useMutation();
  const addDependencyMutation = trpc.map.addDependency.useMutation();
  const removeDependencyMutation = trpc.map.removeDependency.useMutation();

  const isTaskModalSaving =
    createTaskMutation.isPending ||
    updateTaskMutation.isPending ||
    moveTaskMutation.isPending ||
    removeTaskMutation.isPending ||
    addDependencyMutation.isPending ||
    removeDependencyMutation.isPending;

  const invalidateTaskData = async () => {
    await Promise.all([
      utils.map.loadWorkspace.invalidate(),
      utils.map.load.invalidate(),
      utils.map.getByTrial.invalidate(),
      utils.trials.getContext.invalidate(),
    ]);
  };

  const toIsoDateTime = (value: string): string | null => {
    if (!value) return null;
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const openCreateTaskModal = () => {
    if (!defaultCreateTrialId) {
      toast.error("No active trial map available. Confirm & launch a plan first.");
      return;
    }
    const map = mapByTrialId.get(defaultCreateTrialId);
    const initialPhase =
      phases
        .filter((phase) => phase.mapId === map?.id)
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)[0]?.id ?? "";
    setTaskModalMode("create");
    setEditingTaskId(null);
    setDependencyTaskIds([]);
    setTaskForm({
      title: "",
      description: "",
      trialId: defaultCreateTrialId,
      phaseId: initialPhase,
      category: "custom",
      status: "todo",
      priority: "medium",
      assignedRole: "",
      assigneeMemberId: "",
      dueDate: "",
      sourceSection: "",
      sourcePage: "",
      sourceText: "",
    });
    setTaskModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    const trialId = taskTrialById.get(task.id) || "";
    const sourceRef = (task.protocolRefs || [])[0] as unknown as Record<string, unknown> | undefined;
    const sourcePageRaw = sourceRef?.page;
    const sourcePage =
      typeof sourcePageRaw === "number"
        ? String(sourcePageRaw)
        : typeof sourcePageRaw === "string"
        ? sourcePageRaw
        : "";
    const membersForTrial = (trialId
      ? (trialTeamMemberIdsByTrial.get(trialId.toLowerCase()) || [])
          .map((memberId) => teamMemberById.get(memberId))
          .filter(Boolean)
      : []) as Array<{ id: string; name: string; role?: string; clinicalRole?: string }>;
    const memberForAssignee = membersForTrial.find(
      (member) => member.name === (task.suggestedAssignee || "") || String(member.id) === String(task.assignedUserId || "")
    );
    const predecessorTaskIds = dependencies
      .filter((dep) => dep.targetTaskId === task.id)
      .map((dep) => dep.sourceTaskId);

    setTaskModalMode("edit");
    setEditingTaskId(task.id);
    setDependencyTaskIds(predecessorTaskIds);
    setTaskForm({
      title: task.name || "",
      description: task.description || "",
      trialId,
      phaseId: task.phaseId,
      category: (task.category as TaskCategory) || "custom",
      status: (task.status as TaskStatus) || "todo",
      priority: (task.priority as TaskPriority) || "medium",
      assignedRole: String(task.assignedRole || ""),
      assigneeMemberId: memberForAssignee ? String(memberForAssignee.id) : "",
      dueDate: toDateInputValue(task.dueDate || task.suggestedDate),
      sourceSection: String(sourceRef?.section || ""),
      sourcePage,
      sourceText: String(sourceRef?.extractedText || ""),
    });
    setTaskModalOpen(true);
  };

  const syncTaskDependencies = async (mapId: string, targetTaskId: string, selectedSourceTaskIds: string[]) => {
    const existingDeps = dependencies.filter((dep) => dep.targetTaskId === targetTaskId);
    const existingSourceSet = new Set(existingDeps.map((dep) => dep.sourceTaskId));
    const selectedSourceSet = new Set(selectedSourceTaskIds);

    const toAdd = selectedSourceTaskIds.filter((taskId) => !existingSourceSet.has(taskId));
    const toRemove = existingDeps.filter((dep) => !selectedSourceSet.has(dep.sourceTaskId));

    for (const sourceTaskId of toAdd) {
      await addDependencyMutation.mutateAsync({
        mapId,
        sourceTaskId,
        targetTaskId,
        dependencyType: "finish_to_start",
      });
    }

    for (const dep of toRemove) {
      await removeDependencyMutation.mutateAsync({ dependencyId: dep.id });
    }
  };

  const handleSaveTaskModal = async () => {
    const title = taskForm.title.trim();
    if (!title) {
      toast.error("Task title is required.");
      return;
    }
    const trialId = taskForm.trialId;
    if (!trialId) {
      toast.error("Trial is required.");
      return;
    }
    const map = mapByTrialId.get(trialId);
    if (!map || map.status !== "active") {
      toast.error("This trial has no active execution map yet. Confirm & launch first.");
      return;
    }
    if (!taskForm.phaseId) {
      toast.error("Phase / visit is required.");
      return;
    }

    const selectedMember = assignedMembersForTaskFormTrial.find(
      (member) => String(member.id) === taskForm.assigneeMemberId
    );
    const assignedRole = taskForm.assignedRole ? (taskForm.assignedRole as (typeof ASSIGNED_ROLE_OPTIONS)[number]) : null;
    const dueDateIso = toIsoDateTime(taskForm.dueDate);
    const pageNumber = Number(taskForm.sourcePage);
    const hasSource =
      Boolean(taskForm.sourceSection.trim()) ||
      Boolean(taskForm.sourceText.trim()) ||
      (Number.isFinite(pageNumber) && pageNumber > 0);
    const protocolRefs = hasSource
      ? [
          {
            section: taskForm.sourceSection.trim() || "Protocol",
            ...(Number.isFinite(pageNumber) && pageNumber > 0 ? { page: Math.round(pageNumber) } : {}),
            ...(taskForm.sourceText.trim() ? { extractedText: taskForm.sourceText.trim() } : {}),
          },
        ]
      : [];

    try {
      if (taskModalMode === "create") {
        const created = await createTaskMutation.mutateAsync({
          mapId: map.id,
          phaseId: taskForm.phaseId,
          task: {
            name: title,
            description: taskForm.description.trim() || undefined,
            category: taskForm.category,
            status: taskForm.status,
            priority: taskForm.priority,
            assignedRole,
            assignedUserId: null,
            suggestedAssignee: selectedMember?.name || null,
            suggestedDate: dueDateIso,
            dueDate: dueDateIso,
            createdBy: "user",
            isCustom: true,
            protocolRefs,
            tags: [],
          },
        });
        await syncTaskDependencies(map.id, created.id, dependencyTaskIds);
        toast.success("Task created.");
      } else {
        const taskId = editingTaskId;
        const existing = taskId ? tasks.find((task) => task.id === taskId) : null;
        if (!taskId || !existing) {
          toast.error("Task not found.");
          return;
        }
        await updateTaskMutation.mutateAsync({
          taskId,
          updates: {
            name: title,
            description: taskForm.description.trim() || "",
            category: taskForm.category,
            priority: taskForm.priority,
            assignedRole,
            assignedUserId: null,
            suggestedAssignee: selectedMember?.name || null,
            suggestedDate: dueDateIso,
            dueDate: dueDateIso,
            protocolRefs,
            isCustom: true,
            createdBy: "user",
          },
        });
        if (existing.status !== taskForm.status) {
          await changeTaskStatusMutation.mutateAsync({
            taskId,
            status: taskForm.status,
            ...(taskForm.status === "blocked" ? { reason: "Blocked from task editor" } : {}),
          });
        }
        if (existing.phaseId !== taskForm.phaseId) {
          const nextOrder = tasks.filter((task) => task.phaseId === taskForm.phaseId).length;
          await moveTaskMutation.mutateAsync({
            taskId,
            phaseId: taskForm.phaseId,
            orderInPhase: nextOrder,
          });
        }
        await syncTaskDependencies(map.id, taskId, dependencyTaskIds);
        toast.success("Task updated.");
      }
      await invalidateTaskData();
      setTaskModalOpen(false);
      setEditingTaskId(null);
    } catch (error: any) {
      toast.error(error?.message || "Failed to save task.");
    }
  };

  const handleDeleteTaskFromModal = async () => {
    if (!editingTaskId) return;
    const task = tasks.find((item) => item.id === editingTaskId);
    if (!task) return;
    const confirmed = window.confirm(`Delete "${task.name}"?`);
    if (!confirmed) return;
    try {
      await removeTaskMutation.mutateAsync({ taskId: editingTaskId });
      await invalidateTaskData();
      setTaskModalOpen(false);
      setEditingTaskId(null);
      toast.success("Task deleted.");
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete task.");
    }
  };

  const handleDropToStatus = async (nextStatus: TaskStatus) => {
    if (!draggingTaskId || changeTaskStatusMutation.isPending) {
      setDragOverStatus(null);
      return;
    }
    const task = tasks.find((item) => item.id === draggingTaskId);
    if (!task) {
      setDragOverStatus(null);
      return;
    }
    if (task.status === nextStatus) {
      setDragOverStatus(null);
      return;
    }
    const allowed = VALID_STATUS_TRANSITIONS[task.status] || [];
    if (!allowed.includes(nextStatus)) {
      toast.error(`Cannot move from ${toStatusLabel(task.status)} to ${toStatusLabel(nextStatus)}.`);
      setDragOverStatus(null);
      return;
    }
    try {
      await changeTaskStatusMutation.mutateAsync({
        taskId: task.id,
        status: nextStatus,
        ...(nextStatus === "blocked" ? { reason: "Blocked via Kanban board" } : {}),
      });
      toast.success(`Moved to ${toStatusLabel(nextStatus)}.`);
    } finally {
      setDragOverStatus(null);
      setDraggingTaskId(null);
    }
  };

  const renderKanban = () => (
    <div className="h-full min-h-0 flex flex-col pb-2">
      <div className="shrink-0 flex items-center justify-end pb-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50"
          onClick={() => toast.info("Custom columns are coming soon.")}
        >
          <Plus className="h-3.5 w-3.5" />
          Add column
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div
          className="grid h-full min-w-[980px] gap-4"
          style={{ gridTemplateColumns: `repeat(${statusesForKanban.length}, minmax(220px, 1fr))` }}
        >
        {statusesForKanban.map((status) => {
          const ColumnIcon = STATUS_COLUMN_ICON[status] || CircleDot;
          return (
            <div
              key={status}
              className={`h-full min-h-0 rounded-lg border bg-white transition-colors flex flex-col ${
                dragOverStatus === status ? "border-blue-300 bg-blue-50/30" : "border-gray-200"
              }`}
              onDragOver={(event) => {
                if (!draggingTaskId) return;
                event.preventDefault();
                if (dragOverStatus !== status) setDragOverStatus(status);
              }}
              onDragLeave={() => {
                if (dragOverStatus === status) setDragOverStatus(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                void handleDropToStatus(status);
              }}
            >
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${STATUS_HEADER_PILL[status]}`}
                  >
                    <ColumnIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide truncate">
                    {toStatusLabel(status)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{tasksByStatus[status]?.length || 0}</span>
                </div>
              </div>
            <div className="flex-1 min-h-0 p-3 space-y-2 overflow-y-auto">
              {(tasksByStatus[status] || []).map((task) => {
                const phase = phaseById.get(task.phaseId);
                const dependencyCount = visibleDependencies.filter(
                  (dep) => dep.targetTaskId === task.id || dep.sourceTaskId === task.id
                ).length;
                const deadlineState = getDeadlineState(task);
                return (
                  <div
                    key={task.id}
                    className={`rounded-md border bg-white p-3 cursor-grab active:cursor-grabbing transition-shadow hover:shadow-md ${
                      draggingTaskId === task.id ? "border-blue-300 shadow-sm" : "border-gray-200"
                    }`}
                    draggable={!changeTaskStatusMutation.isPending}
                    onClick={() => openEditTaskModal(task)}
                    onDragStart={() => {
                      setDraggingTaskId(task.id);
                    }}
                    onDragEnd={() => {
                      setDraggingTaskId(null);
                      setDragOverStatus(null);
                    }}
                  >
                    <div className="text-sm font-medium text-gray-900">{task.name}</div>
                    <div className="text-xs text-gray-500 mt-1">{phase?.name || "Unassigned phase"}</div>
                    {trialScope === ALL_SCOPE ? (
                      <div className="text-[11px] text-blue-700 mt-1">{getTrialLabelForTask(task.id)}</div>
                    ) : null}
                    <div className="text-[11px] text-gray-600 mt-1">
                      Owner: {resolveOwnerLabel(task)}
                    </div>
                    <div className="text-[11px] text-gray-600 mt-1">Column: {toStatusLabel(status)}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {deadlineState ? (
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${deadlineState.className}`}>
                          {deadlineState.label}
                        </span>
                      ) : null}
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[task.status]}`}
                      >
                        {toStatusLabel(task.status)}
                      </span>
                      {task.priority ? (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                          {task.priority}
                        </span>
                      ) : null}
                      {dependencyCount > 0 ? (
                        <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                          {dependencyCount} deps
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {(tasksByStatus[status] || []).length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-200 px-3 py-6 text-center text-xs text-gray-500">
                  No tasks
                </div>
              ) : null}
            </div>
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );

  const renderTimeline = () => (
    <div className="h-full rounded-lg border border-gray-200 bg-white overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 text-xs text-gray-500 flex items-center justify-between gap-3">
        <span>
          Showing {timelineRows.length} task{timelineRows.length === 1 ? "" : "s"} in Gantt timeline view.
        </span>
        <span>
          {timelineBounds.start.toLocaleDateString("en-US")} to {timelineBounds.end.toLocaleDateString("en-US")}
        </span>
      </div>
      {timelineRows.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center px-4 text-center text-sm text-gray-500">
          No timeline-ready tasks for this filter.
        </div>
      ) : (
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <div className="absolute right-2 top-2 z-40 flex flex-col rounded-md border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setTimelineDayWidth((current) => Math.min(TIMELINE_DAY_WIDTH_MAX, current + TIMELINE_DAY_WIDTH_STEP))}
              disabled={!canZoomIn}
              className="h-7 w-7 flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Zoom in timeline"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTimelineDayWidth((current) => Math.max(TIMELINE_DAY_WIDTH_MIN, current - TIMELINE_DAY_WIDTH_STEP))}
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
                          key={`tm-week-${index}`}
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
                          key={`tm-day-${day.index}`}
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
                  const startIndex = row.start ? dayDiff(timelineBounds.start, row.start) : null;
                  const barLeft = startIndex !== null ? startIndex * TIMELINE_DAY_WIDTH + 4 : 0;
                  const barWidth = Math.max(44, Math.max(1, row.spanDays) * TIMELINE_DAY_WIDTH - 8);
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
                        onClick={() => openEditTaskModal(row.task)}
                      >
                        <div className="text-sm font-medium text-gray-900 truncate">{row.task.name}</div>
                        <div className="text-xs text-gray-500 mt-1 flex flex-wrap items-center gap-1.5">
                          <span>{row.phase?.name || "Unassigned phase"}</span>
                          {row.start ? (
                            <span>
                              {row.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              {row.end && row.end.getTime() !== row.start.getTime()
                                ? ` → ${row.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                                : ""}
                            </span>
                          ) : (
                            <span className="text-gray-400">Unscheduled</span>
                          )}
                          {trialScope === ALL_SCOPE ? <span>{getTrialLabelForTask(row.task.id)}</span> : null}
                        </div>
                      </div>

                      <div className="relative">
                        {timelineDays.map((day) =>
                          day.isWeekend ? (
                            <div
                              key={`tm-weekend-${row.task.id}-${day.index}`}
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
                            onClick={() => openEditTaskModal(row.task)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openEditTaskModal(row.task);
                              }
                            }}
                            className="absolute top-1/2 -translate-y-1/2 h-7 rounded-md border px-2.5 text-[11px] font-medium flex items-center truncate z-10 cursor-pointer"
                            style={{
                              left: barLeft,
                              width: barWidth,
                              backgroundColor: barBackground,
                              borderColor: barBorder,
                              color: row.phaseColor,
                            }}
                            title={`${row.task.name}: ${row.start?.toLocaleDateString()}${
                              row.end ? ` - ${row.end.toLocaleDateString()}` : ""
                            }`}
                          >
                            <span className="truncate">
                              {row.task.priority ? `${row.task.priority.toUpperCase()} · ` : ""}
                              {row.task.assignedRole ? formatRoleLabel(row.task.assignedRole) : "TASK"}
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
  );

  const renderList = () => (
    <div className="h-full rounded-lg border border-gray-200 bg-white overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto px-4 py-4 md:px-6 md:py-5">
        <div className="space-y-4">
          {phaseTaskColumns.map(({ phase, tasks: phaseTasks }) => (
            <div key={`list-phase-${phase.id}`} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getPhaseColor(phase.color) }} />
                <h3 className="text-sm font-semibold text-gray-900">{phase.name}</h3>
                <span className="text-xs text-gray-500">({phaseTasks.length})</span>
              </div>

              <div className="space-y-2">
                {phaseTasks.map((task) => {
                  const dependencyCount = visibleDependencies.filter((dep) => dep.targetTaskId === task.id).length;
                  const deadlineState = getDeadlineState(task);
                  const primaryRef = (task.protocolRefs || [])[0];
                  return (
                    <div
                      key={`list-task-${task.id}`}
                      onClick={() => openEditTaskModal(task)}
                      className="group flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 transition-all hover:shadow-sm cursor-pointer"
                    >
                      <GripVertical className="h-4 w-4 text-gray-300 shrink-0" />

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-gray-900">{task.name}</div>
                        {task.description ? (
                          <div className="mt-1 truncate text-xs text-gray-500">{task.description}</div>
                        ) : null}
                        {trialScope === ALL_SCOPE ? (
                          <div className="mt-1 text-[11px] text-blue-700 truncate">{getTrialLabelForTask(task.id)}</div>
                        ) : null}

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                            <User className="mr-1 h-3 w-3" />
                            {resolveOwnerLabel(task)}
                          </span>
                          {typeof task.estimatedDuration === "number" ? (
                            <span>⏱ {task.estimatedDuration} min</span>
                          ) : null}
                          {task.priority ? (
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
                          ) : null}
                          {primaryRef?.section || primaryRef?.page ? (
                            <span className="inline-flex items-center gap-1">
                              <LinkIcon className="h-3 w-3" />
                              {primaryRef?.section || "Protocol"}
                              {primaryRef?.page ? ` · p.${primaryRef.page}` : ""}
                            </span>
                          ) : null}
                          {typeof task.aiConfidence === "number" ? (
                            <span>⚡ {task.aiConfidence.toFixed(2)}</span>
                          ) : null}
                          {task.conditionalNote ? (
                            <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-700">
                              ⚠ {task.conditionalNote}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="shrink-0 flex flex-wrap items-center justify-end gap-1.5">
                        {deadlineState ? (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${deadlineState.className}`}>
                            {deadlineState.label}
                          </span>
                        ) : null}
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[task.status]}`}>
                          {toStatusLabel(task.status)}
                        </span>
                        {dependencyCount > 0 ? (
                          <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                            {dependencyCount} deps
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {phaseTaskColumns.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-600">
              No tasks match your filters.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const renderWall = (fullscreen = false) => (
    <div
      className={
        fullscreen
          ? "h-full w-full bg-white flex flex-col"
          : "h-full rounded-lg border border-gray-200 bg-white overflow-hidden flex flex-col"
      }
    >
      <div
        className={`border-b border-gray-100 flex items-center justify-between gap-3 ${
          fullscreen ? "px-6 py-5" : "px-4 py-3"
        }`}
      >
        <div>
          <div className="text-sm font-medium text-gray-800">Themison Wall</div>
          <div className="text-xs text-gray-500">Visual task graph inspired by collaborative whiteboards.</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            Coming soon
          </span>
          <div className="inline-flex items-center rounded-md border border-gray-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => updateWallZoom(-WALL_ZOOM_STEP)}
              disabled={!canWallZoomOut}
              className="h-7 w-7 inline-flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Zoom out wall"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 text-[11px] font-medium text-gray-600 border-x border-gray-200 min-w-[52px] text-center">
              {Math.round(wallZoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => updateWallZoom(WALL_ZOOM_STEP)}
              disabled={!canWallZoomIn}
              className="h-7 w-7 inline-flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Zoom in wall"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={resetWallView}
            className="h-7 px-2.5 text-[11px] rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          >
            Reset
          </button>
          {fullscreen ? (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 transition-colors"
              onClick={() => setIsWallFullscreenVisible(false)}
              aria-label="Close wall fullscreen"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600 transition-colors"
              onClick={openWallFullscreen}
              aria-label="Expand wall"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div
        ref={wallViewportRef}
        className={`relative flex-1 min-h-0 overflow-hidden bg-white ${wallIsPanning ? "cursor-grabbing" : "cursor-grab"}`}
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.ctrlKey || event.metaKey) {
            updateWallZoom(event.deltaY < 0 ? WALL_ZOOM_STEP : -WALL_ZOOM_STEP, {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
            return;
          }
          setWallTransform((current) => ({
            ...current,
            x: Math.round(current.x - event.deltaX),
            y: Math.round(current.y - event.deltaY),
          }));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          if ((event.target as HTMLElement).closest("[data-wall-node='true'], [data-wall-toolbar='true']")) return;
          wallPanStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            originX: wallTransform.x,
            originY: wallTransform.y,
          };
          setWallIsPanning(true);
        }}
        onPointerMove={(event) => {
          const panStart = wallPanStartRef.current;
          if (!panStart) return;
          const dx = event.clientX - panStart.pointerX;
          const dy = event.clientY - panStart.pointerY;
          setWallTransform((current) => ({
            ...current,
            x: Math.round(panStart.originX + dx),
            y: Math.round(panStart.originY + dy),
          }));
        }}
        onPointerUp={() => {
          wallPanStartRef.current = null;
          setWallIsPanning(false);
        }}
        onPointerLeave={() => {
          wallPanStartRef.current = null;
          setWallIsPanning(false);
        }}
      >
        {wallLayout.nodes.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-gray-500">No nodes to render for this filter.</div>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.18) 1px, transparent 0)",
              backgroundSize: `${Math.max(14, Math.round(20 * wallZoom))}px ${Math.max(14, Math.round(20 * wallZoom))}px`,
            }}
          >
            <div
              className="absolute origin-top-left"
              style={{
                width: wallLayout.contentWidth,
                height: wallLayout.contentHeight,
                transform: `translate(${wallTransform.x}px, ${wallTransform.y}px) scale(${wallZoom})`,
              }}
            >
              {wallLayout.phaseLanes.map((lane) => {
                const laneColor = getPhaseColor(lane.phase.color);
                return (
                  <div
                    key={`lane-${lane.id}`}
                    className="absolute rounded-xl border"
                    style={{
                      left: lane.x,
                      top: lane.y,
                      width: lane.width,
                      height: lane.height,
                      borderColor: hexToRgba(laneColor, 0.24),
                      backgroundColor: hexToRgba(laneColor, 0.05),
                    }}
                  >
                    <div
                      className="mx-2 mt-2 rounded-md px-2 py-1 text-[11px] font-semibold flex items-center justify-between"
                      style={{
                        color: laneColor,
                        backgroundColor: hexToRgba(laneColor, 0.14),
                      }}
                    >
                      <span className="truncate pr-2">{lane.phase.name}</span>
                      <span className="shrink-0">{lane.taskCount}</span>
                    </div>
                  </div>
                );
              })}

              <svg className="absolute inset-0" width={wallLayout.contentWidth} height={wallLayout.contentHeight}>
                <defs>
                  <marker id="wall-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#2F6FED" />
                  </marker>
                  <filter id="wall-glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="1.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {wallLayout.edges.map((edge) => (
                  <path
                    key={edge.id}
                    d={edge.path}
                    fill="none"
                    stroke={edge.type === "dependency" ? "#2F6FED" : "#94A3B8"}
                    strokeWidth={edge.type === "dependency" ? 1.9 : 1.25}
                    strokeDasharray={edge.type === "sequence" ? "4 4" : undefined}
                    markerEnd="url(#wall-arrow)"
                    filter={edge.type === "dependency" ? "url(#wall-glow)" : undefined}
                    opacity={edge.type === "dependency" ? 0.92 : 0.78}
                  />
                ))}
              </svg>

              {wallLayout.nodes.map((node) => {
                const stickyBg = hexToRgba(node.phase.color || "#3B82F6", 0.12);
                const stickyBorder = hexToRgba(node.phase.color || "#3B82F6", 0.32);
                const phaseColor = getPhaseColor(node.phase.color);
                return (
                  <div
                    key={node.id}
                    data-wall-node="true"
                    className="absolute rounded-lg border px-3 py-2 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                      backgroundColor: stickyBg,
                      borderColor: stickyBorder,
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => openEditTaskModal(node.task)}
                  >
                    <span
                      className="absolute -left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-white"
                      style={{ backgroundColor: phaseColor }}
                    />
                    <span
                      className="absolute -right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full border-2 border-white"
                      style={{ backgroundColor: phaseColor }}
                    />
                    <div className="text-xs font-semibold text-gray-900 truncate">{node.task.name}</div>
                    <div className="text-[11px] text-gray-600 mt-1 truncate">{node.phase.name}</div>
                    {trialScope === ALL_SCOPE ? (
                      <div className="text-[11px] text-blue-700 truncate">{getTrialLabelForTask(node.task.id)}</div>
                    ) : null}
                    <div className="mt-1">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[node.task.status]}`}
                      >
                        {toStatusLabel(node.task.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
          <div
            data-wall-toolbar="true"
            onPointerDown={(event) => event.stopPropagation()}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-2xl border border-gray-200 bg-white/95 px-2 py-2 shadow-lg backdrop-blur"
          >
            <button
              type="button"
              onClick={() => setWallTool("select")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "select" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Select tool"
            >
              <MousePointer2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWallTool("pan")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "pan" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Pan tool"
            >
              <Hand className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-gray-200" />

            <button
              type="button"
              onClick={() => setWallTool("pen")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "pen" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Pen tool"
            >
              <PenLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWallTool("note")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "note" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Sticky note tool"
            >
              <StickyNote className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-gray-200" />

            <button
              type="button"
              onClick={() => setWallTool("rect")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "rect" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Rectangle tool"
            >
              <Square className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWallTool("circle")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "circle" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Circle tool"
            >
              <Circle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWallTool("text")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "text" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Text tool"
            >
              <Type className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-gray-200" />

            <button
              type="button"
              onClick={() => setWallTool("link")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "link" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Link tool"
            >
              <Link2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWallTool("node")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "node" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Node tool"
            >
              <Network className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-gray-200" />

            <button
              type="button"
              onClick={() => setWallTool("add")}
              className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                wallTool === "add" ? "bg-violet-600 text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
              aria-label="Add tool"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const canAddTask = Boolean(defaultCreateTrialId);
  const canDeleteTask = taskModalMode === "edit" && Boolean(editingTaskId);

  return (
    <>
      <div className="px-8 pb-4 pt-4 h-[calc(100vh-72px)] overflow-hidden flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight mb-2">Task Manager</h1>
          <p className="text-sm text-muted-foreground">
            Unified execution view for tasks created by Study Setup Agent and confirmed for launch.
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 h-11 pl-5 pr-2 py-0 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors pr-5 border-r border-gray-200"
              onClick={() => setLocation("/trial-workspace")}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {[
                { key: "kanban", label: "Kanban Board", icon: KanbanSquare },
                { key: "timeline", label: "Timeline", icon: CalendarRange },
                { key: "list", label: "List", icon: ListChecks },
                { key: "wall", label: "Themison Wall", icon: Network },
              ].map((entry) => {
                const Icon = entry.icon;
                const active = view === entry.key;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setView(entry.key as TaskManagerView)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                      active
                        ? "text-blue-700 bg-blue-50"
                        : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ml-auto">
            <button
              type="button"
              disabled={!canAddTask}
              onClick={openCreateTaskModal}
              className={`inline-flex items-center gap-2 rounded-md h-7 px-3 text-xs border ${
                canAddTask
                  ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                  : "bg-gray-100 text-gray-400 border-gray-200"
              }`}
            >
              <Plus className="h-4 w-4" />
              Add Task
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[180px]"
            value={trialScope}
            onChange={(event) => {
              const nextScope = event.target.value;
              setTrialScope(nextScope);
              updateTaskRouteParams({ trialScope: nextScope });
            }}
            disabled={trialsLoading}
          >
            <option value={ALL_SCOPE}>All Trials</option>
            {trials.map((trial) => (
              <option key={trial.id} value={trial.id.toLowerCase()}>
                {(trial.investigationalProduct || trial.title) + " · " + (trial.sponsor || "No sponsor")}
              </option>
            ))}
          </select>

          <select
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[180px]"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="all">All Assignees</option>
            {assigneeOptions.map((assignee) => (
              <option key={assignee} value={assignee}>
                {assignee === "unassigned" ? "Unassigned" : titleCase(assignee)}
              </option>
            ))}
          </select>

          <select
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[165px]"
            value={statusFilter}
            onChange={(event) => {
              const nextStatus = event.target.value;
              setStatusFilter(nextStatus);
              updateTaskRouteParams({ status: nextStatus });
            }}
          >
            <option value="all">All Statuses</option>
            {Array.from(new Set(tasks.map((task) => task.status))).map((status) => (
              <option key={status} value={status}>
                {toStatusLabel(status)}
              </option>
            ))}
          </select>

          <select
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[170px]"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="all">All Priorities</option>
            {priorityOptions.map((priority) => (
              <option key={priority} value={priority}>
                {priority === "none" ? "Not set" : titleCase(priority)}
              </option>
            ))}
          </select>

          <select
            className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[170px]"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">All Categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category === "none" ? "Not set" : titleCase(category)}
              </option>
            ))}
          </select>

          <div className="ml-auto relative h-8">
            <button
              type="button"
              className="h-8 w-8 inline-flex items-center justify-center text-gray-500 hover:text-gray-700 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
              onClick={() => setSearchOpen((open) => !open)}
              aria-label="Search tasks"
            >
              <Search className="h-4 w-4" />
            </button>

            <div
              className={`absolute right-0 top-0 h-8 overflow-hidden transition-all duration-200 ${
                searchOpen ? "w-[260px] opacity-100" : "w-0 opacity-0 pointer-events-none"
              }`}
            >
              <div className="relative h-8">
                <Search className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title or content"
                  className="h-8 rounded-md border border-gray-200 bg-white text-xs pl-9 pr-8 outline-none focus:outline-none focus:border-gray-200 focus-visible:border-gray-200 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                  onClick={() => {
                    setSearch("");
                    setSearchOpen(false);
                  }}
                  aria-label="Close search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
            Total <span className="font-semibold text-[#2F6FED]">{topMetrics.total}</span>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
            Done <span className="font-semibold text-[#2F6FED]">{topMetrics.completed}</span>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
            Blocked <span className="font-semibold text-[#2F6FED]">{topMetrics.blocked}</span>
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            Overdue <span className="font-semibold text-red-700">{topMetrics.overdue}</span>
          </div>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
            Due 7d <span className="font-semibold text-[#2F6FED]">{topMetrics.dueSoon}</span>
          </div>
          {trialScope !== ALL_SCOPE && mapSummaryQuery.data?.status === "active" ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700">
              {mapStatusLabel(mapSummaryQuery.data.status)} map v{mapSummaryQuery.data.version}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1">
          {isLoading ? (
            <div className="h-full rounded-lg border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">
              Loading execution data...
            </div>
          ) : trialScope === ALL_SCOPE && activeLoadedMaps.length === 0 ? (
            <div className="h-full rounded-lg border border-gray-200 bg-white px-6 py-16 text-center space-y-2">
              <div className="text-sm font-medium text-gray-900">No execution plans across trials yet</div>
              <div className="text-sm text-gray-500">
                Generate and confirm plans in Study Setup Agent, then they will appear here.
              </div>
            </div>
          ) : trialScope !== ALL_SCOPE && !resolvedTrialId ? (
            <div className="h-full rounded-lg border border-gray-200 bg-white px-6 py-16 text-center text-sm text-gray-500">
              Trial not found.
            </div>
          ) : trialScope !== ALL_SCOPE && (!mapSummaryQuery.data || mapSummaryQuery.data.status !== "active") ? (
            <div className="h-full rounded-lg border border-gray-200 bg-white px-6 py-16 text-center space-y-2">
              <div className="text-sm font-medium text-gray-900">No execution plan for this trial yet</div>
              <div className="text-sm text-gray-500">
                Generate and confirm a plan in Study Setup Agent, then it will appear here.
              </div>
              {selectedTrial ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                  onClick={() => setLocation(`/trial/${selectedTrial.id}`)}
                >
                  Open trial workspace <ArrowRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {view === "kanban" ? renderKanban() : null}
              {view === "timeline" ? renderTimeline() : null}
              {view === "list" ? renderList() : null}
              {view === "wall" ? renderWall(false) : null}
            </>
          )}
        </div>
      </div>

      {isWallFullscreenOpen ? (
        <div className="fixed inset-0 z-[70] pointer-events-auto">
          <div
            className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${
              isWallFullscreenVisible ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setIsWallFullscreenVisible(false)}
          />
          <div
            className={`absolute left-0 top-0 h-full w-full bg-white flex flex-col transform-gpu transition-[transform,opacity] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
              isWallFullscreenVisible ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
            }`}
          >
            {renderWall(true)}
          </div>
        </div>
      ) : null}

      <Dialog
        open={taskModalOpen}
        onOpenChange={(open) => {
          if (isTaskModalSaving) return;
          setTaskModalOpen(open);
          if (!open) {
            setEditingTaskId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b border-gray-200">
            <DialogTitle className="text-3xl font-bold text-gray-900">
              {taskModalMode === "create" ? "Create New Task" : "Edit Task"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">Title *</label>
              <Input
                value={taskForm.title}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Enter task title"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">Description</label>
              <Textarea
                rows={4}
                value={taskForm.description}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Enter task description (optional)"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Trial *</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.trialId}
                  disabled={taskModalMode === "edit"}
                  onChange={(event) => {
                    const nextTrialId = event.target.value;
                    const nextMap = mapByTrialId.get(nextTrialId);
                    const nextPhase =
                      phases
                        .filter((phase) => phase.mapId === nextMap?.id)
                        .slice()
                        .sort((a, b) => a.displayOrder - b.displayOrder)[0]?.id ?? "";
                    setTaskForm((prev) => ({
                      ...prev,
                      trialId: nextTrialId,
                      phaseId: nextPhase,
                      assignedRole: "",
                      assigneeMemberId: "",
                    }));
                    setDependencyTaskIds([]);
                  }}
                >
                  <option value="">Select trial</option>
                  {activeTrialOptions.map((trial) => (
                    <option key={trial.id} value={trial.id}>
                      {(trial.investigationalProduct || trial.title) + " · " + (trial.sponsor || "No sponsor")}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Phase / Visit *</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.phaseId}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, phaseId: event.target.value }))}
                >
                  <option value="">Select phase</option>
                  {phaseOptionsForTaskForm.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Category</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.category}
                  onChange={(event) =>
                    setTaskForm((prev) => ({ ...prev, category: event.target.value as TaskCategory }))
                  }
                >
                  {TASK_CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>
                      {titleCase(category)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Status</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.status}
                  onChange={(event) =>
                    setTaskForm((prev) => ({ ...prev, status: event.target.value as TaskStatus }))
                  }
                >
                  {TASK_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {toStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Priority</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.priority}
                  onChange={(event) =>
                    setTaskForm((prev) => ({ ...prev, priority: event.target.value as TaskPriority }))
                  }
                >
                  {TASK_PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {titleCase(priority)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Responsible Role</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.assignedRole}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, assignedRole: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {ASSIGNED_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {formatRoleLabel(role)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Assignee</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={taskForm.assigneeMemberId}
                  onChange={(event) => {
                    const nextMemberId = event.target.value;
                    const member = assignedMembersForTaskFormTrial.find(
                      (candidate) => String(candidate.id) === nextMemberId
                    );
                    const inferredRole = member
                      ? normalizeRoleToken(member.clinicalRole || member.role || "")
                      : "";
                    setTaskForm((prev) => ({
                      ...prev,
                      assigneeMemberId: nextMemberId,
                      assignedRole:
                        inferredRole && ASSIGNED_ROLE_OPTIONS.includes(inferredRole as any)
                          ? inferredRole
                          : prev.assignedRole,
                    }));
                  }}
                >
                  <option value="">Unassigned</option>
                  {assignedMembersForTaskFormTrial.map((member) => (
                    <option key={member.id} value={String(member.id)}>
                      {member.name} · {formatMemberRoleLabel(member)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">Due Date</label>
              <Input
                type="date"
                value={taskForm.dueDate}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, dueDate: event.target.value }))}
              />
            </div>

            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Protocol Source (optional)</h4>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  onClick={() => toast.info("Protocol viewer coming soon.")}
                >
                  Open protocol
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-gray-700">Section</label>
                  <Input
                    value={taskForm.sourceSection}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, sourceSection: event.target.value }))}
                    placeholder="e.g. Schedule of Events"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-700">Page</label>
                  <Input
                    type="number"
                    min={1}
                    value={taskForm.sourcePage}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, sourcePage: event.target.value }))}
                    placeholder="e.g. 22"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-gray-700">Evidence Text</label>
                  <Textarea
                    rows={3}
                    value={taskForm.sourceText}
                    onChange={(event) => setTaskForm((prev) => ({ ...prev, sourceText: event.target.value }))}
                    placeholder="Optional excerpt for traceability"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">Dependencies (predecessor tasks)</h4>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {dependencyCandidates.length === 0 ? (
                  <p className="text-sm text-gray-500">No dependency candidates in this trial map.</p>
                ) : (
                  dependencyCandidates.map((candidate) => {
                    const phase = phaseById.get(candidate.phaseId);
                    const checked = dependencyTaskIds.includes(candidate.id);
                    return (
                      <label key={candidate.id} className="flex items-start gap-2 rounded-md border border-gray-100 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const nextChecked = event.target.checked;
                            setDependencyTaskIds((prev) =>
                              nextChecked ? Array.from(new Set([...prev, candidate.id])) : prev.filter((id) => id !== candidate.id)
                            );
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300"
                        />
                        <span className="text-sm text-gray-800">
                          {candidate.name}
                          <span className="block text-xs text-gray-500">{phase?.name || "Unassigned phase"}</span>
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div>
              {canDeleteTask ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm text-red-600 hover:text-red-700"
                  onClick={handleDeleteTaskFromModal}
                  disabled={isTaskModalSaving}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Task
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-9 rounded-md border border-gray-200 px-4 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  if (isTaskModalSaving) return;
                  setTaskModalOpen(false);
                  setEditingTaskId(null);
                }}
                disabled={isTaskModalSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-[#2F6FED] px-4 text-sm font-medium text-white hover:bg-[#255BD1] disabled:opacity-60"
                onClick={handleSaveTaskModal}
                disabled={isTaskModalSaving}
              >
                {isTaskModalSaving
                  ? "Saving..."
                  : taskModalMode === "create"
                  ? "Create Task"
                  : "Save Changes"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
