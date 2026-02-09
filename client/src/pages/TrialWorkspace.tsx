/**
 * TrialWorkspace Page Component
 * Design: Clinical Modernism - Card-based trial overview with filters and status grouping
 */

import { useMemo, useState } from "react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AddMemberPanel } from "@/components/AddMemberPanel";
import { Plus, ChevronDown, X, User, Upload, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { TrialCard } from "@/components/TrialCard";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";

export function TrialWorkspace() {
  const [locationFilter, setLocationFilter] = useState("all");
  const [showAssignedToMe, setShowAssignedToMe] = useState(true);
  const [showPaused, setShowPaused] = useState(true);
  const [createTrialOpen, setCreateTrialOpen] = useState(false);
  const [createStep, setCreateStep] = useState(1);
  const totalSteps = 5;
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [protocolBase64, setProtocolBase64] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "indexing" | "indexed">("idle");
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
  const analyzeProtocolMutation = trpc.studySetupWizard.analyzeProtocol.useMutation();
  const uploadDocumentMutation = trpc.documents.upload.useMutation();

  // Fetch trials from database
  const { data: trials = [], isLoading } = trpc.trials.list.useQuery({ demoMode: currentDataMode });
  const createTrialMutation = trpc.trials.create.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      logEvent({
        eventType: "trial_created",
        action: "created",
        entityType: "trial",
        payload: { demoMode: currentDataMode, title: protocolTitle.trim() },
      });
      toast.success("Trial created");
      setCreateTrialOpen(false);
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
    },
    onError: (error) => {
      toast.error(`Failed to create trial: ${error.message}`);
    },
  });

  const locationOptions = useMemo(() => {
    if (!trials.length) return [];
    const trialLocations = trials
      .map((trial) => trial.location)
      .filter((site): site is string => Boolean(site));
    const memberSites = (state.teamMembers || [])
      .map((member) => member.site)
      .filter((site): site is string => Boolean(site));
    const fallbackSites = ["Copenhagen", "Brussels", "Amsterdam", "London", "Berlin", "Paris", "Lisbon"];
    const baseSites = trialLocations.length
      ? trialLocations
      : memberSites.length
      ? memberSites
      : fallbackSites;

    const unique = Array.from(new Set(baseSites));
    return unique.map((site) => {
      const city = site.split(",")[0].trim();
      return {
        label: city || site,
        value: (city || site).toLowerCase(),
      };
    });
  }, [trials, state.teamMembers]);

  const visibleTrials = useMemo(() => {
    const memberSites = (state.teamMembers || [])
      .map((member) => member.site)
      .filter((site): site is string => Boolean(site));
    const fallbackSites = ["Copenhagen", "Brussels", "Amsterdam", "London", "Berlin", "Paris", "Lisbon"];
    const baseSites = memberSites.length ? memberSites : fallbackSites;

    const withLocations = trials.map((trial) => {
      const derivedLocation = trial.location
        ? trial.location
        : baseSites[
            trial.id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % baseSites.length
          ];
      let teamCount = 0;
      if (typeof window !== "undefined") {
        try {
          const storageKey = `trial-team:${currentDataMode}:${trial.id}`;
          const stored = window.localStorage.getItem(storageKey);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
              teamCount = parsed.length;
            }
          }
        } catch {}
      }
      return { ...trial, __derivedLocation: derivedLocation, __teamCount: teamCount };
    });

    if (locationFilter === "all") return withLocations;
    return withLocations.filter((trial) =>
      trial.__derivedLocation.toLowerCase().includes(locationFilter)
    );
  }, [trials, state.teamMembers, locationFilter]);

  // Group trials by status
  const assignedTrials = visibleTrials.filter(t => 
    ["not-started", "active", "recruiting"].includes(t.status)
  );
  const pausedTrials = visibleTrials.filter(t => t.status === "on-hold");

  const handleCreateTrial = () => {
    setCreateTrialOpen(true);
    setCreateStep(1);
    setProtocolFile(null);
    setProtocolBase64(null);
    setUploadState("idle");
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
    const selectedProtocolFile = protocolFile;
    const selectedProtocolBase64 = protocolBase64;
    const selectedMemberIds = [...selectedTeamMembers];
    const slugBase = protocolTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
    const trimmedSlug = slugBase.slice(0, 18).replace(/-+$/g, "");
    const randomSuffix = Math.random().toString(36).slice(2, 7);
    const trialId = `${trimmedSlug || "trial"}-${randomSuffix}`;

    const createdTrial = await createTrialMutation.mutateAsync({
      id: trialId,
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
    const createdTrialIdRaw = createdTrial?.id || trialId;
    const createdTrialId = createdTrialIdRaw.includes(":")
      ? createdTrialIdRaw.split(":").slice(1).join(":")
      : createdTrialIdRaw;

    if (selectedProtocolFile && selectedProtocolBase64) {
      try {
        await uploadDocumentMutation.mutateAsync({
          trialId: createdTrialId,
          filename: selectedProtocolFile.name,
          fileData: selectedProtocolBase64,
          category: "Protocol",
          demoMode: currentDataMode,
        });
      } catch (error) {
        toast.error("Trial created, but protocol upload failed. Please upload in Document Hub.");
      }
    }

    if (typeof window !== "undefined") {
      const storageKey = `trial-team:${currentDataMode}:${createdTrialId}`;
      window.localStorage.setItem(storageKey, JSON.stringify(selectedMemberIds));
    }
  };

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
          onClick={() => setCreateTrialOpen(false)}
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
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-gray-900 mt-8">Review</h2>
                  <p className="text-sm text-gray-500 mt-2">
                    Confirm all details before creating the trial.
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCreateTrialOpen(false)}
              className="absolute right-6 top-6 text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6">
            <div className="min-h-full flex items-start justify-center">
              {createStep === 1 ? (
                <div className="w-full flex flex-col items-center py-6">
                  <label className="text-sm font-semibold text-gray-700 self-start w-full mt-2">Upload Document*</label>
                  <label className="mt-5 w-full rounded-2xl border border-dashed border-gray-200 bg-white/60 p-6 text-center min-h-[620px] flex flex-col items-center justify-center cursor-pointer overflow-hidden">
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
              ) : (
                <div className="w-full max-w-[720px] py-10 space-y-6">
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
              )}
            </div>
          </div>

          <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between">
            {createStep > 1 ? (
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
            <Button
              onClick={() => {
                if (createStep >= totalSteps) {
                  handleSubmitTrial();
                  return;
                }
                setCreateStep((step) => Math.min(step + 1, totalSteps));
              }}
              disabled={createStep === 1 ? uploadState !== "indexed" : false}
            >
              {createStep >= totalSteps ? "Create Trial" : "Next"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
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
            clinicalRole: "Principal Investigator",
            appRole: "Admin",
            team: "",
            site: "",
          }}
          onMemberSaved={(memberId) => {
            setSelectedTeamMembers((prev) => (prev.includes(memberId) ? prev : [...prev, memberId]));
          }}
        />
      <div className="px-8 pb-8 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Trial Workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2">
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <User className="w-3.5 h-3.5" />
              </div>
              Assigned to me
              <ChevronDown className="w-4 h-4" />
            </Button>
            <Button onClick={handleCreateTrial} variant="outline" size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Create New Trial
            </Button>
          </div>
        </div>

        {/* Filters */}
        {locationOptions.length > 0 && (
          <div className="flex items-center gap-4 mb-6">
            <div className="inline-flex items-center bg-gray-200 rounded-lg p-0.5" style={{backgroundColor: '#f0f0f0'}}>
              <button
                onClick={() => setLocationFilter("all")}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  locationFilter === "all"
                    ? "bg-white text-foreground shadow-sm"
                    : "text-gray-600 hover:text-foreground"
                }`}
              >
                All Locations
              </button>
              {locationOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setLocationFilter(option.value)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    locationFilter === option.value
                      ? "bg-white text-foreground shadow-sm"
                      : "text-gray-600 hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Trial Cards Grid */}
        <div className="space-y-8">
          {/* Active trials section */}
          {assignedTrials.length > 0 && (
            <div>
              <button
                onClick={() => setShowAssignedToMe(!showAssignedToMe)}
                className="flex items-center gap-2 mb-4 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showAssignedToMe ? "" : "-rotate-90"
                  }`}
                />
                Active
              </button>

              {showAssignedToMe && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {assignedTrials.map((trial) => (
                    <TrialCard
                      key={trial.id}
                      trial={{ ...trial, teamCount: (trial as any).__teamCount }}
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
                Paused
              </button>

              {showPaused && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pausedTrials.map((trial) => (
                    <TrialCard
                      key={trial.id}
                      trial={{ ...trial, teamCount: (trial as any).__teamCount }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {visibleTrials.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                <Plus className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">No trials yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Get started by creating your first trial
              </p>
              <Button onClick={handleCreateTrial} className="gap-2">
                <Plus className="w-4 h-4" />
                Create New Trial
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
