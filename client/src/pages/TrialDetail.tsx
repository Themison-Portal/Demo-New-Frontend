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
  UserPlus2,
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
} from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

export default function TrialDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/trial/:id");
  const [activeTab, setActiveTab] = useState("overview");
  const [isGeneratingScaffold, setIsGeneratingScaffold] = useState(false);
  const [manageTeamOpen, setManageTeamOpen] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [assignedMemberIds, setAssignedMemberIds] = useState<string[]>([]);
  const [sponsorLogoFailed, setSponsorLogoFailed] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const { getCurrentDataMode, state } = useDemoState();
  const currentDataMode = getCurrentDataMode();

  const trialId = (params?.id || "").toLowerCase();
  const isValidTrialId = trialId.length > 0;

  const { data: protocols = [] } = trpc.documents.list.useQuery(
    { trialId, demoMode: currentDataMode },
    { enabled: isValidTrialId }
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
    { trialId, includeArchived: false },
    { enabled: isValidTrialId }
  );

  const map = useMapStore((store) => store.map);
  const mapPhases = useMapStore((store) => store.phases);
  const mapTasks = useMapStore((store) => store.tasks);
  const mapDependencies = useMapStore((store) => store.dependencies);
  const mapSections = useMapStore((store) => store.protocolMapSections);
  const loadExecutionMap = useMapStore((store) => store.loadMap);
  const launchExecutionMap = useMapStore((store) => store.launchMap);
  const addExecutionTask = useMapStore((store) => store.addTask);
  const updateExecutionTask = useMapStore((store) => store.updateTask);
  const removeExecutionTask = useMapStore((store) => store.removeTask);
  const reorderExecutionTasks = useMapStore((store) => store.reorderTasks);

  const bootstrapGuardRef = useRef<string | null>(null);

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
      emitTelemetry: activeTab === "overview" || activeTab === "document-hub",
    },
    {
      enabled: isValidTrialId && (activeTab === "overview" || activeTab === "document-hub"),
      staleTime: 30000,
    }
  );

  useEffect(() => {
    if (!isValidTrialId) {
      toast.error("Invalid trial ID");
      navigate("/trial-workspace");
    }
  }, [isValidTrialId, navigate]);

  useEffect(() => {
    if (typeof window === "undefined" || !trialId) return;
    const storageKey = `trial-team:${currentDataMode}:${trialId}`;
    const stored = window.localStorage.getItem(storageKey);
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
  }, [trialId, currentDataMode]);

  useEffect(() => {
    const mapId = executionMapSummary?.id;
    if (!mapId) return;
    void loadExecutionMap(mapId).catch((error) => {
      console.error("Failed to load execution map:", error);
      toast.error("Failed to load execution map");
    });
  }, [executionMapSummary?.id, loadExecutionMap]);

  const utils = trpc.useUtils();
  const updateTrial = trpc.trials.update.useMutation({
    onSuccess: async () => {
      await utils.trials.getById.invalidate({ id: trialId, demoMode: currentDataMode });
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
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
        })),
    [state.teamMembers, assignedMemberIds]
  );

  const persistAssignedMembers = (nextIds: string[]) => {
    setAssignedMemberIds(nextIds);
    if (typeof window !== "undefined") {
      const storageKey = `trial-team:${currentDataMode}:${trialId}`;
      window.localStorage.setItem(storageKey, JSON.stringify(nextIds));
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

  const handleGenerateScaffold = async () => {
    if (!protocols || protocols.length === 0) {
      toast.error("No protocol found", {
        description: "Please upload a protocol in the Document Hub first.",
      });
      return;
    }

    if (!trial) return;

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
      const imported = await importLegacyScaffold.mutateAsync({
        trialId: trial.id,
        protocolId: protocols[0].id,
        clearExisting: true,
      });
      await refetchExecutionMapSummary();
      if (imported?.mapId) {
        await loadExecutionMap(imported.mapId);
      }
      logEvent({
        eventType: "trial_setup_step_completed",
        action: "generated",
        entityType: "task_scaffold",
        payload: { trialId, demoMode: currentDataMode, mapId: imported?.mapId ?? null },
        aiInvolved: true,
      });
      toast.success("Execution map generated");
    } catch (error: any) {
      console.error("Failed to generate scaffold:", error);
      toast.error("Failed to generate execution plan", {
        description: error?.message || "Please upload a protocol in Document Hub and try again.",
      });
    } finally {
      setIsGeneratingScaffold(false);
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
  ]);

  const enrolledPatients = trial?.enrolledPatients || 0;
  const targetPatients = trial?.targetPatients || 0;
  const enrollmentPercent = targetPatients > 0 ? Math.round((enrolledPatients / targetPatients) * 100) : 0;
  const scaffoldTasks =
    mapTasks.length > 0
      ? mapTasks
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
  const totalTasks = pendingTasks + completedTasks;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const scheduledVisits = (mapPhases.length > 0 ? mapPhases : existingScaffold?.phases || []).filter((phase: any) =>
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
  const contextSuggestions = (trialContext?.suggestions || []) as Array<{
    id: string;
    title: string;
    description: string;
    actionLabel: string;
    actionTarget: "overview" | "document-hub" | "study-setup-wizard" | "assistant";
    category: string;
    priority: "high" | "medium" | "low";
    confidence: number;
  }>;
  const primarySuggestion = contextSuggestions[0];

  useEffect(() => {
    setSponsorLogoFailed(false);
  }, [sponsorLogoUrl]);

  useEffect(() => {
    if (activeTab !== "settings") {
      setDeleteConfirmText("");
    }
  }, [activeTab]);

  const hasText = (value?: string | null) => Boolean(value && value.trim().length > 0);
  const hasProtocolInHub = protocols.some((doc: any) => {
    const category = String(doc?.category || "").toLowerCase();
    const filename = String(doc?.filename || "").toLowerCase();
    return category.includes("protocol") || filename.includes("protocol");
  });
  const trialProfileReady = [
    trial?.protocolNumber,
    trial?.sponsor,
    trial?.phase,
    trial?.investigationalProduct,
    trial?.indication,
  ].filter(hasText).length >= 4;
  const timelineReady = Boolean(trial?.startDate) && Boolean(trial?.endDate);
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
      id: "protocol-profile",
      title: "Confirm AI-extracted trial profile",
      subtitle: "Protocol number, sponsor, phase, indication, and product.",
      done: trialProfileReady,
    },
    {
      id: "setup-wizard",
      title: "Generate execution plan in Study Setup Agent",
      subtitle: "Convert protocol requirements into operational tasks.",
      done: scaffoldTasks.length > 0,
    },
    {
      id: "team",
      title: "Assign trial team members",
      subtitle: "Add PI/CRC and required site roles.",
      done: trialTeamMembers.length > 0,
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
      : "Review extracted trial profile to ensure execution starts from verified data."
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
      : "Review Profile in Themison AI"
    : nextOperationalTasks.length > 0
    ? "Open Study Setup Agent"
    : "Open Themison AI";
  const launchReadyWithoutActivation = launchChecklist
    .filter((item) => item.id !== "activate-trial")
    .every((item) => item.done);

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
    if (firstIncompleteChecklistItem.id === "protocol-profile") {
      navigate(`/trial/${trialId}/assistant`);
    }
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
    if (mapPhases.length === 0) return [];
    const taskById = new Map(mapTasks.map((task) => [task.id, task]));
    const depsByTask = new Map<string, any[]>();
    for (const dep of mapDependencies) {
      const current = depsByTask.get(dep.targetTaskId) ?? [];
      current.push({
        ...dep,
        sourceTaskName: taskById.get(dep.sourceTaskId)?.name || null,
      });
      depsByTask.set(dep.targetTaskId, current);
    }

    return [...mapPhases]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((phase) => {
        const phaseTasks = mapTasks
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
              suggestedDate: task.suggestedDate ? new Date(task.suggestedDate) : task.dueDate ? new Date(task.dueDate) : null,
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
  }, [mapPhases, mapTasks, mapDependencies]);

  const setupSections = useMemo(() => {
    if (mapSections.length === 0) return [];
    return [...mapSections]
      .sort((a, b) => a.displayOrder - b.displayOrder)
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
  }, [mapSections]);

  const handleAddSetupTask = async () => {
    if (!map?.id || setupPhases.length === 0) {
      toast.error("No execution map loaded");
      return;
    }
    const name = window.prompt("Task name");
    if (!name || !name.trim()) return;
    try {
      await addExecutionTask(setupPhases[0].id, {
        name: name.trim(),
        createdBy: "user",
        isCustom: true,
        status: map.status === "active" ? "todo" : "suggested",
        category: "custom",
        priority: "medium",
        protocolRefs: [],
      });
      toast.success("Task added");
    } catch (error: any) {
      toast.error(`Failed to add task: ${error?.message || "Unknown error"}`);
    }
  };

  const handleEditSetupTask = async (taskId: string) => {
    const task = mapTasks.find((row) => row.id === taskId);
    if (!task) return;
    const name = window.prompt("Edit task name", task.name);
    if (!name || !name.trim() || name.trim() === task.name) return;
    try {
      await updateExecutionTask(taskId, { name: name.trim() });
      toast.success("Task updated");
    } catch (error: any) {
      toast.error(`Failed to update task: ${error?.message || "Unknown error"}`);
    }
  };

  const handleDeleteSetupTask = async (taskId: string) => {
    const task = mapTasks.find((row) => row.id === taskId);
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
    try {
      await launchExecutionMap();
      await refetchExecutionMapSummary();
      toast.success("Execution map launched");
    } catch (error: any) {
      toast.error(`Failed to launch map: ${error?.message || "Review suggested tasks first."}`);
    }
  };

  let mainContent: React.ReactNode = null;
  const hasRenderableSetupMap = !!map?.id && setupPhases.length > 0 && mapTasks.length > 0;

  if (activeTab === "document-hub") {
    mainContent = (
      <div className="px-6 pb-6">
        <Documents trialId={trialId} />
      </div>
    );
  } else if (activeTab === "study-setup-wizard") {
    const isSyncingExecutionMap = importLegacyScaffold.isPending && !map?.id;
    mainContent = hasRenderableSetupMap ? (
      <div className="px-6 pb-6">
        <TaskScaffoldView
          phases={setupPhases}
          sections={setupSections}
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
    ) : (
      <div className="px-6 pb-6 space-y-3">
        {isSyncingExecutionMap && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Syncing generated scaffold into the execution map...
          </div>
        )}
        <StudySetupWizardEntry
          trialId={trialId}
          onGenerate={() => {
            void handleGenerateScaffold();
          }}
          isGenerating={isGeneratingScaffold || isSyncingExecutionMap}
        />
      </div>
    );
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
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-xs bg-blue-50 text-blue-700">{member.initials || "TM"}</AvatarFallback>
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
                  value={trial?.status || "not-started"}
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
                  className="text-sm text-gray-900"
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

            <div className="mt-4 border-t border-gray-200 pt-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Enrollment:</span>
                <span className="font-medium text-gray-900">{enrolledPatients} / {targetPatients || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Pending Tasks:</span>
                <span className="font-medium text-gray-900">{pendingTasks} ({dueTodayTasks} due today)</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Scheduled Visits:</span>
                <span className="font-medium text-gray-900">{scheduledVisits}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="h-9" onClick={() => setManageTeamOpen(true)}>
                Manage Team
              </Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => setActiveTab("document-hub")}>
                View Protocol
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-9 text-sm" onClick={() => navigate(`/trial/${trialId}/assistant`)}>
              <Sparkles className="h-4 w-4 mr-2" />
              Themison AI
            </Button>
            {(trial?.status || "not-started") === "not-started" && launchReadyWithoutActivation ? (
              <Button
                variant="outline"
                className="h-9 text-sm"
                onClick={async () => {
                  await updateTrial.mutateAsync({
                    id: trialId,
                    demoMode: currentDataMode,
                    status: "active",
                  });
                }}
              >
                Activate Trial
              </Button>
            ) : null}
            <Button variant="outline" className="h-9 text-sm">
              <UserPlus2 className="h-4 w-4 mr-2" />
              Sign a New Patient
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Patients</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{enrolledPatients.toLocaleString()}</p>
            <p className="mt-1 text-xs text-gray-500">Target: {targetPatients || 0}</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Enrollment Progress</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{enrollmentPercent}%</p>
            <p className="mt-1 text-xs text-gray-500">Current recruitment progress</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Pending Tasks</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{pendingTasks.toLocaleString()}</p>
            <p className="mt-1 text-xs text-gray-500">Due today: {dueTodayTasks}</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-400">Task Completion</p>
            <p className="mt-2 text-3xl font-semibold text-gray-900">{completionRate}%</p>
            <p className="mt-1 text-xs text-gray-500">{completedTasks.toLocaleString()} completed tasks</p>
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
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs bg-blue-50 text-blue-700">{member.initials || "TM"}</AvatarFallback>
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
    <div className="h-full bg-[#F9FAFB]">
      <div className="sticky top-0 z-30 bg-[#F9FAFB] px-6 pt-3 pb-1 border-b border-transparent">
        <div className="bg-white rounded-lg border border-gray-200 px-5 py-2 flex items-center gap-6">
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

      <div className="pt-4">{mainContent}</div>

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
