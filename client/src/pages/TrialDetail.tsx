/**
 * TrialDetail Component
 * Clinical trial detail page with tabbed workspace sections.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  LayoutGrid,
  Calendar,
  Users as UsersIcon,
  UserCheck,
  Sparkles,
  ChevronDown,
  FolderOpen,
  Wand2,
  Bookmark,
  Bell,
  Settings,
  AlertTriangle,
  Trash2,
  Search,
  Filter,
  Plus,
  Pencil,
  Share2,
  ArrowRight,
  Check,
  Brain,
  Maximize2,
  X,
  User,
} from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { StudySetupWizardEntry } from "@/components/StudySetupWizardEntry";
import Documents from "@/pages/Documents";
import { TaskScaffoldView } from "@/components/TaskScaffoldView";
import { trpc } from "@/lib/trpc";
import { EditableField } from "@/components/EditableField";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";
import { AddMemberPanel } from "@/components/AddMemberPanel";
import { useMapStore } from "@/stores/mapStore";
import type { TaskCategory, TaskPriority, TaskStatus } from "@/types/map";
import studySetupBackground from "@/assets/study-setup-background.svg";

const TRIAL_DETAIL_TAB_IDS = new Set([
  "overview",
  "document-hub",
  "study-setup-wizard",
  "visit-template",
  "bookmarks",
  "team",
  "patients",
  "notifications",
  "settings",
]);

function getInitialTrialDetailTab() {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get("tab") || "").trim();
  if (TRIAL_DETAIL_TAB_IDS.has(fromQuery)) return fromQuery;
  return "overview";
}

const SETUP_TASK_STATUS_OPTIONS: TaskStatus[] = [
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

const SETUP_TASK_PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];

const SETUP_TASK_CATEGORY_OPTIONS: TaskCategory[] = [
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

const SETUP_ASSIGNED_ROLE_OPTIONS = [
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

type SetupTaskModalMode = "create" | "edit";

type SetupTaskFormState = {
  title: string;
  description: string;
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

function titleCase(value: string): string {
  if (!value) return value;
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toDateInputValue(value?: string | Date | null): string {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeRoleToken(value?: string | null): string {
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
}

function formatRoleLabel(role?: string | null): string {
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
}

function toAssignmentMemberShape(member: { id: string; name?: string; role?: string; clinicalRole?: string }) {
  return {
    id: String(member.id),
    name: member.name || "",
    role: member.role || "",
    clinicalRole: member.clinicalRole || "",
  };
}

function parseMemberNumericId(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : null;
  }
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    const rounded = Math.round(asNumber);
    return rounded > 0 ? rounded : null;
  }
  const trailingDigits = raw.match(/(\d+)(?!.*\d)/);
  if (!trailingDigits) return null;
  const parsed = Number.parseInt(trailingDigits[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export default function TrialDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/trial/:id");
  const [activeTab, setActiveTab] = useState(getInitialTrialDetailTab);
  const [isGeneratingScaffold, setIsGeneratingScaffold] = useState(false);
  const [manageTeamOpen, setManageTeamOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [assignedMemberIds, setAssignedMemberIds] = useState<string[]>([]);
  const [sponsorLogoFailed, setSponsorLogoFailed] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isSetupFullscreenOpen, setIsSetupFullscreenOpen] = useState(false);
  const [isSetupFullscreenVisible, setIsSetupFullscreenVisible] = useState(false);
  const [generatedSetupMapId, setGeneratedSetupMapId] = useState<string | null>(null);
  const [setupScaffoldView, setSetupScaffoldView] = useState<"list" | "timeline" | "canvas">("list");
  const [setupTaskModalOpen, setSetupTaskModalOpen] = useState(false);
  const [setupTaskModalMode, setSetupTaskModalMode] = useState<SetupTaskModalMode>("create");
  const [setupEditingTaskId, setSetupEditingTaskId] = useState<string | null>(null);
  const [pendingOpenSetupTaskId, setPendingOpenSetupTaskId] = useState<string | null>(null);
  const [setupDependencyTaskIds, setSetupDependencyTaskIds] = useState<string[]>([]);
  const [isLaunchingExecutionMap, setIsLaunchingExecutionMap] = useState(false);
  const [setupTaskForm, setSetupTaskForm] = useState<SetupTaskFormState>({
    title: "",
    description: "",
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

  const { getCurrentDataMode, state } = useDemoState();
  const currentDataMode = getCurrentDataMode();

  const trialId = (params?.id || "").toLowerCase();
  const isValidTrialId = trialId.length > 0;
  const trialTabStorageKey = trialId ? `trial-active-tab:${currentDataMode}:${trialId}` : null;

  useEffect(() => {
    if (typeof window === "undefined" || !trialTabStorageKey) return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = (params.get("tab") || "").trim();
    const fromStorage = (window.localStorage.getItem(trialTabStorageKey) || "").trim();
    const nextTab = TRIAL_DETAIL_TAB_IDS.has(fromQuery)
      ? fromQuery
      : TRIAL_DETAIL_TAB_IDS.has(fromStorage)
      ? fromStorage
      : "overview";
    setActiveTab(nextTab);
  }, [trialTabStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined" || !trialTabStorageKey) return;
    const normalizedTab = TRIAL_DETAIL_TAB_IDS.has(activeTab) ? activeTab : "overview";
    window.localStorage.setItem(trialTabStorageKey, normalizedTab);

    const params = new URLSearchParams(window.location.search);
    if (normalizedTab === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", normalizedTab);
    }
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activeTab, trialTabStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const openTask = (params.get("openTask") || "").trim();
    if (!openTask) return;
    setPendingOpenSetupTaskId(openTask);
    setActiveTab("study-setup-wizard");
  }, [trialId]);

  const { data: protocols = [] } = trpc.documents.list.useQuery(
    { trialId, demoMode: currentDataMode },
    {
      enabled: isValidTrialId,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: activeTab === "overview" || activeTab === "document-hub" ? 5000 : false,
      refetchIntervalInBackground: true,
    }
  );

  const protocolId = protocols?.[0]?.id;
  const { data: existingScaffold } = trpc.studySetupWizard.getScaffold.useQuery(
    { protocolId: protocolId || 0, demoMode: currentDataMode },
    { enabled: !!protocolId && protocolId > 0 }
  );
  const {
    data: executionMapSummary,
    refetch: refetchExecutionMapSummary,
  } = trpc.map.getByTrial.useQuery(
    { trialId, includeArchived: false, demoMode: currentDataMode },
    { enabled: isValidTrialId }
  );
  const confirmSuggestedMutation = trpc.map.confirmSuggested.useMutation();
  const launchMapMutation = trpc.map.launch.useMutation();

  const map = useMapStore((store) => store.map);
  const mapPhases = useMapStore((store) => store.phases);
  const mapTasks = useMapStore((store) => store.tasks);
  const mapDependencies = useMapStore((store) => store.dependencies);
  const mapSections = useMapStore((store) => store.protocolMapSections);
  const loadExecutionMap = useMapStore((store) => store.loadMap);
  const addExecutionTask = useMapStore((store) => store.addTask);
  const updateExecutionTask = useMapStore((store) => store.updateTask);
  const removeExecutionTask = useMapStore((store) => store.removeTask);
  const reorderExecutionTasks = useMapStore((store) => store.reorderTasks);
  const moveExecutionTask = useMapStore((store) => store.moveTask);
  const addExecutionDependency = useMapStore((store) => store.addDependency);
  const removeExecutionDependency = useMapStore((store) => store.removeDependency);

  const bootstrapGuardRef = useRef<string | null>(null);
  const generationRunRef = useRef<number>(0);
  const cancelledGenerationRunsRef = useRef<Set<number>>(new Set());
  const normalizedMapTrialId = String(map?.trialId || "").toLowerCase();
  const isCurrentTrialExecutionMap =
    Boolean(map?.id) &&
    Boolean(executionMapSummary?.id) &&
    map?.id === executionMapSummary?.id &&
    normalizedMapTrialId === trialId;

  const scopedMapPhases = isCurrentTrialExecutionMap ? mapPhases : [];
  const scopedMapTasks = isCurrentTrialExecutionMap ? mapTasks : [];
  const scopedMapDependencies = isCurrentTrialExecutionMap ? mapDependencies : [];
  const scopedMapSections = isCurrentTrialExecutionMap ? mapSections : [];
  const setupMapStatus = isCurrentTrialExecutionMap ? map?.status : executionMapSummary?.status;
  const isSetupPlanLaunched = setupMapStatus === "active";

  const { data: trial } = trpc.trials.getById.useQuery(
    { id: trialId, demoMode: currentDataMode },
    { enabled: isValidTrialId }
  );
  const { data: trialContext } = trpc.trials.getContext.useQuery(
    {
      id: trialId,
      demoMode: currentDataMode,
      include: ["documents", "telemetry", "execution", "suggestions", "insights"],
      pageContext: activeTab,
      emitTelemetry: false,
    },
    {
      enabled: isValidTrialId && (activeTab === "overview" || activeTab === "document-hub"),
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchInterval: activeTab === "overview" || activeTab === "document-hub" ? 5000 : false,
      refetchIntervalInBackground: true,
    }
  );

  useEffect(() => {
    if (!isValidTrialId) {
      toast.error("Invalid trial ID");
      navigate("/trial-workspace");
    }
  }, [isValidTrialId, navigate]);

  useEffect(() => {
    if (activeTab !== "study-setup-wizard") {
      setIsSetupFullscreenVisible(false);
      setIsSetupFullscreenOpen(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isSetupFullscreenOpen || typeof window === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSetupFullscreenVisible(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isSetupFullscreenOpen]);

  useEffect(() => {
    if (!isSetupFullscreenOpen || isSetupFullscreenVisible || typeof window === "undefined") return;
    const timeout = window.setTimeout(() => {
      setIsSetupFullscreenOpen(false);
    }, 1400);
    return () => window.clearTimeout(timeout);
  }, [isSetupFullscreenOpen, isSetupFullscreenVisible]);

  const openSetupFullscreen = () => {
    if (isSetupFullscreenOpen) return;
    setIsSetupFullscreenOpen(true);
    if (typeof window === "undefined") {
      setIsSetupFullscreenVisible(true);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setIsSetupFullscreenVisible(true);
      });
    });
  };

  useEffect(() => {
    if (activeTab !== "study-setup-wizard") return;
    if (!isSetupPlanLaunched) return;
    if (!isSetupFullscreenOpen && !isSetupFullscreenVisible) return;
    setIsSetupFullscreenVisible(false);
    setIsSetupFullscreenOpen(false);
  }, [activeTab, isSetupPlanLaunched, isSetupFullscreenOpen, isSetupFullscreenVisible]);

  useEffect(() => {
    if (typeof window === "undefined" || !trialId) return;

    const readAssignedMembers = () => {
      const exactKey = `trial-team:${currentDataMode}:${trialId}`;
      let stored = window.localStorage.getItem(exactKey);

      if (!stored) {
        const prefix = `trial-team:${currentDataMode}:`;
        const trialIdLower = trialId.toLowerCase();
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (!key || !key.startsWith(prefix)) continue;
          const candidateId = key.slice(prefix.length).toLowerCase();
          if (candidateId !== trialIdLower) continue;
          stored = window.localStorage.getItem(key);
          if (stored) break;
        }
      }

      if (!stored) {
        setAssignedMemberIds([]);
        return;
      }
      try {
        const parsed = JSON.parse(stored);
        setAssignedMemberIds(Array.isArray(parsed) ? parsed : []);
      } catch {
        setAssignedMemberIds([]);
      }
    };

    readAssignedMembers();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith(`trial-team:${currentDataMode}:`)) return;
      readAssignedMembers();
    };
    const onTeamUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ trialId?: string; mode?: string }>;
      const eventTrialId = String(customEvent.detail?.trialId || "").toLowerCase();
      const eventMode = String(customEvent.detail?.mode || "");
      if (eventMode && eventMode !== currentDataMode) return;
      if (eventTrialId && eventTrialId !== trialId) return;
      readAssignedMembers();
    };
    const onWindowFocus = () => readAssignedMembers();

    window.addEventListener("storage", onStorage);
    window.addEventListener("trial-team-updated", onTeamUpdated as EventListener);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("trial-team-updated", onTeamUpdated as EventListener);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, [trialId, currentDataMode]);

  useEffect(() => {
    const mapId = executionMapSummary?.id;
    if (!mapId) return;
    if (generatedSetupMapId && generatedSetupMapId === mapId) return;
    void loadExecutionMap(mapId).catch((error) => {
      console.error("Failed to load execution map:", error);
      toast.error("Failed to load execution map");
    });
  }, [executionMapSummary?.id, loadExecutionMap, generatedSetupMapId]);

  const utils = trpc.useUtils();
  const updateTrial = trpc.trials.update.useMutation({
    onSuccess: async () => {
      await utils.trials.getById.invalidate({ id: trialId, demoMode: currentDataMode });
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      await utils.trials.getContext.invalidate({ id: trialId, demoMode: currentDataMode });
      await utils.map.getByTrial.invalidate({ trialId, includeArchived: false, demoMode: currentDataMode });
      if (executionMapSummary?.id) {
        await loadExecutionMap(executionMapSummary.id).catch(() => undefined);
      }
      toast.success("Trial updated");
    },
    onError: (error) => {
      toast.error(`Failed to update trial: ${error.message}`);
    },
  });
  const deleteTrialMutation = trpc.trials.delete.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      await utils.trials.getById.invalidate({ id: trialId, demoMode: currentDataMode });
      await utils.documents.list.invalidate({ trialId, demoMode: currentDataMode });
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(`trial-team:${currentDataMode}:${trialId}`);
      }
      toast.success("Trial deleted");
      navigate("/trial-workspace");
    },
    onError: (error) => {
      toast.error(`Failed to delete trial: ${error.message}`);
    },
  });

  const trialTeamMembers = useMemo(
    () =>
      (state.teamMembers || [])
        .filter((member) => assignedMemberIds.includes(member.id))
        .map((member) => ({
          id: member.id,
          name: member.name,
          role: member.clinicalRole || member.role,
          initials: member.initials,
          avatar: member.avatar || null,
        })),
    [state.teamMembers, assignedMemberIds]
  );
  const scaffoldAssignmentMembers = useMemo(
    () =>
      (state.teamMembers || [])
        .filter((member) => assignedMemberIds.includes(member.id))
        .map(toAssignmentMemberShape),
    [state.teamMembers, assignedMemberIds]
  );
  const fallbackScaffoldAssignmentMembers = useMemo(
    () => (state.teamMembers || []).map(toAssignmentMemberShape),
    [state.teamMembers]
  );
  const effectiveScaffoldAssignmentMembers = useMemo(() => {
    const selected = scaffoldAssignmentMembers;
    const universe = fallbackScaffoldAssignmentMembers;
    const seeded = selected.length > 0 ? selected : universe;
    const membersById = new Map<string, (typeof seeded)[number]>();

    for (const member of seeded) {
      membersById.set(String(member.id), member);
    }

    if (selected.length > 0) {
      const roleToken = (member: { role?: string; clinicalRole?: string }) =>
        normalizeRoleToken(`${member.clinicalRole || ""} ${member.role || ""}`);
      const hasRole = (tokens: string[]) =>
        Array.from(membersById.values()).some((member) => tokens.includes(roleToken(member)));
      const addRoleCoverage = (tokens: string[]) => {
        if (hasRole(tokens)) return;
        const match = universe.find((member) => tokens.includes(roleToken(member)));
        if (match) membersById.set(String(match.id), match);
      };

      addRoleCoverage(["pi", "sub_i"]);
      addRoleCoverage(["crc", "study_coordinator"]);
      addRoleCoverage(["nurse"]);
      addRoleCoverage(["pharmacist", "lab_tech", "data_manager", "regulatory_coordinator"]);
    }

    return Array.from(membersById.values());
  }, [scaffoldAssignmentMembers, fallbackScaffoldAssignmentMembers]);

  const persistAssignedMembers = (nextIds: string[]) => {
    setAssignedMemberIds(nextIds);
    if (typeof window !== "undefined") {
      const storageKey = `trial-team:${currentDataMode}:${trialId}`;
      const payload = JSON.stringify(nextIds);
      window.localStorage.setItem(storageKey, payload);
      window.dispatchEvent(
        new CustomEvent("trial-team-updated", {
          detail: { trialId, mode: currentDataMode },
        })
      );
    }
  };

  const toggleAssignedMember = (memberId: string) => {
    const nextIds = assignedMemberIds.includes(memberId)
      ? assignedMemberIds.filter((id) => id !== memberId)
      : [...assignedMemberIds, memberId];
    persistAssignedMembers(nextIds);
  };

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "document-hub", label: "Document Hub", icon: FolderOpen },
    { id: "study-setup-wizard", label: "Study Setup Agent", icon: Wand2 },
    { id: "visit-template", label: "Visit Template", icon: Calendar },
    { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
    { id: "team", label: "Team", icon: UsersIcon },
    { id: "patients", label: "Patients", icon: UserCheck },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  const mockBookmarks = [
    {
      id: "edc",
      type: "EDC",
      name: "Medidata Rave",
      url: "https://rave.medidata.com",
      notes: "Primary data capture system for this trial.",
    },
    {
      id: "ctms",
      type: "CTMS",
      name: "SiteVault CTMS",
      url: "https://sitevault.com",
      notes: "Subject tracking + visit milestones.",
    },
    {
      id: "etmf",
      type: "eTMF",
      name: "Veeva Vault",
      url: "https://veeva.com/vault",
      notes: "Essential documents + regulatory binder.",
    },
    {
      id: "irt",
      type: "IWRS / IRT",
      name: "4G Clinical",
      url: "https://4gclinical.com",
      notes: "Randomization + drug supply.",
    },
  ];

  const getFaviconUrl = (url: string) => {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
    } catch {
      return "https://www.google.com/s2/favicons?domain=example.com&sz=64";
    }
  };

  const getSponsorLogoDomain = (sponsor?: string | null) => {
    if (!sponsor) return null;
    const normalized = sponsor.toLowerCase();
    const knownDomains: Array<{ match: string; domain: string }> = [
      { match: "novartis", domain: "novartis.com" },
      { match: "roche", domain: "roche.com" },
      { match: "pfizer", domain: "pfizer.com" },
      { match: "astrazeneca", domain: "astrazeneca.com" },
      { match: "johnson", domain: "jnj.com" },
      { match: "takeda", domain: "takeda.com" },
      { match: "biogen", domain: "biogen.com" },
      { match: "sanofi", domain: "sanofi.com" },
      { match: "merck", domain: "merck.com" },
      { match: "eli lilly", domain: "lilly.com" },
      { match: "bayer", domain: "bayer.com" },
      { match: "amgen", domain: "amgen.com" },
      { match: "bristol", domain: "bms.com" },
      { match: "gsk", domain: "gsk.com" },
      { match: "moderna", domain: "modernatx.com" },
      { match: "beigene", domain: "beigene.com" },
    ];

    const exact = knownDomains.find((entry) => normalized.includes(entry.match));
    if (exact) return exact.domain;

    const token = normalized
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .find((part) => part.length > 2);
    if (!token) return null;
    return `${token}.com`;
  };

  const generateScaffold = trpc.studySetupWizard.generateScaffold.useMutation();
  const importLegacyScaffold = trpc.map.importLegacyScaffold.useMutation();

  const autoActivateGeneratedMap = async (mapId: string) => {
    const trialStatus = String(trial?.status || "").toLowerCase();
    const shouldAutoActivate =
      (currentDataMode === "sample" || currentDataMode === "full") &&
      (trialStatus === "active" || trialStatus === "recruiting");

    if (!shouldAutoActivate) {
      return { launched: false, autoConfirmed: 0 };
    }

    try {
      const confirmation = await confirmSuggestedMutation.mutateAsync({ mapId });
      await launchMapMutation.mutateAsync({ mapId });
      await refetchExecutionMapSummary();
      return { launched: true, autoConfirmed: confirmation.updated };
    } catch (error) {
      console.warn("Failed to auto-activate generated execution map:", error);
      return { launched: false, autoConfirmed: 0 };
    }
  };

  const handleGenerateScaffold = async () => {
    if (!protocols || protocols.length === 0) {
      toast.error("No protocol found", {
        description: "Please upload a protocol in the Document Hub first.",
      });
      return;
    }

    if (!trial) return;

    const runId = Date.now();
    generationRunRef.current = runId;
    cancelledGenerationRunsRef.current.delete(runId);
    setGeneratedSetupMapId(null);
    setIsGeneratingScaffold(true);
    logEvent({
      eventType: "trial_setup_started",
      action: "start_generate",
      entityType: "trial",
      entityId: trialId,
      payload: { demoMode: currentDataMode },
      aiInvolved: true,
    });

    try {
      await generateScaffold.mutateAsync({
        protocolId: protocols[0].id,
        trialId: trial.id,
        demoMode: currentDataMode,
      });
      if (cancelledGenerationRunsRef.current.has(runId)) {
        return;
      }
      const imported = await importLegacyScaffold.mutateAsync({
        trialId: trial.id,
        protocolId: protocols[0].id,
        clearExisting: true,
        demoMode: currentDataMode,
        trialStartDate: trial?.startDate ? new Date(trial.startDate).toISOString() : undefined,
        trialEndDate: trial?.endDate ? new Date(trial.endDate).toISOString() : undefined,
        assignmentMembers: effectiveScaffoldAssignmentMembers,
      });
      if (cancelledGenerationRunsRef.current.has(runId)) {
        return;
      }
      const refreshedSummary = await refetchExecutionMapSummary();
      if (cancelledGenerationRunsRef.current.has(runId)) {
        return;
      }
      const resolvedMapId =
        imported?.mapId || refreshedSummary.data?.id || executionMapSummary?.id || null;
      if (resolvedMapId) {
        setGeneratedSetupMapId(resolvedMapId);
      } else {
        toast.error("Plan was generated, but map sync is still in progress.");
      }
      const activation = resolvedMapId
        ? await autoActivateGeneratedMap(resolvedMapId)
        : { launched: false, autoConfirmed: 0 };
      if (activation.launched && resolvedMapId) {
        await loadExecutionMap(resolvedMapId).catch(() => undefined);
      }
      logEvent({
        eventType: "trial_setup_step_completed",
        action: "generated",
        entityType: "task_scaffold",
        payload: { trialId, demoMode: currentDataMode, mapId: resolvedMapId },
        aiInvolved: true,
      });
      if (activation.launched) {
        const suffix =
          activation.autoConfirmed > 0
            ? ` (${activation.autoConfirmed} suggested task${
                activation.autoConfirmed === 1 ? "" : "s"
              } auto-confirmed)`
            : "";
        toast.success(`Execution map launched${suffix}`);
      } else {
        toast.success("Execution map generated");
      }
    } catch (error: any) {
      if (cancelledGenerationRunsRef.current.has(runId)) {
        return;
      }
      console.error("Failed to generate scaffold:", error);
      toast.error("Failed to generate execution plan", {
        description: error?.message || "Please upload a protocol in Document Hub and try again.",
      });
    } finally {
      cancelledGenerationRunsRef.current.delete(runId);
      setIsGeneratingScaffold(false);
    }
  };

  const handleCancelGenerateScaffold = () => {
    if (!isGeneratingScaffold) return;
    const currentRunId = generationRunRef.current;
    if (currentRunId) {
      cancelledGenerationRunsRef.current.add(currentRunId);
    }
    setIsGeneratingScaffold(false);
    toast.message("Plan generation stopped");
  };

  const handleOpenGeneratedScaffold = async () => {
    const mapId = generatedSetupMapId || executionMapSummary?.id;
    if (!mapId) {
      toast.error("Generated plan is not ready yet.");
      return;
    }
    try {
      await loadExecutionMap(mapId);
      setGeneratedSetupMapId(null);
    } catch (error: any) {
      toast.error(`Failed to open generated plan: ${error?.message || "Unknown error"}`);
    }
  };

  useEffect(() => {
    if (activeTab !== "study-setup-wizard") return;
    if (executionMapSummary?.id) return;
    if (!trialId || !protocolId || !existingScaffold?.scaffold?.id) return;

    const guardKey = `${trialId}:${protocolId}:${existingScaffold.scaffold.id}`;
    if (bootstrapGuardRef.current === guardKey || importLegacyScaffold.isPending) return;
    bootstrapGuardRef.current = guardKey;

    void importLegacyScaffold
      .mutateAsync({
        trialId,
        protocolId,
        clearExisting: true,
        demoMode: currentDataMode,
        trialStartDate: trial?.startDate ? new Date(trial.startDate).toISOString() : undefined,
        trialEndDate: trial?.endDate ? new Date(trial.endDate).toISOString() : undefined,
        assignmentMembers: effectiveScaffoldAssignmentMembers,
      })
      .then(async (result) => {
        await refetchExecutionMapSummary();
        if (result?.mapId) {
          await loadExecutionMap(result.mapId);
        }
      })
      .catch((error) => {
        console.error("Failed to bootstrap execution map:", error);
      });
  }, [
    activeTab,
    trialId,
    protocolId,
    existingScaffold?.scaffold?.id,
    executionMapSummary?.id,
    importLegacyScaffold.isPending,
    refetchExecutionMapSummary,
    loadExecutionMap,
    trial?.startDate,
    trial?.endDate,
    effectiveScaffoldAssignmentMembers,
  ]);

  const parseSampleSizeToNumber = (value?: string | null) => {
    const normalized = String(value ?? "")
      .replace(/\u00a0/g, " ")
      .trim();
    if (!normalized) return 0;
    const match = normalized.match(/\d{1,3}(?:,\d{3})+|\d+/);
    if (!match) return 0;
    const parsed = Number.parseInt(match[0].replace(/,/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const normalizeTargetPatients = (rawTarget: number | null | undefined, sampleSize?: string | null) => {
    const explicit = Number(rawTarget || 0);
    const fallback = parseSampleSizeToNumber(sampleSize);
    if (explicit <= 0) return fallback;

    // Compatibility fix: older parsing concatenated all digits in sample-size strings
    // (e.g., "117 / 5760" -> 1175760). If that exact pattern is detected, prefer first token.
    const allDigits = Number.parseInt(String(sampleSize ?? "").replace(/[^0-9]/g, ""), 10);
    if (
      fallback > 0 &&
      Number.isFinite(allDigits) &&
      allDigits === explicit &&
      fallback !== explicit
    ) {
      return fallback;
    }

    // Defensive fallback for historical malformed targets (e.g. 1175760 from concatenated values).
    if (explicit >= 500000) {
      const leading = Number.parseInt(String(explicit).slice(0, 3), 10);
      if (Number.isFinite(leading) && leading > 0 && leading <= 5000) {
        return leading;
      }
    }
    return explicit;
  };
  const enrolledPatients = trial?.enrolledPatients || 0;
  const targetPatients = normalizeTargetPatients(trial?.targetPatients, trial?.sampleSize);
  const enrollmentPercent = targetPatients > 0 ? Math.round((enrolledPatients / targetPatients) * 100) : 0;
  const scaffoldTasks =
    scopedMapTasks.length > 0
      ? scopedMapTasks
      : (existingScaffold?.phases || []).flatMap((phase: any) => phase?.tasks || []) || [];
  const pendingTasks = scaffoldTasks.filter((task: any) => {
    const status = String(task?.status || "");
    return !["completed", "done", "cancelled", "skipped"].includes(status);
  }).length;
  const completedTasks = scaffoldTasks.filter((task: any) => {
    const status = String(task?.status || "");
    return status === "completed" || status === "done";
  }).length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const dueTodayTasks = scaffoldTasks.filter((task: any) => {
    const status = String(task?.status || "");
    if (["completed", "done", "cancelled", "skipped"].includes(status)) return false;
    const candidateDate = task?.dueDate || task?.suggestedDate;
    if (!candidateDate) return false;
    return new Date(candidateDate).toISOString().slice(0, 10) === todayIso;
  }).length;
  const overdueTasks = scaffoldTasks.filter((task: any) => {
    const status = String(task?.status || "");
    if (["completed", "done", "cancelled", "skipped"].includes(status)) return false;
    const candidateDate = task?.dueDate || task?.suggestedDate;
    if (!candidateDate) return false;
    return new Date(candidateDate) < new Date();
  }).length;
  const totalTasks = pendingTasks + completedTasks;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const scheduledVisits = (scopedMapPhases.length > 0 ? scopedMapPhases : existingScaffold?.phases || []).filter((phase: any) =>
    String(phase?.name || "").toLowerCase().includes("visit")
  ).length;

  const sponsorDomain = getSponsorLogoDomain(trial?.sponsor);
  const sponsorLogoUrl = sponsorDomain ? `https://logo.clearbit.com/${sponsorDomain}` : null;
  const sponsorInitials = (trial?.sponsor || "SP")
    .split(/[\s,&.-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "SP";
  const rawContextSuggestions = (trialContext?.suggestions || []) as Array<{
    id: string;
    title: string;
    description: string;
    actionLabel: string;
    actionTarget: "overview" | "document-hub" | "study-setup-wizard" | "assistant";
    category: string;
    priority: "high" | "medium" | "low";
    confidence: number;
  }>;

  useEffect(() => {
    setSponsorLogoFailed(false);
  }, [sponsorLogoUrl]);

  useEffect(() => {
    if (activeTab !== "settings") {
      setDeleteConfirmText("");
    }
  }, [activeTab]);

  const hasProtocolInHubFromList = protocols.some((doc: any) => {
    const category = String(doc?.category || "").toLowerCase();
    const filename = String(doc?.filename || "").toLowerCase();
    const isArchived = Boolean(doc?.archivedAt);
    if (isArchived) return false;
    return category.includes("protocol") || filename.includes("protocol");
  });
  const trialContextDocuments = (trialContext?.documents || null) as
    | {
        protocolCount?: number | null;
        currentProtocol?: { id?: number | null } | null;
      }
    | null;
  const hasProtocolInHubFromContext =
    Number(trialContextDocuments?.protocolCount || 0) > 0 || Boolean(trialContextDocuments?.currentProtocol?.id);
  const hasProtocolInHub = hasProtocolInHubFromList || hasProtocolInHubFromContext;
  const timelineReady = Boolean(trial?.startDate) && Boolean(trial?.endDate);
  const trialStatusValue = (trial?.status || "not-started").toLowerCase();
  const trialStatusLabel =
    trialStatusValue === "not-started"
      ? "Not started"
      : trialStatusValue === "on-hold"
      ? "On hold"
      : trialStatusValue.charAt(0).toUpperCase() + trialStatusValue.slice(1);
  const trialStatusDisplayClass =
    trialStatusValue === "active" || trialStatusValue === "recruiting"
      ? "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-700"
      : trialStatusValue === "on-hold"
      ? "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700"
      : trialStatusValue === "terminated"
      ? "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-red-100 text-red-700"
      : trialStatusValue === "completed"
      ? "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-700"
      : "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700";
  const contextSuggestions = rawContextSuggestions.filter(
    (signal) => !(signal.id === "set_trial_timeline" && timelineReady)
  );
  const primarySuggestion = contextSuggestions[0];
  const normalizedAssignedRoles = trialTeamMembers.map((member) =>
    String(member.role || "").toLowerCase().trim()
  );
  const hasPrincipalInvestigator = normalizedAssignedRoles.some(
    (role) =>
      role.includes("principal investigator") ||
      role === "pi"
  );
  const hasCrc = normalizedAssignedRoles.some(
    (role) =>
      role.includes("crc") ||
      role.includes("clinical research coordinator") ||
      role.includes("study coordinator")
  );
  const hasOperationalSupportRole = normalizedAssignedRoles.some(
    (role) =>
      role.includes("nurse") ||
      role.includes("lab") ||
      role.includes("data manager") ||
      role.includes("regulatory") ||
      role.includes("safety") ||
      role.includes("pharmac") ||
      role.includes("quality") ||
      role.includes("project manager")
  );
  const teamReadinessRequirements = [
    !hasPrincipalInvestigator ? "PI" : null,
    !hasCrc ? "CRC" : null,
    !hasOperationalSupportRole ? "1 support role (Nurse/Lab/Data/Regulatory/Safety)" : null,
  ].filter(Boolean) as string[];
  const teamReady = hasPrincipalInvestigator && hasCrc && hasOperationalSupportRole;
  const launchChecklist = [
    ...(!hasProtocolInHub
      ? [
          {
            id: "protocol-sync",
            title: "Attach protocol to Document Hub",
            subtitle: "Themison AI needs the protocol file to generate traceable execution guidance.",
            done: false,
          },
        ]
      : []),
    {
      id: "setup-wizard",
      title: "Generate execution plan in Study Setup Agent",
      subtitle: "Convert protocol requirements into operational tasks.",
      done: scaffoldTasks.length > 0,
    },
    {
      id: "team",
      title: "Assign trial team members",
      subtitle: teamReady
        ? "Core trial team is in place."
        : `Missing: ${teamReadinessRequirements.join(", ")}.`,
      done: teamReady,
    },
    {
      id: "timeline",
      title: "Set start and end dates",
      subtitle: "Operational timeline anchors planning and accountability.",
      done: timelineReady,
    },
    {
      id: "activate-trial",
      title: "Activate trial when launch is ready",
      subtitle: "Switch status from Not started to Active when onboarding is complete.",
      done: (trial?.status || "not-started") !== "not-started",
    },
  ];
  const firstIncompleteChecklistItem = launchChecklist.find((item) => !item.done);
  const nextOperationalTasks = scaffoldTasks
    .filter((task: any) => task?.status !== "completed")
    .slice(0, 5);

  const aiRecommendation = primarySuggestion
    ? primarySuggestion.description
    : firstIncompleteChecklistItem
    ? firstIncompleteChecklistItem.id === "protocol-sync"
      ? "Protocol file is missing from Document Hub. Upload it so Themison AI can generate traceable guidance."
      : firstIncompleteChecklistItem.id === "setup-wizard"
      ? "Run Study Setup Agent to generate the first AI-backed execution plan."
      : firstIncompleteChecklistItem.id === "team"
      ? "Assign core team members so work can be routed to the right owners."
      : firstIncompleteChecklistItem.id === "timeline"
      ? "Set start/end dates to unlock time-based planning and alerts."
      : firstIncompleteChecklistItem.id === "activate-trial"
      ? "All onboarding is ready. Set status to Active when the trial is ready to start."
      : "Open Themison AI for protocol-grounded guidance."
    : nextOperationalTasks.length > 0
    ? "Execution plan is live. Assign owners to the next tasks and monitor progress."
    : "Launch readiness is complete. Generate or refresh your execution plan as needed.";
  const recommendedActionLabel = primarySuggestion
    ? primarySuggestion.actionLabel
    : firstIncompleteChecklistItem
    ? firstIncompleteChecklistItem.id === "protocol-sync"
      ? "Open Document Hub"
      : firstIncompleteChecklistItem.id === "setup-wizard"
      ? "Open Study Setup Agent"
      : firstIncompleteChecklistItem.id === "team"
      ? "Assign Team Members"
      : firstIncompleteChecklistItem.id === "timeline"
      ? "Set Timeline"
      : firstIncompleteChecklistItem.id === "activate-trial"
      ? "Set Trial Status"
      : "Open Themison AI"
    : nextOperationalTasks.length > 0
    ? "Open Study Setup Agent"
    : "Open Themison AI";
  const handleAiRecommendedAction = () => {
    if (primarySuggestion) {
      logEvent({
        eventType: "ai_suggestion_applied",
        action: "clicked",
        entityType: "trial",
        entityId: trialId,
        payload: {
          suggestionId: primarySuggestion.id,
          target: primarySuggestion.actionTarget,
          demoMode: currentDataMode,
        },
        aiInvolved: true,
      });

      if (primarySuggestion.actionTarget === "document-hub") {
        setActiveTab("document-hub");
        return;
      }
      if (primarySuggestion.actionTarget === "study-setup-wizard") {
        setActiveTab("study-setup-wizard");
        return;
      }
      if (primarySuggestion.actionTarget === "assistant") {
        navigate(`/trial/${trialId}/assistant`);
        return;
      }
      setActiveTab("overview");
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }

    if (!firstIncompleteChecklistItem) {
      if (nextOperationalTasks.length > 0) {
        setActiveTab("study-setup-wizard");
      } else {
        navigate(`/trial/${trialId}/assistant`);
      }
      return;
    }
    if (firstIncompleteChecklistItem.id === "protocol-sync") {
      setActiveTab("document-hub");
      return;
    }
    if (firstIncompleteChecklistItem.id === "setup-wizard") {
      setActiveTab("study-setup-wizard");
      return;
    }
    if (firstIncompleteChecklistItem.id === "team") {
      setManageTeamOpen(true);
      return;
    }
    if (firstIncompleteChecklistItem.id === "timeline" || firstIncompleteChecklistItem.id === "activate-trial") {
      setActiveTab("overview");
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    navigate(`/trial/${trialId}/assistant`);
  };

  const formatDate = (value?: string | Date | null) => {
    if (!value) return "Not available";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const handleDeleteTrialFromSettings = async () => {
    const displayName = trial?.investigationalProduct || trial?.title || trialId;
    const confirmed = window.confirm(
      `Delete "${displayName}"?\n\nThis will remove the trial and related sandbox data.`
    );
    if (!confirmed) return;
    await deleteTrialMutation.mutateAsync({
      id: trialId,
      demoMode: currentDataMode,
    });
  };

  const setupPhases = useMemo(() => {
    if (scopedMapPhases.length === 0) return [];
    const taskById = new Map(scopedMapTasks.map((task) => [task.id, task]));
    const depsByTask = new Map<string, any[]>();
    for (const dep of scopedMapDependencies) {
      const current = depsByTask.get(dep.targetTaskId) ?? [];
      current.push({
        ...dep,
        sourceTaskName: taskById.get(dep.sourceTaskId)?.name || null,
      });
      depsByTask.set(dep.targetTaskId, current);
    }

    return [...scopedMapPhases]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((phase) => {
        const phaseTasks = scopedMapTasks
          .filter((task) => task.phaseId === phase.id)
          .sort((a, b) => a.orderInPhase - b.orderInPhase)
          .map((task) => {
            const firstRef = task.protocolRefs?.[0] as Record<string, any> | undefined;
            const protocolPageRaw = firstRef?.page;
            const protocolPage =
              typeof protocolPageRaw === "number"
                ? protocolPageRaw
                : protocolPageRaw
                ? Number(protocolPageRaw)
                : null;
            return {
              id: task.id,
              name: task.name,
              suggestedDate: task.suggestedDate
                ? new Date(task.suggestedDate)
                : task.dueDate
                ? new Date(task.dueDate)
                : null,
              startDate: task.startDate ? new Date(task.startDate) : null,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              suggestedAssigneeId: task.assignedUserId ?? null,
              dependencies: depsByTask.get(task.id) ?? [],
              status: task.status,
              category: task.category,
              assignedRole: task.assignedRole ?? null,
              estimatedDuration: task.estimatedDuration ?? null,
              priority: task.priority,
              aiConfidence: task.aiConfidence ?? null,
              conditionalNote: task.conditionalNote ?? null,
              protocolReference: {
                section: typeof firstRef?.section === "string" ? firstRef.section : null,
                page: Number.isFinite(protocolPage as number) ? (protocolPage as number) : null,
                extractedText:
                  typeof firstRef?.extractedText === "string" ? firstRef.extractedText : null,
              },
            };
          });
        return {
          id: phase.id,
          name: phase.name,
          color: phase.color,
          tasks: phaseTasks,
        };
      });
  }, [scopedMapPhases, scopedMapTasks, scopedMapDependencies]);

  const setupSections = useMemo(() => {
    if (scopedMapSections.length > 0) {
      const normalizeSectionKey = (name: string) => {
        const normalized = String(name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        if (/(schedule|visit window|study days|soa|soe)/.test(normalized)) return "schedule";
        if (/(inclusion|exclusion|eligib)/.test(normalized)) return "eligibility";
        if (/(randomi[sz]ation|irt|allocation)/.test(normalized)) return "randomization";
        if (/(dosing|dose|drug administration|administration)/.test(normalized)) return "dosing";
        if (/(procedure|assessment|exam|ecg|vital)/.test(normalized)) return "procedure";
        if (/(lab|sample|hematology|chemistry|pk|biomarker|urinalysis)/.test(normalized)) return "lab";
        if (/(adverse event|safety|sae|ae)/.test(normalized)) return "safety";
        if (/(concomitant|medication)/.test(normalized)) return "medication";
        return normalized || "custom";
      };

      const dedupedSections = [...scopedMapSections]
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .filter((section, index, all) => {
          const key = normalizeSectionKey(section.name);
          return all.findIndex((row) => normalizeSectionKey(row.name) === key) === index;
        });

      const mappedSections = dedupedSections
        .map((section) => ({
          id: section.id,
          name: section.name,
          dateReference: section.dateReference
            ? new Date(section.dateReference).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : null,
          pageReference: section.pageStart ? `P.${section.pageStart}` : null,
          pageStart: section.pageStart ?? null,
          linkedTaskIds: section.linkedTaskIds ?? [],
          linkedPhaseIds: section.linkedPhaseIds ?? [],
        }));

      const hasEnrollmentSection = mappedSections.some(
        (section) => normalizeSectionKey(section.name) === "randomization"
      );
      if (!hasEnrollmentSection) {
        const enrollmentMatches = setupPhases.flatMap((phase) =>
          phase.tasks
            .filter((task) => {
              const normalizedName = String(task.name || "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim();
              const normalizedRef = String(task.protocolReference?.section || "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim();
              return (
                normalizedName.includes("enroll") ||
                normalizedName.includes("enrol") ||
                normalizedName.includes("random") ||
                normalizedName.includes("irt") ||
                normalizedRef.includes("enroll") ||
                normalizedRef.includes("enrol") ||
                normalizedRef.includes("random") ||
                normalizedRef.includes("irt")
              );
            })
            .map((task) => ({
              taskId: task.id,
              phaseId: phase.id,
              page: task.protocolReference?.page ?? null,
            }))
        );

        const linkedTaskIds = Array.from(new Set(enrollmentMatches.map((row) => row.taskId)));
        const linkedPhaseIds = Array.from(new Set(enrollmentMatches.map((row) => row.phaseId)));
        const firstPage =
          enrollmentMatches.find((row) => typeof row.page === "number" && Number.isFinite(row.page))?.page ??
          null;
        mappedSections.push({
          id: "fallback-enrollment-randomization",
          name: "Enrollment & Randomization",
          dateReference: null,
          pageReference: firstPage ? `P.${firstPage}` : null,
          pageStart: firstPage,
          linkedTaskIds,
          linkedPhaseIds,
        });
      }

      return mappedSections;
    }

    if (setupPhases.length === 0) return [];

    type FallbackSection = {
      id: string;
      name: string;
      linkedTaskIds: string[];
      linkedPhaseIds: string[];
      pageStart: number | null;
    };

    const buckets: Array<{
      id: string;
      name: string;
      match: (task: any, normalizedName: string) => boolean;
    }> = [
      {
        id: "schedule",
        name: "Schedule of Events",
        match: () => true,
      },
      {
        id: "inclusion-exclusion",
        name: "Inclusion / Exclusion",
        match: (task, normalizedName) =>
          task.category === "eligibility" ||
          task.category === "consent" ||
          normalizedName.includes("inclusion") ||
          normalizedName.includes("exclusion") ||
          normalizedName.includes("consent"),
      },
      {
        id: "enrollment-randomization",
        name: "Enrollment & Randomization",
        match: (task, normalizedName) =>
          task.category === "coordination" ||
          normalizedName.includes("enroll") ||
          normalizedName.includes("enrol") ||
          normalizedName.includes("random") ||
          normalizedName.includes("irt"),
      },
      {
        id: "dosing",
        name: "Dosing & Administration",
        match: (task, normalizedName) =>
          task.category === "drug_administration" ||
          normalizedName.includes("dose") ||
          normalizedName.includes("infusion") ||
          normalizedName.includes("administration"),
      },
      {
        id: "procedures",
        name: "Procedures & Assessments",
        match: (task) =>
          ["assessment", "vital_signs", "questionnaire", "imaging"].includes(String(task.category || "")),
      },
      {
        id: "lab",
        name: "Lab & Samples",
        match: (task, normalizedName) =>
          task.category === "lab_sample" ||
          normalizedName.includes("sample") ||
          normalizedName.includes("blood") ||
          normalizedName.includes("lab"),
      },
      {
        id: "safety",
        name: "Adverse Events & Safety",
        match: (task, normalizedName) =>
          task.category === "safety_reporting" ||
          normalizedName.includes("adverse") ||
          normalizedName.includes("safety"),
      },
      {
        id: "concomitant",
        name: "Concomitant Medications",
        match: (_task, normalizedName) =>
          normalizedName.includes("concomitant") || normalizedName.includes("medication"),
      },
    ];

    const fallbackMap = new Map<string, FallbackSection>();
    for (const bucket of buckets) {
      fallbackMap.set(bucket.id, {
        id: `fallback-${bucket.id}`,
        name: bucket.name,
        linkedTaskIds: [],
        linkedPhaseIds: [],
        pageStart: null,
      });
    }

    for (const phase of setupPhases) {
      for (const task of phase.tasks) {
        const normalizedName = String(task.name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        for (const bucket of buckets) {
          if (!bucket.match(task, normalizedName)) continue;
          const target = fallbackMap.get(bucket.id);
          if (!target) continue;
          if (!target.linkedTaskIds.includes(task.id)) target.linkedTaskIds.push(task.id);
          if (!target.linkedPhaseIds.includes(phase.id)) target.linkedPhaseIds.push(phase.id);
          if (!target.pageStart && task.protocolReference?.page) {
            target.pageStart = task.protocolReference.page;
          }
        }
      }
    }

    const fallbackSections = Array.from(fallbackMap.values()).filter((section) => section.linkedTaskIds.length > 0);
    if (fallbackSections.length > 0) {
      return fallbackSections.map((section, index) => ({
        id: section.id,
        name: section.name,
        dateReference: null,
        pageReference: section.pageStart ? `P.${section.pageStart}` : null,
        pageStart: section.pageStart,
        linkedTaskIds: section.linkedTaskIds,
        linkedPhaseIds: section.linkedPhaseIds,
        displayOrder: index,
      }));
    }

    const allTasks = setupPhases.flatMap((phase) => phase.tasks);
    const allTaskIds = allTasks.map((task) => task.id);
    const allPhaseIds = setupPhases.map((phase) => phase.id);
    const firstPage = allTasks.find((task) => task.protocolReference?.page)?.protocolReference?.page ?? null;

    return [
      {
        id: "fallback-schedule",
        name: "Schedule of Events",
        dateReference: null,
        pageReference: firstPage ? `P.${firstPage}` : null,
        pageStart: firstPage,
        linkedTaskIds: allTaskIds,
        linkedPhaseIds: allPhaseIds,
      },
    ];
  }, [scopedMapSections, setupPhases]);

  const setupDependencyCandidates = useMemo(
    () =>
      scopedMapTasks
        .filter((task) => task.id !== setupEditingTaskId)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [scopedMapTasks, setupEditingTaskId]
  );

  const setupAssignedMembersForTaskForm = useMemo(
    () =>
      trialTeamMembers.map((member) => ({
        id: String(member.id),
        name: member.name,
        role: member.role || "",
      })),
    [trialTeamMembers]
  );

  useEffect(() => {
    if (!setupTaskModalOpen || setupPhases.length === 0) return;
    if (setupPhases.some((phase) => phase.id === setupTaskForm.phaseId)) return;
    setSetupTaskForm((prev) => ({ ...prev, phaseId: setupPhases[0]?.id || "" }));
  }, [setupTaskModalOpen, setupPhases, setupTaskForm.phaseId]);

  const syncSetupTaskDependencies = async (targetTaskId: string, selectedSourceTaskIds: string[]) => {
    if (!map?.id) return;
    const existingDeps = scopedMapDependencies.filter((dep) => dep.targetTaskId === targetTaskId);
    const existingSourceSet = new Set(existingDeps.map((dep) => dep.sourceTaskId));
    const selectedSourceSet = new Set(selectedSourceTaskIds);
    const toAdd = selectedSourceTaskIds.filter((taskId) => !existingSourceSet.has(taskId));
    const toRemove = existingDeps.filter((dep) => !selectedSourceSet.has(dep.sourceTaskId));

    for (const sourceTaskId of toAdd) {
      await addExecutionDependency({
        sourceTaskId,
        targetTaskId,
        dependencyType: "finish_to_start",
      });
    }

    for (const dep of toRemove) {
      await removeExecutionDependency(dep.id);
    }
  };

  const handleAddSetupTask = () => {
    if (!map?.id || setupPhases.length === 0) {
      toast.error("No execution map loaded");
      return;
    }
    setSetupTaskModalMode("create");
    setSetupEditingTaskId(null);
    setSetupDependencyTaskIds([]);
    setSetupTaskForm({
      title: "",
      description: "",
      phaseId: setupPhases[0]?.id || "",
      category: "custom",
      status: map.status === "active" ? "todo" : "suggested",
      priority: "medium",
      assignedRole: "",
      assigneeMemberId: "",
      dueDate: "",
      sourceSection: "",
      sourcePage: "",
      sourceText: "",
    });
    setSetupTaskModalOpen(true);
  };

  const handleEditSetupTask = (taskId: string) => {
    const task = scopedMapTasks.find((row) => row.id === taskId);
    if (!task) return;
    const sourceRef = (task.protocolRefs || [])[0] as unknown as Record<string, unknown> | undefined;
    const sourcePageRaw = sourceRef?.page;
    const sourcePage =
      typeof sourcePageRaw === "number"
        ? String(sourcePageRaw)
        : typeof sourcePageRaw === "string"
        ? sourcePageRaw
        : "";
    const memberForAssignee = setupAssignedMembersForTaskForm.find(
      (member) =>
        String(member.id) === String(task.assignedUserId || "") ||
        String(member.id) === `member-${String(task.assignedUserId || "")}` ||
        member.name === (task.suggestedAssignee || "")
    );
    const predecessorTaskIds = scopedMapDependencies
      .filter((dep) => dep.targetTaskId === task.id)
      .map((dep) => dep.sourceTaskId);

    setSetupTaskModalMode("edit");
    setSetupEditingTaskId(task.id);
    setSetupDependencyTaskIds(predecessorTaskIds);
    setSetupTaskForm({
      title: task.name || "",
      description: task.description || "",
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
    setSetupTaskModalOpen(true);
  };

  useEffect(() => {
    if (!pendingOpenSetupTaskId) return;
    if (activeTab !== "study-setup-wizard") return;
    const task = scopedMapTasks.find((row) => row.id === pendingOpenSetupTaskId);
    if (!task) return;
    handleEditSetupTask(task.id);
    setPendingOpenSetupTaskId(null);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("openTask");
    params.delete("mapId");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [activeTab, pendingOpenSetupTaskId, scopedMapTasks, handleEditSetupTask]);

  const handleSaveSetupTaskModal = async () => {
    if (!map?.id) {
      toast.error("No execution map loaded");
      return;
    }
    const title = setupTaskForm.title.trim();
    if (!title) {
      toast.error("Task title is required.");
      return;
    }
    if (!setupTaskForm.phaseId) {
      toast.error("Phase / visit is required.");
      return;
    }

    const selectedMember = setupAssignedMembersForTaskForm.find(
      (member) => String(member.id) === setupTaskForm.assigneeMemberId
    );
    const selectedMemberNumericId = selectedMember ? parseMemberNumericId(selectedMember.id) : null;
    const assignedRole =
      setupTaskForm.assignedRole &&
      SETUP_ASSIGNED_ROLE_OPTIONS.includes(setupTaskForm.assignedRole as (typeof SETUP_ASSIGNED_ROLE_OPTIONS)[number])
        ? (setupTaskForm.assignedRole as (typeof SETUP_ASSIGNED_ROLE_OPTIONS)[number])
        : null;
    const dueDateIso = toIsoDateTime(setupTaskForm.dueDate);
    const pageNumber = Number(setupTaskForm.sourcePage);
    const hasSource =
      Boolean(setupTaskForm.sourceSection.trim()) ||
      Boolean(setupTaskForm.sourceText.trim()) ||
      (Number.isFinite(pageNumber) && pageNumber > 0);
    const protocolRefs = hasSource
      ? [
          {
            section: setupTaskForm.sourceSection.trim() || "Protocol",
            ...(Number.isFinite(pageNumber) && pageNumber > 0 ? { page: Math.round(pageNumber) } : {}),
            ...(setupTaskForm.sourceText.trim() ? { extractedText: setupTaskForm.sourceText.trim() } : {}),
          },
        ]
      : [];

    try {
      if (setupTaskModalMode === "create") {
        const created = await addExecutionTask(setupTaskForm.phaseId, {
          name: title,
          description: setupTaskForm.description.trim() || undefined,
          category: setupTaskForm.category,
          status: setupTaskForm.status,
          priority: setupTaskForm.priority,
          assignedRole,
          assignedUserId: selectedMemberNumericId,
          suggestedAssignee: selectedMember?.name || null,
          suggestedDate: dueDateIso,
          dueDate: dueDateIso,
          createdBy: "user",
          isCustom: true,
          protocolRefs: protocolRefs as any,
          tags: [],
        });
        await syncSetupTaskDependencies(created.id, setupDependencyTaskIds);
        toast.success("Task created.");
      } else {
        const taskId = setupEditingTaskId;
        const existing = taskId ? scopedMapTasks.find((task) => task.id === taskId) : null;
        if (!taskId || !existing) {
          toast.error("Task not found.");
          return;
        }
        await updateExecutionTask(taskId, {
          name: title,
          description: setupTaskForm.description.trim() || "",
          category: setupTaskForm.category,
          status: setupTaskForm.status,
          priority: setupTaskForm.priority,
          assignedRole,
          assignedUserId: selectedMemberNumericId,
          suggestedAssignee: selectedMember?.name || null,
          suggestedDate: dueDateIso,
          dueDate: dueDateIso,
          protocolRefs: protocolRefs as any,
          isCustom: true,
          createdBy: "user",
        });
        if (existing.phaseId !== setupTaskForm.phaseId) {
          const nextOrder = scopedMapTasks.filter((task) => task.phaseId === setupTaskForm.phaseId).length;
          await moveExecutionTask(taskId, setupTaskForm.phaseId, nextOrder);
        }
        await syncSetupTaskDependencies(taskId, setupDependencyTaskIds);
        toast.success("Task updated.");
      }
      setSetupTaskModalOpen(false);
      setSetupEditingTaskId(null);
    } catch (error: any) {
      toast.error(error?.message || "Failed to save task.");
    }
  };

  const handleDeleteSetupTaskFromModal = async () => {
    if (!setupEditingTaskId) return;
    const task = scopedMapTasks.find((item) => item.id === setupEditingTaskId);
    if (!task) return;
    const confirmed = window.confirm(`Delete "${task.name}"?`);
    if (!confirmed) return;
    try {
      await removeExecutionTask(setupEditingTaskId);
      setSetupTaskModalOpen(false);
      setSetupEditingTaskId(null);
      toast.success("Task deleted.");
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete task.");
    }
  };

  const handleDeleteSetupTask = async (taskId: string) => {
    const task = scopedMapTasks.find((row) => row.id === taskId);
    if (!task) return;
    if (!window.confirm(`Delete task "${task.name}"?`)) return;
    try {
      await removeExecutionTask(taskId);
      toast.success("Task deleted");
    } catch (error: any) {
      toast.error(`Failed to delete task: ${error?.message || "Unknown error"}`);
    }
  };

  const handleLaunchExecutionMap = async () => {
    if (isLaunchingExecutionMap) return;

    const mapId = executionMapSummary?.id || map?.id;
    if (!mapId) {
      toast.error("No execution map loaded");
      return;
    }

    setIsLaunchingExecutionMap(true);
    try {
      const confirmation = await confirmSuggestedMutation.mutateAsync({ mapId });
      await launchMapMutation.mutateAsync({ mapId });
      await Promise.all([
        utils.map.getByTrial.invalidate({ trialId, includeArchived: false, demoMode: currentDataMode }),
        utils.map.load.invalidate({ mapId }),
        utils.map.loadWorkspace.invalidate(),
      ]);
      const refreshedSummary = await refetchExecutionMapSummary();
      const resolvedMapId = refreshedSummary.data?.id || mapId;
      await loadExecutionMap(resolvedMapId);
      if (confirmation.updated > 0) {
        toast.success(
          `Execution map launched (${confirmation.updated} suggested task${confirmation.updated === 1 ? "" : "s"} auto-confirmed)`
        );
      } else {
        toast.success("Execution map launched");
      }
    } catch (error: any) {
      toast.error(`Failed to launch map: ${error?.message || "Review suggested tasks first."}`);
    } finally {
      setIsLaunchingExecutionMap(false);
    }
  };

  let mainContent: React.ReactNode = null;
  let lockPageScrollToScaffold = false;
  const hasRenderableSetupMap =
    isCurrentTrialExecutionMap && !!map?.id && setupPhases.length > 0 && scopedMapTasks.length > 0;
  const renderSetupScaffoldWorkspace = (fullscreen: boolean) => (
    <div
      className={
        fullscreen
          ? "h-full w-full bg-white flex flex-col"
          : "h-full bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col"
      }
    >
      <div
        className={`relative ${
          fullscreen ? "px-6 py-5 border-b border-gray-100" : "px-6 pt-5 pb-4 border-b border-gray-200"
        }`}
      >
        <div className="w-full max-w-[720px]">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-900">Step 4 of 4</p>
          <div className="mt-6 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-[#0E0017]" style={{ width: "100%" }} />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mt-8">Review & Launch</h2>
          <p className="text-sm text-gray-500 mt-2">
            Validate the generated execution plan, adjust tasks if needed, then confirm launch.
          </p>
        </div>
        {fullscreen ? (
          <button
            type="button"
            onClick={() => setIsSetupFullscreenVisible(false)}
            className="absolute right-6 top-6 text-gray-400 hover:text-gray-600"
            aria-label="Close fullscreen setup"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={openSetupFullscreen}
            className="absolute right-6 top-6 text-gray-400 hover:text-gray-600"
            aria-label="Expand setup"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden px-6 py-4">
        <div className="h-full min-h-0">
          <TaskScaffoldView
            phases={setupPhases}
            sections={setupSections}
            view={setupScaffoldView}
            onViewChange={setSetupScaffoldView}
            isConfirming={isLaunchingExecutionMap}
            timelineStartDate={trial?.startDate ? new Date(trial.startDate) : null}
            timelineEndDate={trial?.endDate ? new Date(trial.endDate) : null}
            onConfirm={handleLaunchExecutionMap}
            onAddTask={handleAddSetupTask}
            onEditTask={handleEditSetupTask}
            onDeleteTask={handleDeleteSetupTask}
            onOpenProtocolPage={(page, sectionName) => {
              const protocolDoc =
                protocols.find((doc: any) => String(doc?.category || "").toLowerCase().includes("protocol")) ||
                protocols[0];
              const url = protocolDoc?.fileUrl as string | undefined;
              if (!url) {
                toast.error("No protocol PDF available to open");
                return;
              }
              const target = page && Number.isFinite(page) ? `${url}#page=${page}` : url;
              window.open(target, "_blank", "noopener,noreferrer");
              logEvent({
                eventType: "document_section_accessed",
                action: "open_source_from_protocol_map",
                entityType: "protocol_section",
                payload: {
                  sectionName,
                  page: page ?? null,
                  trialId,
                },
                aiInvolved: true,
              });
            }}
            onReorderTasks={(phaseId, orderedTaskIds) => {
              void reorderExecutionTasks(phaseId, orderedTaskIds).catch((error) => {
                toast.error(`Failed to reorder tasks: ${error?.message || "Unknown error"}`);
              });
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderSetupAgentAlwaysOn = () => (
    <div className="h-full min-h-0 overflow-hidden px-6 pb-6">
      <div className="h-full bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="relative h-full w-full overflow-hidden flex items-center justify-center py-10">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundColor: "#ffffff",
              backgroundImage: "radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px)",
              backgroundSize: "18px 18px",
            }}
          />
          <div
            className="absolute inset-0 bg-center bg-cover bg-no-repeat opacity-75 pointer-events-none"
            style={{ backgroundImage: `url(${studySetupBackground})` }}
          />
          <div className="relative z-10 text-center max-w-3xl px-6 pb-10">
            <div className="mx-auto h-[360px] w-[360px]">
              <DotLottieReact
                src="https://lottie.host/d8617406-7b38-4ae4-968d-b934a05d4a10/UKTFUbeuwK.lottie"
                autoplay
                loop
                className="h-full w-full"
              />
            </div>
            <h2 className="mt-2 text-3xl font-bold text-gray-900">Themison Study Setup Agent is always on</h2>
            <p className="mt-3 text-base text-gray-600">
              If a new amendment arrives, Themison will flag impacted tasks, timing windows, and dependencies so your
              execution plan stays current.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                className="bg-[#2F6FED] hover:bg-[#255BD1] text-white"
                onClick={() => navigate(`/tasks?trialId=${trialId}`)}
              >
                Open Task Manager
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
              <Button variant="outline" onClick={() => navigate(`/trial/${trialId}/assistant`)}>
                Ask Themison AI
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (activeTab === "document-hub") {
    mainContent = (
      <div className="px-6 pb-6">
        <Documents trialId={trialId} />
      </div>
    );
  } else if (activeTab === "study-setup-wizard") {
    const isSyncingExecutionMap = importLegacyScaffold.isPending;
    const generationReady = Boolean(generatedSetupMapId) && !(isGeneratingScaffold || isSyncingExecutionMap);
    const showSetupAgentAlwaysOn =
      isSetupPlanLaunched && !(isGeneratingScaffold || isSyncingExecutionMap || generationReady);
    const shouldShowSetupWizard =
      isGeneratingScaffold || isSyncingExecutionMap || generationReady || !hasRenderableSetupMap || showSetupAgentAlwaysOn;

    mainContent = showSetupAgentAlwaysOn ? (
      renderSetupAgentAlwaysOn()
    ) : !shouldShowSetupWizard ? (
      <div className="h-full min-h-0 overflow-hidden px-6 pb-6">
        {renderSetupScaffoldWorkspace(false)}
        {isSetupFullscreenOpen ? (
          <div className="fixed inset-0 z-[70] pointer-events-auto">
            <div
              className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${
                isSetupFullscreenVisible ? "opacity-100" : "opacity-0"
              }`}
              onClick={() => setIsSetupFullscreenVisible(false)}
            />
            <div
              className={`absolute left-0 top-0 h-full w-full bg-white flex flex-col transform-gpu transition-[transform,opacity] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
                isSetupFullscreenVisible ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
              }`}
            >
              {renderSetupScaffoldWorkspace(true)}
            </div>
          </div>
        ) : null}
      </div>
    ) : (
      <div className="px-6 pb-6 space-y-3">
        <StudySetupWizardEntry
          trialId={trialId}
          onGenerate={() => {
            void handleGenerateScaffold();
          }}
          onCancelGenerate={handleCancelGenerateScaffold}
          generationReady={generationReady}
          onSeePlan={() => {
            void handleOpenGeneratedScaffold();
          }}
          isGenerating={isGeneratingScaffold || isSyncingExecutionMap}
        />
      </div>
    );
    if (!shouldShowSetupWizard || showSetupAgentAlwaysOn) {
      lockPageScrollToScaffold = true;
    }
  } else if (activeTab === "bookmarks") {
    mainContent = (
      <div className="px-6 pb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Trial Systems</h2>
              <p className="text-sm text-gray-500 mt-1">Quick access to external systems used in this trial.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button className="text-sm h-9">
                <Plus className="h-4 w-4 mr-2" />
                Add Link
              </Button>
              <Button variant="outline" className="text-sm h-9">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button variant="outline" className="text-sm h-9">
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 border-b border-gray-200 pb-3 text-sm">
            {["All", "EDC", "CTMS", "eTMF / eISF", "Sponsor Portal", "Safety", "Other"].map((tab) => (
              <button
                key={tab}
                className={tab === "All" ? "text-blue-600 border-b-2 border-blue-600 pb-1" : "text-gray-500 hover:text-gray-700 pb-1"}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input placeholder="Search systems..." className="pl-9 h-10" />
            </div>
            <Button variant="outline" size="sm" className="h-9 text-sm">
              Categories
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="outline" size="sm" className="h-9 text-sm">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {mockBookmarks.map((bookmark) => (
              <div key={bookmark.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-md border border-gray-200 bg-white flex items-center justify-center overflow-hidden">
                      <img src={getFaviconUrl(bookmark.url)} alt={`${bookmark.name} logo`} className="h-5 w-5" loading="lazy" />
                    </div>
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                      {bookmark.type}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{bookmark.name}</div>
                    <p className="text-sm text-gray-500 mt-1">{bookmark.notes}</p>
                  </div>
                </div>
                <button className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors">
                  <span>Open</span>
                  <ArrowRight className="h-4 w-4 text-gray-400" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  } else if (activeTab === "team") {
    mainContent = (
      <div className="px-6 pb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Assigned Team ({trialTeamMembers.length})</h2>
            <Button variant="outline" size="sm" onClick={() => setManageTeamOpen(true)}>
              Manage Team
            </Button>
          </div>
          {trialTeamMembers.length === 0 ? (
            <p className="text-sm text-gray-500">No members assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {trialTeamMembers.map((member) => (
                <div key={member.id} className="rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-3">
                  <Avatar className="h-8 w-8 rounded-md border border-gray-200 bg-gray-100">
                    <AvatarImage src={member.avatar || undefined} alt={member.name} className="rounded-md object-cover" />
                    <AvatarFallback className="rounded-md bg-[#e6e7eb] text-gray-600">
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-500">{member.role}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  } else if (activeTab === "patients") {
    mainContent = (
      <div className="px-6 pb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900">Patients</h2>
          <p className="text-sm text-gray-500 mt-1">Enrollment tracking for this trial.</p>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Enrolled Patients</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{enrolledPatients}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Target Patients</p>
              <p className="text-3xl font-semibold text-gray-900 mt-2">{targetPatients}</p>
            </div>
          </div>
        </div>
      </div>
    );
  } else if (activeTab === "notifications") {
    mainContent = (
      <div className="px-6 pb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
          <p className="text-sm text-gray-500 mt-1">Trial-level alerts and reminders will appear here.</p>
        </div>
      </div>
    );
  } else if (activeTab === "settings") {
    mainContent = (
      <div className="px-6 pb-6 space-y-5">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900">Trial Settings</h2>
          <p className="text-sm text-gray-500 mt-1">
            Manage stable configuration and safety-critical actions for this trial.
          </p>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Trial ID</p>
              <p className="mt-1 font-medium text-gray-900">{trialId}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Data Mode</p>
              <p className="mt-1 font-medium text-gray-900">{currentDataMode}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Created</p>
              <p className="mt-1 font-medium text-gray-900">{formatDate((trial as any)?.createdAt)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Last Updated</p>
              <p className="mt-1 font-medium text-gray-900">{formatDate((trial as any)?.updatedAt)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900">Workspace Controls</h2>
          <p className="text-sm text-gray-500 mt-1">
            Team assignment is managed in the Team tab. Document controls are managed in Document Hub.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setActiveTab("team")}>
              Manage Team
            </Button>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("document-hub")}>
              Open Document Hub
            </Button>
            <Button variant="outline" size="sm" onClick={() => setActiveTab("overview")}>
              Open Overview
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-red-200 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
              <p className="text-sm text-red-600 mt-1">
                Deleting a trial removes all associated sandbox data: documents, setup plan, and AI context snapshots.
              </p>
            </div>
          </div>

          <div className="mt-5 max-w-sm space-y-2">
            <label className="text-sm font-medium text-gray-700">Type `DELETE` to enable</label>
            <Input
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              placeholder="Type DELETE"
            />
          </div>

          <div className="mt-4">
            <Button
              onClick={handleDeleteTrialFromSettings}
              disabled={deleteConfirmText !== "DELETE" || deleteTrialMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleteTrialMutation.isPending ? "Deleting..." : "Delete Trial"}
            </Button>
          </div>
        </div>
      </div>
    );
  } else if (activeTab === "visit-template") {
    mainContent = (
      <div className="px-6 pb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900">Visit Template</h2>
          <p className="text-sm text-gray-500 mt-1">Visit template tools will be available here.</p>
        </div>
      </div>
    );
  } else {
    mainContent = (
      <div className="px-6 pb-6 space-y-5">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700/70">
              Investigational Product / Drug Name
            </p>
            <EditableField
              value={trial?.investigationalProduct || ""}
              onSave={async (newValue) => {
                await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, investigationalProduct: newValue });
              }}
              emptyText="Add investigational product"
              className="mt-2 text-3xl font-semibold text-gray-900"
            />

            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-400">Sponsor:</span>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <EditableField
                    value={trial?.sponsor || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, sponsor: newValue });
                    }}
                    emptyText="Add sponsor"
                    className="text-sm font-medium text-gray-900 min-w-0"
                  />
                  {sponsorLogoUrl && !sponsorLogoFailed ? (
                    <img
                      src={sponsorLogoUrl}
                      alt={`${trial?.sponsor || "Sponsor"} logo`}
                      className="h-7 w-7 rounded-sm border border-gray-200 bg-white object-contain p-0.5"
                      onError={() => setSponsorLogoFailed(true)}
                    />
                  ) : (
                    <div className="h-7 min-w-7 rounded-sm border border-gray-200 bg-blue-50 text-blue-700 text-[10px] font-semibold flex items-center justify-center px-1">
                      {sponsorInitials}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-400">Phase:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.phase || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, phase: newValue });
                    }}
                    emptyText="Add phase"
                    className="text-sm font-medium text-gray-900"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-400">Protocol Number:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.protocolNumber || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, protocolNumber: newValue });
                    }}
                    emptyText="Add protocol number"
                    className="text-sm font-medium text-gray-900"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-400">NCT Number:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.nctNumber || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, nctNumber: newValue });
                    }}
                    emptyText="Add NCT number"
                    className="text-sm font-medium text-gray-900"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-400">Current Version:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.currentVersion || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, currentVersion: newValue });
                    }}
                    emptyText="Add current version"
                    className="text-sm font-medium text-gray-900"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-400">Location:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.location || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, location: newValue });
                    }}
                    emptyText="Add location"
                    className="text-sm font-medium text-gray-900"
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-1">
              <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Protocol Title:</span>
              <div className="mt-1">
                <EditableField
                  value={trial?.title || ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, title: newValue });
                  }}
                  emptyText="Add protocol title"
                  className="text-sm text-gray-900"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Operational Status</h2>
            </div>

            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase tracking-wide font-semibold text-blue-700">
                  Themison AI Recommendation
                </div>
                {primarySuggestion ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      primarySuggestion.priority === "high"
                        ? "bg-red-100 text-red-700"
                        : primarySuggestion.priority === "medium"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {primarySuggestion.priority}
                  </span>
                ) : null}
              </div>
              {primarySuggestion ? (
                <p className="text-sm font-medium text-blue-900 mt-1">{primarySuggestion.title}</p>
              ) : null}
              <p className="text-sm text-blue-800 mt-1">{aiRecommendation}</p>
            </div>

            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">Status:</span>
                <EditableField
                  value={trialStatusValue}
                  displayValue={trialStatusLabel}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, status: newValue as any });
                  }}
                  type="select"
                  options={[
                    { value: "not-started", label: "Not started" },
                    { value: "active", label: "Active" },
                    { value: "recruiting", label: "Recruiting" },
                    { value: "on-hold", label: "On hold" },
                    { value: "completed", label: "Completed" },
                    { value: "terminated", label: "Terminated" },
                  ]}
                  emptyText="Not started"
                  className="text-sm"
                  displayClassName={trialStatusDisplayClass}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">Start Date:</span>
                <EditableField
                  value={trial?.startDate ? new Date(trial.startDate).toISOString().split("T")[0] : ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, startDate: newValue });
                  }}
                  type="date"
                  emptyText="Set date"
                  className="text-sm text-gray-900"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-gray-600">End Date:</span>
                <EditableField
                  value={trial?.endDate ? new Date(trial.endDate).toISOString().split("T")[0] : ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, endDate: newValue });
                  }}
                  type="date"
                  emptyText="Set date"
                  className="text-sm text-gray-900"
                />
              </div>
            </div>

            <div className="mt-4 border-t border-gray-200 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Patients</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{enrolledPatients.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-gray-500">Target: {(targetPatients || 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Enrollment Progress</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{enrollmentPercent}%</p>
                  <p className="mt-1 text-xs text-gray-500">Current recruitment progress</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Pending Tasks</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{pendingTasks.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {dueTodayTasks} due today
                    {overdueTasks > 0 ? ` · ${overdueTasks} overdue` : ""}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Task Completion</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{completionRate}%</p>
                  <p className="mt-1 text-xs text-gray-500">{completedTasks.toLocaleString()} completed tasks</p>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                className="h-9 w-full justify-center"
                onClick={() => navigate(`/trial/${trialId}/assistant`)}
              >
                <Brain className="h-4 w-4 mr-2" />
                Ask Themison AI
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Themison AI Signals</h2>
            <span className="text-xs text-gray-500">{contextSuggestions.length} signals</span>
          </div>
          <div className="mt-3 space-y-2">
            {contextSuggestions.length > 0 ? (
              contextSuggestions.slice(0, 3).map((signal) => (
                <div key={signal.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-900">{signal.title}</div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        signal.priority === "high"
                          ? "bg-red-100 text-red-700"
                          : signal.priority === "medium"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {signal.priority}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{signal.description}</div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                No active signals for this page right now.
              </div>
            )}
            {primarySuggestion ? (
              <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleAiRecommendedAction}>
                <Sparkles className="h-4 w-4 mr-2" />
                {recommendedActionLabel}
              </Button>
            ) : null}
          </div>

          <div className="mt-5 border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {nextOperationalTasks.length > 0 ? "Next Operational Tasks" : "AI Launch Checklist"}
              </h3>
              {nextOperationalTasks.length > 0 ? (
                <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => setActiveTab("study-setup-wizard")}>
                  View plan
                </button>
              ) : null}
            </div>

            {nextOperationalTasks.length > 0 ? (
              <div className="mt-3 space-y-2">
                {nextOperationalTasks.map((task: any, index: number) => (
                  <div key={`${task.id ?? index}`} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <div className="text-sm font-medium text-gray-900">{task.name || "Untitled task"}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {task.protocolSection ? `Source: ${task.protocolSection}` : "Generated from protocol"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {launchChecklist.map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 flex items-start gap-2">
                    <div className={`mt-0.5 h-4 w-4 rounded-full flex items-center justify-center ${item.done ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-500"}`}>
                      {item.done ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{item.title}</div>
                      <div className="text-xs text-gray-500 mt-1">{item.subtitle}</div>
                    </div>
                  </div>
                ))}
                {!primarySuggestion && firstIncompleteChecklistItem ? (
                  <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleAiRecommendedAction}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {recommendedActionLabel}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900">Study Design & Objectives</h2>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 md:col-span-2">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Indication / Therapeutic Area:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.indication || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, indication: newValue });
                    }}
                    emptyText="Add indication"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Sample Size:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.sampleSize || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, sampleSize: newValue });
                    }}
                    emptyText="Add sample size"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Number of Sites:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.numberOfSites || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, numberOfSites: newValue });
                    }}
                    emptyText="Add number of sites"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Study Duration:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.studyDuration || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, studyDuration: newValue });
                    }}
                    emptyText="Add study duration"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1 md:col-span-2">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Study Design Type:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.studyDesignType || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, studyDesignType: newValue });
                    }}
                    emptyText="Add study design type"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1 md:col-span-2">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Primary Objective:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.primaryObjective || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, primaryObjective: newValue });
                    }}
                    emptyText="Add primary objective"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>

              <div className="space-y-1 md:col-span-2">
                <span className="block text-xs font-semibold text-gray-400 uppercase tracking-wide">Primary Endpoint:</span>
                <div className="mt-1">
                  <EditableField
                    value={trial?.primaryEndpoint || ""}
                    onSave={async (newValue) => {
                      await updateTrial.mutateAsync({ id: trialId, demoMode: currentDataMode, primaryEndpoint: newValue });
                    }}
                    emptyText="Add primary endpoint"
                    className="text-sm text-gray-900"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">Assigned Team ({trialTeamMembers.length})</h2>
                <button className="text-xs text-blue-600 hover:text-blue-700" onClick={() => setManageTeamOpen(true)}>
                  Manage Team
                </button>
              </div>
              {trialTeamMembers.length === 0 ? (
                <p className="text-sm text-gray-500 mt-3">No team members assigned.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {trialTeamMembers.map((member) => (
                    <div key={member.id} className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 rounded-md border border-gray-200 bg-gray-100">
                        <AvatarImage src={member.avatar || undefined} alt={member.name} className="rounded-md object-cover" />
                        <AvatarFallback className="rounded-md bg-[#e6e7eb] text-gray-600">
                          <User className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{member.name}</p>
                        <p className="text-xs text-gray-500">{member.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={`bg-[#F9FAFB] flex flex-col ${
        lockPageScrollToScaffold ? "h-full overflow-hidden" : "min-h-full"
      }`}
    >
      <div className="sticky top-0 z-30 bg-[#F9FAFB] px-6 pt-3 pb-1 border-b border-transparent">
        <div className="flex h-11 items-center gap-6 rounded-md border border-gray-200 bg-white px-5 py-0">
          <button
            onClick={() => {
              logEvent({
                eventType: "feature_used",
                action: "back_to_trials",
                entityType: "navigation",
                payload: { from: "trial_detail" },
              });
              navigate("/trial-workspace");
            }}
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors pr-5 border-r border-gray-200"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>All Trials</span>
          </button>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    logEvent({
                      eventType: "feature_used",
                      action: "switch_tab",
                      entityType: "trial_tab",
                      entityId: tab.id,
                      payload: { trialId },
                    });
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                    activeTab === tab.id ? "text-blue-700 bg-blue-50" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={lockPageScrollToScaffold ? "pt-4 flex-1 min-h-0 overflow-hidden" : "pt-4"}>
        {mainContent}
      </div>

      <Dialog
        open={setupTaskModalOpen}
        onOpenChange={(open) => {
          setSetupTaskModalOpen(open);
          if (!open) {
            setSetupEditingTaskId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl p-0 overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b border-gray-200">
            <DialogTitle className="text-3xl font-bold text-gray-900">
              {setupTaskModalMode === "create" ? "Create New Task" : "Edit Task"}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">Title *</label>
              <Input
                value={setupTaskForm.title}
                onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Enter task title"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">Description</label>
              <Textarea
                rows={4}
                value={setupTaskForm.description}
                onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Enter task description (optional)"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Trial *</label>
                <Input
                  value={`${trial?.investigationalProduct || trial?.title || trialId} · ${trial?.sponsor || "No sponsor"}`}
                  disabled
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Phase / Visit *</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={setupTaskForm.phaseId}
                  onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, phaseId: event.target.value }))}
                >
                  <option value="">Select phase</option>
                  {setupPhases.map((phase) => (
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
                  value={setupTaskForm.category}
                  onChange={(event) =>
                    setSetupTaskForm((prev) => ({ ...prev, category: event.target.value as TaskCategory }))
                  }
                >
                  {SETUP_TASK_CATEGORY_OPTIONS.map((category) => (
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
                  value={setupTaskForm.status}
                  onChange={(event) =>
                    setSetupTaskForm((prev) => ({ ...prev, status: event.target.value as TaskStatus }))
                  }
                >
                  {SETUP_TASK_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {titleCase(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-900">Priority</label>
                <select
                  className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                  value={setupTaskForm.priority}
                  onChange={(event) =>
                    setSetupTaskForm((prev) => ({ ...prev, priority: event.target.value as TaskPriority }))
                  }
                >
                  {SETUP_TASK_PRIORITY_OPTIONS.map((priority) => (
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
                  value={setupTaskForm.assignedRole}
                  onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, assignedRole: event.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {SETUP_ASSIGNED_ROLE_OPTIONS.map((role) => (
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
                  value={setupTaskForm.assigneeMemberId}
                  onChange={(event) => {
                    const nextMemberId = event.target.value;
                    const member = setupAssignedMembersForTaskForm.find(
                      (candidate) => String(candidate.id) === nextMemberId
                    );
                    const inferredRole = member ? normalizeRoleToken(member.role || "") : "";
                    setSetupTaskForm((prev) => ({
                      ...prev,
                      assigneeMemberId: nextMemberId,
                      assignedRole:
                        inferredRole && SETUP_ASSIGNED_ROLE_OPTIONS.includes(inferredRole as any)
                          ? inferredRole
                          : prev.assignedRole,
                    }));
                  }}
                >
                  <option value="">Unassigned</option>
                  {setupAssignedMembersForTaskForm.map((member) => (
                    <option key={member.id} value={String(member.id)}>
                      {member.name} · {formatRoleLabel(member.role)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-900">Due Date</label>
              <Input
                type="date"
                value={setupTaskForm.dueDate}
                onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, dueDate: event.target.value }))}
              />
            </div>

            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-900">Protocol Source (optional)</h4>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    const protocolDoc =
                      protocols.find((doc: any) => String(doc?.category || "").toLowerCase().includes("protocol")) ||
                      protocols[0];
                    const url = protocolDoc?.fileUrl as string | undefined;
                    if (!url) {
                      toast.error("No protocol PDF available to open");
                      return;
                    }
                    const page = Number(setupTaskForm.sourcePage);
                    const target = Number.isFinite(page) && page > 0 ? `${url}#page=${Math.round(page)}` : url;
                    window.open(target, "_blank", "noopener,noreferrer");
                  }}
                >
                  Open protocol
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-gray-700">Section</label>
                  <Input
                    value={setupTaskForm.sourceSection}
                    onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, sourceSection: event.target.value }))}
                    placeholder="e.g. Schedule of Events"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-gray-700">Page</label>
                  <Input
                    type="number"
                    min={1}
                    value={setupTaskForm.sourcePage}
                    onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, sourcePage: event.target.value }))}
                    placeholder="e.g. 22"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm text-gray-700">Evidence Text</label>
                  <Textarea
                    rows={3}
                    value={setupTaskForm.sourceText}
                    onChange={(event) => setSetupTaskForm((prev) => ({ ...prev, sourceText: event.target.value }))}
                    placeholder="Optional excerpt for traceability"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-900">Dependencies (predecessor tasks)</h4>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {setupDependencyCandidates.length === 0 ? (
                  <p className="text-sm text-gray-500">No dependency candidates in this trial map.</p>
                ) : (
                  setupDependencyCandidates.map((candidate) => {
                    const phase = setupPhases.find((entry) => entry.id === candidate.phaseId);
                    const checked = setupDependencyTaskIds.includes(candidate.id);
                    return (
                      <label key={candidate.id} className="flex items-start gap-2 rounded-md border border-gray-100 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const nextChecked = event.target.checked;
                            setSetupDependencyTaskIds((prev) =>
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
              {setupTaskModalMode === "edit" && setupEditingTaskId ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm text-red-600 hover:text-red-700"
                  onClick={handleDeleteSetupTaskFromModal}
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
                  setSetupTaskModalOpen(false);
                  setSetupEditingTaskId(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-9 rounded-md bg-[#2F6FED] px-4 text-sm font-medium text-white hover:bg-[#255BD1]"
                onClick={handleSaveSetupTaskModal}
              >
                {setupTaskModalMode === "create" ? "Create Task" : "Save Changes"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageTeamOpen} onOpenChange={setManageTeamOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Team</DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3 flex items-center justify-between gap-4">
            <div className="text-sm text-blue-700">
              <div>Can’t find someone?</div>
              <div>Create a new member here to update your Organization list.</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAddMemberOpen(true)}>
              Create New Member
            </Button>
          </div>

          <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
            {(state.teamMembers || []).map((member, index) => {
              const isSelected = assignedMemberIds.includes(member.id);
              const isSuggested = index < 3;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleAssignedMember(member.id)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-colors flex items-center justify-between ${
                    isSelected ? "border-blue-200 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-5 w-5 rounded border border-gray-300 flex items-center justify-center bg-white">
                      {isSelected ? <Check className="h-3.5 w-3.5 text-blue-600" /> : null}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{member.name}</div>
                      <div className="text-xs text-gray-500">{member.clinicalRole || member.role}</div>
                    </div>
                  </div>
                  {isSuggested ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                      Suggested
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <AddMemberPanel
        open={addMemberOpen}
        onClose={() => setAddMemberOpen(false)}
        editingMemberId={null}
        initialValues={{
          name: "",
          email: "",
          avatar: null,
          clinicalRole: "Principal Investigator",
          appRole: "Admin",
          team: "",
          site: "",
        }}
        onMemberSaved={(memberId) => {
          persistAssignedMembers(assignedMemberIds.includes(memberId) ? assignedMemberIds : [...assignedMemberIds, memberId]);
        }}
      />
    </div>
  );
}
