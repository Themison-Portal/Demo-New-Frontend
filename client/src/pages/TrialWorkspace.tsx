/**
 * TrialWorkspace Page Component
 * Design: Clinical Modernism - Card-based trial overview with filters and status grouping
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddMemberPanel } from "@/components/AddMemberPanel";
import {
  Plus,
  ChevronDown,
  X,
  Upload,
  Check,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Database,
  ClipboardList,
  FolderOpen,
  Calendar,
  Cloud,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { TrialCard } from "@/components/TrialCard";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";
import { useLocation } from "wouter";

export function TrialWorkspace() {
  const [, navigate] = useLocation();
  const [searchFilter, setSearchFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [piFilter, setPiFilter] = useState("all");
  const [sortBy, setSortBy] = useState("recently-updated");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showActiveTrials, setShowActiveTrials] = useState(true);
  const [showPaused, setShowPaused] = useState(true);
  const [showClosed, setShowClosed] = useState(true);
  const [createTrialOpen, setCreateTrialOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const totalSteps = 6;
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [protocolBase64, setProtocolBase64] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "indexing" | "indexed">("idle");
  // Synchronous re-entry guard for handleSubmitTrial — blocks a double-click from
  // creating two trials + two protocol uploads (concurrent RAG ingest → OOM).
  const isSubmittingTrialRef = useRef(false);
  // Once the protocol is uploaded for the current create session, don't upload it
  // again — prevents a retained file from being re-uploaded into a second trial.
  // Reset in resetCreateTrialForm when a new create session starts.
  const protocolUploadedRef = useRef(false);
  const [indexedAnimationInstance, setIndexedAnimationInstance] = useState(0);
  const { getCurrentDataMode, state } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const utils = trpc.useUtils();

  const [protocolTitle, setProtocolTitle] = useState("");
  const [protocolNumber, setProtocolNumber] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [trialPhase, setTrialPhase] = useState<string>("");
  const [investigationalProduct, setInvestigationalProduct] = useState("");
  const [indication, setIndication] = useState("");
  const [nctNumber, setNctNumber] = useState("");
  const [currentVersion, setCurrentVersion] = useState("");
  const [amendmentVersion, setAmendmentVersion] = useState("");
  const [releaseDate, setReleaseDate] = useState("");
  const [location, setLocation] = useState("");
  const [sampleSize, setSampleSize] = useState("");
  const [numberOfSites, setNumberOfSites] = useState("");
  const [studyDuration, setStudyDuration] = useState("");
  const [studyDesignType, setStudyDesignType] = useState("");
  const [primaryObjective, setPrimaryObjective] = useState("");
  const [primaryEndpoint, setPrimaryEndpoint] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedTeamMembers, setSelectedTeamMembers] = useState<string[]>([]);
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [createdTrialForTeaser, setCreatedTrialForTeaser] = useState<{
    id: string;
    drugName: string;
    sponsorName: string;
  } | null>(null);
  const analyzeProtocolMutation = trpc.studySetupWizard.analyzeProtocol.useMutation();
  const uploadDocumentMutation = trpc.documents.upload.useMutation();

  // Fetch trials from database
  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });
  const executionWorkspaceQuery = trpc.map.loadWorkspace.useQuery(
    {
      trialIds: trials.map((trial) => trial.id),
      includeArchived: false,
      demoMode: currentDataMode,
    },
    {
      enabled: trials.length > 0,
    }
  );
  const createTrialMutation = trpc.trials.create.useMutation({
    onError: (error) => {
      toast.error(`Failed to create trial: ${error.message}`);
    },
  });

  const resetCreateTrialForm = () => {
    setCreateStep(1);
    setProtocolTitle("");
    setProtocolNumber("");
    setSponsor("");
    setTrialPhase("");
    setInvestigationalProduct("");
    setIndication("");
    setNctNumber("");
    setCurrentVersion("");
    setAmendmentVersion("");
    setReleaseDate("");
    setLocation("");
    setSampleSize("");
    setNumberOfSites("");
    setStudyDuration("");
    setStudyDesignType("");
    setPrimaryObjective("");
    setPrimaryEndpoint("");
    setStartDate("");
    setEndDate("");
    setSelectedTeamMembers([]);
    setAiFilledFields(new Set());
    setAddMemberOpen(false);
    setProtocolFile(null);
    setProtocolBase64(null);
    protocolUploadedRef.current = false;
    setUploadState("idle");
    setIndexedAnimationInstance(0);
    setCreatedTrialForTeaser(null);
  };

  // Close the create-trial dialog AND reset the form, so a retained protocol file
  // can never survive a close and get re-uploaded into a later trial.
  const closeCreateTrial = () => {
    setCreateTrialOpen(false);
    resetCreateTrialForm();
  };

  const currentMember = useMemo(() => {
    return (state.teamMembers || [])[0] ?? null;
  }, [state.teamMembers]);

  const teamMemberById = useMemo(() => {
    return new Map((state.teamMembers || []).map((member) => [String(member.id), member]));
  }, [state.teamMembers]);

  const taskProgressByTrial = useMemo(() => {
    const summaryByTrial = new Map<
      string,
      {
        total: number;
        completed: number;
        percent: number;
      }
    >();

    const rows = (executionWorkspaceQuery.data || []) as Array<{
      map?: { trialId?: string };
      tasks?: Array<{ status?: string | null }>;
    }>;

    for (const row of rows) {
      const trialId = String(row?.map?.trialId || "").toLowerCase();
      if (!trialId) continue;
      const trialTasks = Array.isArray(row?.tasks) ? row.tasks : [];
      const total = trialTasks.length;
      const completed = trialTasks.filter((task) => {
        const status = String(task?.status || "").toLowerCase();
        return status === "done" || status === "completed";
      }).length;
      const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

      summaryByTrial.set(trialId, {
        total,
        completed,
        percent,
      });
    }

    return summaryByTrial;
  }, [executionWorkspaceQuery.data]);

  const trialsWithMeta = useMemo(() => {
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

      // Compatibility fix for old sample-size parsing that concatenated all digits.
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
    const memberSites = (state.teamMembers || [])
      .map((member) => member.site)
      .filter((site): site is string => Boolean(site));
    const fallbackSites = ["Copenhagen", "Brussels", "Amsterdam", "London", "Berlin", "Paris", "Lisbon"];
    const baseSites = memberSites.length ? memberSites : fallbackSites;
    const assignedMemberIdsByTrial = new Map<string, string[]>();

    if (typeof window !== "undefined") {
      const prefix = `trial-team:${currentDataMode}:`;
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(prefix)) continue;
        const trialId = key.slice(prefix.length).toLowerCase();
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) continue;
          const memberIds = parsed.map((entry) => String(entry)).filter(Boolean);
          if (!memberIds.length) continue;
          const existing = assignedMemberIdsByTrial.get(trialId) || [];
          assignedMemberIdsByTrial.set(trialId, Array.from(new Set([...existing, ...memberIds])));
        } catch {
          continue;
        }
      }
    }

    const withLocations = trials.map((trial) => {
      const derivedLocation = trial.location
        ? trial.location
        : baseSites[
            trial.id.split("").reduce((acc: number, ch: string) => acc + ch.charCodeAt(0), 0) % baseSites.length
          ];
      const normalizedTrialId = trial.id.toLowerCase();
      const assignedMemberIds = assignedMemberIdsByTrial.get(normalizedTrialId) || [];
      const assignedMembers = assignedMemberIds
        .map((id) => teamMemberById.get(String(id)))
        .filter(Boolean);
      const piFromAssignedTeam = assignedMembers.find((member) => {
        const role = String(member?.clinicalRole || member?.role || "").toLowerCase();
        return role.includes("principal investigator") || role === "pi";
      });
      const piName = String(trial.principalInvestigator || piFromAssignedTeam?.name || "Unassigned");
      const currentTeam = String(currentMember?.team || "").toLowerCase();
      const isAssignedToMe = currentMember ? assignedMemberIds.includes(String(currentMember.id)) : false;
      const isAssignedToMyTeam = currentTeam
        ? assignedMembers.some((member) => String(member?.team || "").toLowerCase() === currentTeam)
        : false;
      const enrolledPatients = Number(trial.enrolledPatients || 0);
      const targetPatients = normalizeTargetPatients(
        Number(trial.targetPatients || 0),
        (trial as { sampleSize?: string | null }).sampleSize
      );
      const enrollmentProgress =
        targetPatients > 0
          ? (enrolledPatients / targetPatients) * 100
          : Number(trial.completionPercentage || 0);
      const taskProgress = taskProgressByTrial.get(normalizedTrialId) || {
        total: 0,
        completed: 0,
        percent: 0,
      };
      const searchHaystack = [
        trial.id,
        trial.title,
        trial.investigationalProduct,
        trial.sponsor,
        trial.protocolNumber,
        trial.nctNumber,
        trial.phase,
        trial.status,
        derivedLocation,
        piName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        ...trial,
        __derivedLocation: derivedLocation,
        __teamCount: assignedMemberIds.length,
        __assignedMemberIds: assignedMemberIds,
        __isAssignedToMe: isAssignedToMe,
        __isAssignedToMyTeam: isAssignedToMyTeam,
        __isUnassigned: assignedMemberIds.length === 0,
        __piName: piName,
        __enrollmentProgress: enrollmentProgress,
        __taskTotal: taskProgress.total,
        __taskCompleted: taskProgress.completed,
        __taskCompletionPercent: taskProgress.percent,
        __searchHaystack: searchHaystack,
      };
    });

    return withLocations;
  }, [trials, state.teamMembers, teamMemberById, currentDataMode, currentMember, taskProgressByTrial]);

  const locationOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        trialsWithMeta
          .map((trial) => String(trial.__derivedLocation || "").trim())
          .filter(Boolean)
      )
    );
    return unique
      .map((site) => {
        const city = site.split(",")[0].trim();
        return {
          label: city || site,
          value: (city || site).toLowerCase(),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [trialsWithMeta]);

  const piOptions = useMemo(() => {
    const unique = Array.from(
      new Set(
        trialsWithMeta
          .map((trial) => String(trial.__piName || "").trim())
          .filter((name) => Boolean(name) && name.toLowerCase() !== "unassigned")
      )
    );
    return unique
      .map((name) => ({
        label: name,
        value: name.toLowerCase(),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [trialsWithMeta]);

  const filteredTrials = useMemo(() => {
    const searchTerm = searchFilter.trim().toLowerCase();
    const filtered = trialsWithMeta.filter((trial) => {
      if (searchTerm && !trial.__searchHaystack.includes(searchTerm)) return false;
      if (assignmentFilter === "assigned-to-me" && !trial.__isAssignedToMe) return false;
      if (assignmentFilter === "my-team" && !trial.__isAssignedToMyTeam) return false;
      if (assignmentFilter === "unassigned" && !trial.__isUnassigned) return false;
      if (statusFilter !== "all" && trial.status !== statusFilter) return false;
      if (locationFilter !== "all" && trial.__derivedLocation.toLowerCase() !== locationFilter) return false;
      if (piFilter === "unassigned" && trial.__piName !== "Unassigned") return false;
      if (piFilter !== "all" && piFilter !== "unassigned" && trial.__piName.toLowerCase() !== piFilter) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === "start-date") {
        const aTime = a.startDate ? new Date(a.startDate).getTime() : Number.NaN;
        const bTime = b.startDate ? new Date(b.startDate).getTime() : Number.NaN;
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      }
      if (sortBy === "enrollment-progress") {
        return b.__enrollmentProgress - a.__enrollmentProgress;
      }
      const aTime = a.updatedAt
        ? new Date(a.updatedAt).getTime()
        : a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0;
      const bTime = b.updatedAt
        ? new Date(b.updatedAt).getTime()
        : b.createdAt
        ? new Date(b.createdAt).getTime()
        : 0;
      return bTime - aTime;
    });
  }, [
    trialsWithMeta,
    searchFilter,
    assignmentFilter,
    statusFilter,
    locationFilter,
    piFilter,
    sortBy,
  ]);

  // Group trials by status
  const activeTrials = filteredTrials.filter((trial) =>
    ["not-started", "active", "recruiting"].includes(trial.status)
  );
  const pausedTrials = filteredTrials.filter((trial) => trial.status === "on-hold");
  const closedTrials = filteredTrials.filter(
    (trial) => !["not-started", "active", "recruiting", "on-hold"].includes(trial.status)
  );

  const activeFilterCount = [
    searchFilter.trim() ? 1 : 0,
    assignmentFilter !== "all" ? 1 : 0,
    statusFilter !== "all" ? 1 : 0,
    locationFilter !== "all" ? 1 : 0,
    piFilter !== "all" ? 1 : 0,
    sortBy !== "recently-updated" ? 1 : 0,
  ].reduce((total, current) => total + current, 0);

  const clearAllFilters = () => {
    setSearchFilter("");
    setAssignmentFilter("all");
    setStatusFilter("all");
    setLocationFilter("all");
    setPiFilter("all");
    setSortBy("recently-updated");
  };

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  const handleCreateTrial = () => {
    resetCreateTrialForm();
    setCreateTrialOpen(true);
    logEvent({
      eventType: "feature_used",
      action: "opened",
      entityType: "trial_create_panel",
      payload: { demoMode: currentDataMode },
    });
  };

  const handleSubmitTrial = async () => {
    if (!protocolTitle.trim()) {
      toast.error("Protocol title is required");
      return;
    }
    // Block re-entry synchronously: the disabled-button guard relies on the
    // async `isPending` state, which only flips after a re-render, so a fast
    // double-click would fire this twice and create two trials + two uploads.
    if (isSubmittingTrialRef.current) return;
    isSubmittingTrialRef.current = true;
    try {
    const selectedProtocolFile = protocolFile;
    const selectedProtocolBase64 = protocolBase64;
    const selectedMemberIds = [...selectedTeamMembers];

    const createdTrial = await createTrialMutation.mutateAsync({
      title: protocolTitle.trim(),
      protocolNumber: protocolNumber.trim() || undefined,
      investigationalProduct: investigationalProduct.trim() || undefined,
      indication: indication.trim() || undefined,
      nctNumber: nctNumber.trim() || undefined,
      currentVersion: currentVersion.trim() || undefined,
      amendmentVersion: amendmentVersion.trim() || undefined,
      releaseDate: releaseDate.trim() || undefined,
      phase: trialPhase ? trialPhase.trim() : undefined,
      status: "not-started",
      sponsor: sponsor.trim() || undefined,
      location: location.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      sampleSize: sampleSize.trim() || undefined,
      numberOfSites: numberOfSites.trim() || undefined,
      studyDuration: studyDuration.trim() || undefined,
      studyDesignType: studyDesignType.trim() || undefined,
      primaryObjective: primaryObjective.trim() || undefined,
      primaryEndpoint: primaryEndpoint.trim() || undefined,
      enrolledPatients: 0,
      completionPercentage: 0,
      demoMode: currentDataMode,
    });
    await utils.trials.list.invalidate({ demoMode: currentDataMode });
    logEvent({
      eventType: "trial_created",
      action: "created",
      entityType: "trial",
      payload: { demoMode: currentDataMode, title: protocolTitle.trim() },
    });
    // The BE assigns the trial UUID; route + key everything off it.
    const createdTrialId = String(createdTrial?.id ?? "");
    if (!createdTrialId) {
      toast.error("Trial created, but no id was returned. Please refresh.");
      return;
    }
    const createdTrialIdLower = createdTrialId.toLowerCase();

    if (typeof window !== "undefined") {
      const payload = JSON.stringify(selectedMemberIds);
      const storageKey = `trial-team:${currentDataMode}:${createdTrialId}`;
      window.localStorage.setItem(storageKey, payload);
      if (createdTrialIdLower !== createdTrialId) {
        const normalizedStorageKey = `trial-team:${currentDataMode}:${createdTrialIdLower}`;
        window.localStorage.setItem(normalizedStorageKey, payload);
      }
      window.dispatchEvent(
        new CustomEvent("trial-team-updated", {
          detail: { trialId: createdTrialIdLower, mode: currentDataMode },
        })
      );
    }

    setCreatedTrialForTeaser({
      id: createdTrialIdLower,
      drugName: investigationalProduct.trim(),
      sponsorName: sponsor.trim(),
    });
    setCreateStep(6);

    if (selectedProtocolFile && selectedProtocolBase64 && !protocolUploadedRef.current) {
      try {
        console.log("[create-trial] protocol upload", {
          filename: selectedProtocolFile.name,
          trialId: createdTrialId,
        });
        await uploadDocumentMutation.mutateAsync({
          trialId: createdTrialId,
          filename: selectedProtocolFile.name,
          fileData: selectedProtocolBase64,
          category: "Protocol",
          demoMode: currentDataMode,
        });
        // Mark uploaded + clear the retained file so a later create-trial action
        // can't silently re-upload the same protocol into a new trial.
        protocolUploadedRef.current = true;
        setProtocolFile(null);
        setProtocolBase64(null);
      } catch {
        toast.error("Trial created, but protocol upload failed. Please upload in Document Hub.");
      }
    }
    } finally {
      isSubmittingTrialRef.current = false;
    }
  };

  const handleGoToCreatedTrial = () => {
    if (!createdTrialForTeaser?.id) {
      setCreateTrialOpen(false);
      return;
    }
    const trialId = createdTrialForTeaser.id;
    setCreateTrialOpen(false);
    resetCreateTrialForm();
    navigate(`/trial/${trialId}`);
  };

  const handleSetUpIntegrationsLater = () => {
    if (typeof window !== "undefined" && createdTrialForTeaser?.id) {
      window.localStorage.setItem(
        `trial-integrations-deferred:${currentDataMode}:${createdTrialForTeaser.id}`,
        JSON.stringify({
          deferredAt: new Date().toISOString(),
          trialId: createdTrialForTeaser.id,
        })
      );
    }
    handleGoToCreatedTrial();
  };

  const teaserDrugName = createdTrialForTeaser?.drugName?.trim() || "Not provided";
  const teaserSponsorName = createdTrialForTeaser?.sponsorName?.trim() || "Not provided";

  const handleProtocolSelected = async (file: File | null) => {
    if (!file) {
      setProtocolFile(null);
      setProtocolBase64(null);
      setUploadState("idle");
      setIndexedAnimationInstance(0);
      return;
    }
    if (!file.type.includes("pdf")) {
      toast.error("Please upload a PDF protocol for extraction.");
      return;
    }
    setProtocolFile(file);
    setUploadState("indexing");
    setIndexedAnimationInstance(0);
    const startedAt = Date.now();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setProtocolBase64(base64);

    try {
      const result = await analyzeProtocolMutation.mutateAsync({
        fileName: file.name,
        fileBase64: base64,
        contentType: file.type,
        demoMode: currentDataMode,
      });

      const extracted = result.extracted ?? {};
      const nextAiFilled = new Set<string>();
      const assignExtracted = (key: string, value: string | null | undefined, setter: (v: string) => void) => {
        const normalized = value ?? "";
        setter(normalized);
        if (normalized.trim()) {
          nextAiFilled.add(key);
        }
      };

      assignExtracted("protocolTitle", extracted.protocolTitle, setProtocolTitle);
      assignExtracted("protocolNumber", extracted.protocolNumber, setProtocolNumber);
      assignExtracted("sponsor", extracted.sponsor, setSponsor);
      assignExtracted("phase", extracted.phase, setTrialPhase);
      assignExtracted("investigationalProduct", extracted.investigationalProduct, setInvestigationalProduct);
      assignExtracted("indication", extracted.indication, setIndication);
      assignExtracted("nctNumber", extracted.nctNumber, setNctNumber);
      assignExtracted("currentVersion", extracted.currentVersion, setCurrentVersion);
      assignExtracted("amendmentVersion", extracted.amendmentVersion, setAmendmentVersion);
      assignExtracted("releaseDate", extracted.releaseDate, setReleaseDate);
      assignExtracted("location", extracted.location, setLocation);
      assignExtracted("sampleSize", extracted.sampleSize, setSampleSize);
      assignExtracted("numberOfSites", extracted.numberOfSites, setNumberOfSites);
      assignExtracted("studyDuration", extracted.studyDuration, setStudyDuration);
      assignExtracted("studyDesignType", extracted.studyDesignType, setStudyDesignType);
      assignExtracted("primaryObjective", extracted.primaryObjective, setPrimaryObjective);
      assignExtracted("primaryEndpoint", extracted.primaryEndpoint, setPrimaryEndpoint);
      setAiFilledFields(nextAiFilled);

      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 5000 - elapsed);
      window.setTimeout(() => {
        setIndexedAnimationInstance((prev) => prev + 1);
        setUploadState("indexed");
      }, remaining);
    } catch (error: any) {
      setUploadState("idle");
      toast.error(error?.message ?? "Failed to analyze protocol");
    }
  };

  const clearAiBadge = (key: string) => {
    setAiFilledFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const renderLabelWithBadge = (label: string, fieldKey: string) => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold text-[#0E0017] min-w-0">{label}</span>
      {aiFilledFields.has(fieldKey) && (
        <span className="text-[11px] font-medium text-blue-600/50 whitespace-nowrap">
          Themison Extracted
        </span>
      )}
    </div>
  );

  const toggleTeamMember = (id: string) => {
    setSelectedTeamMembers((prev) =>
      prev.includes(id) ? prev.filter((memberId) => memberId !== id) : [...prev, id]
    );
  };

  return (
    <div className="flex-1 bg-transparent">
      <div className={`fixed inset-0 z-50 ${createTrialOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${createTrialOpen ? "opacity-100" : "opacity-0"}`}
          onClick={closeCreateTrial}
        />
        <div
          className={`absolute left-0 top-0 h-full w-full bg-white flex flex-col transform-gpu transition-[transform,opacity] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
            createTrialOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0"
          }`}
        >
          <div className="relative px-6 py-5 border-b border-gray-100">
            <div className="w-full max-w-[720px]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#0E0017]">Step {createStep} of {totalSteps}</p>
              <div className="mt-6 h-1.5 w-full rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-[#0E0017]"
                  style={{ width: `${(createStep / totalSteps) * 100}%` }}
                />
              </div>
              {createStep === 1 ? (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Upload Protocol</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Themison AI will extract trial details as soon as your protocol is uploaded.
                  </p>
                </>
              ) : createStep === 2 ? (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Protocol Details</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Review and confirm the details we extracted from your protocol.
                  </p>
                </>
              ) : createStep === 3 ? (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Study Design</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Add any study design details we were able to extract.
                  </p>
                </>
              ) : createStep === 4 ? (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Assign Team</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Suggested team members are based on your organization list.
                  </p>
                </>
              ) : createStep === 5 ? (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Review</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Confirm all details before creating the trial.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Connect Your Systems</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Your trial has been created. Integrations are optional and can be set up later.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={closeCreateTrial}
              className="absolute right-6 top-6 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className="flex-1 overflow-y-auto overflow-x-hidden px-6"
            style={
              createStep === 6
                ? {
                    backgroundColor: "#ffffff",
                    backgroundImage: "radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px)",
                    backgroundSize: "18px 18px",
                  }
                : undefined
            }
          >
            <div className="min-h-full flex items-start justify-center">
              {createStep === 1 ? (
                <div className="w-full flex flex-col items-center py-6">
                  <label className="text-sm font-semibold text-gray-700 self-start w-full mt-2">Upload Document*</label>
                  <label
                    className="mt-5 w-full rounded-2xl border border-dashed border-gray-200 bg-white p-6 text-center min-h-[620px] flex flex-col items-center justify-center cursor-pointer overflow-hidden"
                    style={{
                      backgroundImage:
                        "radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px)",
                      backgroundSize: "18px 18px",
                    }}
                  >
                    <div className="flex flex-col items-center">
                      <div className="mx-auto h-[400px] w-full max-w-[1260px] -mb-10">
                        {uploadState === "indexing" ? (
                          <DotLottieReact
                            src="https://lottie.host/babf317b-a2f8-4c40-bb70-40082d489926/Bo2qfgn2Fh.lottie"
                            loop
                            autoplay
                            layout={{ fit: "contain", align: [0.5, 0.5] }}
                            renderConfig={{ autoResize: true }}
                            className="h-full w-full"
                          />
                        ) : uploadState === "indexed" ? (
                          <DotLottieReact
                            key={`indexed-${indexedAnimationInstance}`}
                            src="https://lottie.host/83fd8277-5c96-4552-b39d-e5cca2fc8e75/LU0ipQCTro.lottie"
                            autoplay
                            loop={false}
                            layout={{ fit: "contain", align: [0.5, 0.5] }}
                            renderConfig={{ autoResize: true }}
                            className="h-full w-full"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center">
                            <Upload className="h-32 w-32 text-gray-300" />
                          </div>
                        )}
                      </div>
                      <div className="mt-8">
                        <p className="text-lg text-gray-400">
                          {uploadState === "indexing"
                            ? "We are extracting the key study details from your protocol."
                            : uploadState === "indexed"
                            ? "Extraction complete. Review the details and continue."
                            : "Drag and drop or click to upload at least the protocol"}
                        </p>
                        <p className="mt-3 text-base text-gray-300">
                          {uploadState === "indexing"
                            ? "This can take a moment while Themison analyzes the document."
                            : uploadState === "indexed"
                            ? ""
                            : "PDF, Excel, CSV, ODM XML, DOCX only. Max 20MB"}
                        </p>
                      </div>
                      {protocolFile ? (
                        <p className="mt-4 text-sm text-gray-600">Selected: {protocolFile.name}</p>
                      ) : null}
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(event) => handleProtocolSelected(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
              ) : createStep === 2 ? (
                <div className="w-full max-w-[720px] py-10 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4">
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Protocol Title:", "protocolTitle")}
                      <Textarea
                        placeholder="Protocol title"
                        rows={2}
                        value={protocolTitle}
                        onChange={(event) => {
                          clearAiBadge("protocolTitle");
                          setProtocolTitle(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4">
                    <div className="space-y-2">
                      {renderLabelWithBadge("Protocol Number:", "protocolNumber")}
                      <Input
                        placeholder="Protocol number"
                        value={protocolNumber}
                        onChange={(event) => {
                          clearAiBadge("protocolNumber");
                          setProtocolNumber(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      {renderLabelWithBadge("Sponsor:", "sponsor")}
                      <Input
                        placeholder="Sponsor"
                        value={sponsor}
                        onChange={(event) => {
                          clearAiBadge("sponsor");
                          setSponsor(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4">
                    <div className="space-y-2">
                      {renderLabelWithBadge("Phase:", "phase")}
                      <Input
                        placeholder="Phase"
                        value={trialPhase}
                        onChange={(event) => {
                          clearAiBadge("phase");
                          setTrialPhase(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Investigational Product / Drug Name:", "investigationalProduct")}
                      <Textarea
                        placeholder="Investigational product or drug name"
                        rows={2}
                        value={investigationalProduct}
                        onChange={(event) => {
                          clearAiBadge("investigationalProduct");
                          setInvestigationalProduct(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4">
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Indication / Therapeutic Area:", "indication")}
                      <Textarea
                        placeholder="Indication or therapeutic area"
                        rows={2}
                        value={indication}
                        onChange={(event) => {
                          clearAiBadge("indication");
                          setIndication(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      {renderLabelWithBadge("NCT Number:", "nctNumber")}
                      <Input
                        placeholder="NCT number"
                        value={nctNumber}
                        onChange={(event) => {
                          clearAiBadge("nctNumber");
                          setNctNumber(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4">
                    <div className="space-y-2">
                      {renderLabelWithBadge("Current Version:", "currentVersion")}
                      <Input
                        placeholder="Current version"
                        value={currentVersion}
                        onChange={(event) => {
                          clearAiBadge("currentVersion");
                          setCurrentVersion(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      {renderLabelWithBadge("Amendment Version:", "amendmentVersion")}
                      <Input
                        placeholder="Amendment version"
                        value={amendmentVersion}
                        onChange={(event) => {
                          clearAiBadge("amendmentVersion");
                          setAmendmentVersion(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-4">
                    <div className="space-y-2">
                      {renderLabelWithBadge("Release Date:", "releaseDate")}
                      <Input
                        placeholder="Release date"
                        value={releaseDate}
                        onChange={(event) => {
                          clearAiBadge("releaseDate");
                          setReleaseDate(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Location:", "location")}
                      <Input
                        placeholder="Location"
                        value={location}
                        onChange={(event) => {
                          clearAiBadge("location");
                          setLocation(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                </div>
              ) : createStep === 3 ? (
                <div className="w-full max-w-[720px] py-10 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                    <div className="space-y-2">
                      {renderLabelWithBadge("Sample Size:", "sampleSize")}
                      <Input
                        placeholder="Sample size"
                        value={sampleSize}
                        onChange={(event) => {
                          clearAiBadge("sampleSize");
                          setSampleSize(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      {renderLabelWithBadge("Number of Sites:", "numberOfSites")}
                      <Input
                        placeholder="Number of sites"
                        value={numberOfSites}
                        onChange={(event) => {
                          clearAiBadge("numberOfSites");
                          setNumberOfSites(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                    <div className="space-y-2">
                      {renderLabelWithBadge("Study Duration:", "studyDuration")}
                      <Input
                        placeholder="Study duration"
                        value={studyDuration}
                        onChange={(event) => {
                          clearAiBadge("studyDuration");
                          setStudyDuration(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Study Design Type:", "studyDesignType")}
                      <Textarea
                        placeholder="Study design type"
                        rows={2}
                        value={studyDesignType}
                        onChange={(event) => {
                          clearAiBadge("studyDesignType");
                          setStudyDesignType(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Primary Objective:", "primaryObjective")}
                      <Textarea
                        placeholder="Primary objective"
                        rows={3}
                        value={primaryObjective}
                        onChange={(event) => {
                          clearAiBadge("primaryObjective");
                          setPrimaryObjective(event.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      {renderLabelWithBadge("Primary Endpoint:", "primaryEndpoint")}
                      <Textarea
                        placeholder="Primary endpoint"
                        rows={3}
                        value={primaryEndpoint}
                        onChange={(event) => {
                          clearAiBadge("primaryEndpoint");
                          setPrimaryEndpoint(event.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#0E0017]">Start Date:</label>
                      <Input
                        type="date"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-[#0E0017]">End Date:</label>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={(event) => setEndDate(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              ) : createStep === 4 ? (
                <div className="w-full max-w-[720px] py-10 space-y-6">
                  <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
                    <div className="text-sm text-blue-700">
                      <div>Can’t find someone?</div>
                      <div>Create a new member here to update your Organization list.</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAddMemberOpen(true)}>
                      Create New Member
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {(state.teamMembers || []).length === 0 ? (
                      <p className="text-sm text-gray-500">
                        No team members found. Add members in the Organization page.
                      </p>
                    ) : (
                      (state.teamMembers || []).map((member, index) => {
                        const isSuggested = index < 3;
                        const isSelected = selectedTeamMembers.includes(member.id);
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => toggleTeamMember(member.id)}
                            className={`w-full flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                              isSelected ? "border-blue-200 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-5 w-5 rounded border border-gray-300 flex items-center justify-center">
                                {isSelected && <Check className="h-3.5 w-3.5 text-blue-600" />}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">{member.name}</div>
                                <div className="text-xs text-gray-500">{member.clinicalRole || member.role}</div>
                              </div>
                            </div>
                            {isSuggested && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                                Suggested
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : createStep === 5 ? (
                <div className="w-full max-w-[1120px] py-6 space-y-5">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
                    <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-900">Protocol Summary</h3>
                      <Button variant="outline" size="sm" onClick={() => setCreateStep(2)}>
                        Edit
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                      <div><span className="font-medium">Protocol Title:</span> {protocolTitle || "—"}</div>
                      <div><span className="font-medium">Protocol Number:</span> {protocolNumber || "—"}</div>
                      <div><span className="font-medium">Sponsor:</span> {sponsor || "—"}</div>
                      <div><span className="font-medium">Phase:</span> {trialPhase || "—"}</div>
                      <div><span className="font-medium">Investigational Product:</span> {investigationalProduct || "—"}</div>
                      <div><span className="font-medium">Indication:</span> {indication || "—"}</div>
                      <div><span className="font-medium">NCT Number:</span> {nctNumber || "—"}</div>
                      <div><span className="font-medium">Current Version:</span> {currentVersion || "—"}</div>
                      <div><span className="font-medium">Amendment Version:</span> {amendmentVersion || "—"}</div>
                      <div><span className="font-medium">Release Date:</span> {releaseDate || "—"}</div>
                      <div><span className="font-medium">Location:</span> {location || "—"}</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-900">Study Design</h3>
                      <Button variant="outline" size="sm" onClick={() => setCreateStep(3)}>
                        Edit
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                      <div><span className="font-medium">Sample Size:</span> {sampleSize || "—"}</div>
                      <div><span className="font-medium">Number of Sites:</span> {numberOfSites || "—"}</div>
                      <div><span className="font-medium">Study Duration:</span> {studyDuration || "—"}</div>
                      <div><span className="font-medium">Study Design Type:</span> {studyDesignType || "—"}</div>
                      <div><span className="font-medium">Primary Objective:</span> {primaryObjective || "—"}</div>
                      <div><span className="font-medium">Primary Endpoint:</span> {primaryEndpoint || "—"}</div>
                      <div><span className="font-medium">Start Date:</span> {startDate || "—"}</div>
                      <div><span className="font-medium">End Date:</span> {endDate || "—"}</div>
                    </div>
                  </div>
                  </div>
                  <div className="bg-white rounded-lg border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-900">Assigned Team</h3>
                      <Button variant="outline" size="sm" onClick={() => setCreateStep(4)}>
                        Edit
                      </Button>
                    </div>
                    {selectedTeamMembers.length === 0 ? (
                      <p className="text-sm text-gray-500">No team members selected.</p>
                    ) : (
                      <ul className="text-sm text-gray-700 space-y-1">
                        {selectedTeamMembers.map((memberId) => {
                          const member = (state.teamMembers || []).find((m) => m.id === memberId);
                          return (
                            <li key={memberId}>
                              {member?.name || "Unknown"}{" "}
                              <span className="text-gray-500">({member?.clinicalRole || member?.role || "Team"})</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="w-full max-w-[980px] py-10 space-y-8">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/85 p-6">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
                      <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <Check className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="space-y-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-600">
                              Investigational Product / Drug Name:
                            </p>
                            <p className="text-3xl leading-tight font-semibold text-gray-900 break-words">
                              {teaserDrugName}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide font-semibold text-gray-600">
                              Sponsor:
                            </p>
                            <p className="text-2xl leading-tight font-medium text-gray-900 break-words">
                              {teaserSponsorName}
                            </p>
                          </div>
                        </div>
                        <p className="mt-4 text-base font-medium text-gray-600">Your trial is ready to go.</p>
                        <p className="mt-1 text-sm text-gray-600">
                          Your trial has been created. You can start working immediately.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-lg font-semibold text-gray-900">Take it further</h4>
                    <p className="text-sm text-gray-600">
                      Connect your existing systems to keep everything in sync.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      {
                        key: "calendar-outlook",
                        title: "Calendar / Outlook",
                        description: "Sync visits, deadlines, and team reminders",
                        icon: Calendar,
                      },
                      {
                        key: "sharepoint",
                        title: "SharePoint",
                        description: "Keep trial documents and team workspaces aligned",
                        icon: Cloud,
                      },
                      {
                        key: "ctms",
                        title: "CTMS",
                        description: "Auto-import site & enrollment data",
                        icon: Database,
                      },
                      {
                        key: "edc",
                        title: "EDC",
                        description: "Link visits to data capture forms",
                        icon: ClipboardList,
                      },
                      {
                        key: "etmf",
                        title: "eTMF",
                        description: "Track document workflows automatically",
                        icon: FolderOpen,
                      },
                    ].map((integration) => {
                      const Icon = integration.icon;
                      return (
                        <div
                          key={integration.key}
                          className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-4"
                        >
                          <div className="flex items-center justify-between">
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gray-100 text-gray-600">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-500">
                              Coming soon
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-gray-900">{integration.title}</p>
                          <p className="mt-1 text-xs text-gray-600">{integration.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between">
            {createStep > 1 && createStep < 6 ? (
              <Button
                variant="outline"
                onClick={() => setCreateStep((step) => Math.max(step - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            ) : (
              <div />
            )}
            {createStep < 6 ? (
              <Button
                onClick={() => {
                  if (createStep >= 5) {
                    void handleSubmitTrial();
                    return;
                  }
                  setCreateStep((step) => Math.min(step + 1, totalSteps));
                }}
                disabled={
                  createStep === 1 ? uploadState !== "indexed" : createTrialMutation.isPending || uploadDocumentMutation.isPending
                }
              >
                {createStep >= 5 ? "Create Trial" : "Next"}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <div className="ml-auto flex items-center gap-4">
                <button
                  type="button"
                  className="text-sm text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
                  onClick={handleSetUpIntegrationsLater}
                >
                  Set up integrations later
                </button>
                <Button
                  className="bg-[#2F6FED] hover:bg-[#255BD1] text-white"
                  onClick={handleGoToCreatedTrial}
                >
                  Go to Trial
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
          </div>
        </div>
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
            setSelectedTeamMembers((prev) => (prev.includes(memberId) ? prev : [...prev, memberId]));
          }}
        />
      <div className="px-8 pb-8">
        <div className="sticky top-0 z-30 bg-[#F9FAFB] pt-4 pb-2 mb-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">Trial Workspace</h1>
            </div>
            <Button onClick={handleCreateTrial} variant="outline" size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Create New Trial
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={assignmentFilter}
              onChange={(event) => setAssignmentFilter(event.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[180px]"
            >
              <option value="all">All Assignments</option>
              <option value="assigned-to-me">Assigned to me</option>
              <option value="my-team">My team</option>
              <option value="unassigned">Unassigned</option>
            </select>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[165px]"
            >
              <option value="all">All Statuses</option>
              <option value="not-started">Not started</option>
              <option value="active">Active</option>
              <option value="recruiting">Recruiting</option>
              <option value="on-hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="terminated">Terminated</option>
            </select>

            <select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[170px]"
            >
              <option value="all">All Locations</option>
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={piFilter}
              onChange={(event) => setPiFilter(event.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[170px]"
            >
              <option value="all">All PI</option>
              <option value="unassigned">Unassigned PI</option>
              {piOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="h-8 rounded-md border border-gray-200 bg-white px-3 text-xs min-w-[165px]"
            >
              <option value="recently-updated">Recently updated</option>
              <option value="start-date">Start date</option>
              <option value="enrollment-progress">Enrollment progress</option>
            </select>

            <div className="ml-auto relative h-8">
              <button
                type="button"
                className="h-8 w-8 inline-flex items-center justify-center text-gray-500 hover:text-gray-700 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
                onClick={() => setSearchOpen((open) => !open)}
                aria-label="Search trials"
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
                    value={searchFilter}
                    onChange={(event) => setSearchFilter(event.target.value)}
                    placeholder="Search trials"
                    className="h-8 rounded-md border border-gray-200 bg-white text-xs pl-9 pr-8 outline-none focus:outline-none focus:border-gray-200 focus-visible:border-gray-200 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    onClick={() => {
                      setSearchFilter("");
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
        </div>

        {/* Trial Cards Grid */}
        <div className="space-y-8">
          {/* Active trials section */}
          {activeTrials.length > 0 && (
            <div>
              <button
                onClick={() => setShowActiveTrials(!showActiveTrials)}
                className="flex items-center gap-2 mb-4 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showActiveTrials ? "" : "-rotate-90"
                  }`}
                />
                Active ({activeTrials.length})
              </button>

              {showActiveTrials && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {activeTrials.map((trial) => (
                    <TrialCard
                      key={trial.id}
                      trial={{
                        ...trial,
                        teamCount: (trial as any).__teamCount,
                        taskCompleted: (trial as any).__taskCompleted,
                        taskTotal: (trial as any).__taskTotal,
                        taskCompletionPercentage: (trial as any).__taskCompletionPercent,
                      } as any}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Paused section */}
          {pausedTrials.length > 0 && (
            <div>
              <button
                onClick={() => setShowPaused(!showPaused)}
                className="flex items-center gap-2 mb-4 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showPaused ? "" : "-rotate-90"
                  }`}
                />
                Paused ({pausedTrials.length})
              </button>

              {showPaused && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pausedTrials.map((trial) => (
                    <TrialCard
                      key={trial.id}
                      trial={{
                        ...trial,
                        teamCount: (trial as any).__teamCount,
                        taskCompleted: (trial as any).__taskCompleted,
                        taskTotal: (trial as any).__taskTotal,
                        taskCompletionPercentage: (trial as any).__taskCompletionPercent,
                      } as any}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Closed section */}
          {closedTrials.length > 0 && (
            <div>
              <button
                onClick={() => setShowClosed(!showClosed)}
                className="flex items-center gap-2 mb-4 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showClosed ? "" : "-rotate-90"
                  }`}
                />
                Closed
              </button>

              {showClosed && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {closedTrials.map((trial) => (
                    <TrialCard
                      key={trial.id}
                      trial={{
                        ...trial,
                        teamCount: (trial as any).__teamCount,
                        taskCompleted: (trial as any).__taskCompleted,
                        taskTotal: (trial as any).__taskTotal,
                        taskCompletionPercentage: (trial as any).__taskCompletionPercent,
                      } as any}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {filteredTrials.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                <Plus className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                {activeFilterCount > 0 ? "No trials match these filters" : "No trials yet"}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                {activeFilterCount > 0
                  ? "Try adjusting your filters or clear all filters."
                  : "Get started by creating your first trial."}
              </p>
              <div className="flex items-center justify-center gap-2">
                {activeFilterCount > 0 && (
                  <Button variant="outline" onClick={clearAllFilters}>
                    Clear all filters
                  </Button>
                )}
                <Button onClick={handleCreateTrial} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Create New Trial
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
