/**
 * TrialWorkspace Page Component
 * Design: Clinical Modernism - Card-based trial overview with filters and status grouping
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ChevronDown, X } from "lucide-react";
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
  const [panelWidth, setPanelWidth] = useState(720);
  const isResizingRef = useRef(false);
  const { getCurrentDataMode, state } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const utils = trpc.useUtils();

  const [trialName, setTrialName] = useState("");
  const [protocolNumber, setProtocolNumber] = useState("");
  const [trialStatus, setTrialStatus] = useState<string>("");
  const [trialPhase, setTrialPhase] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  // Fetch trials from database
  const { data: trials = [], isLoading } = trpc.trials.list.useQuery({ demoMode: currentDataMode });
  const createTrialMutation = trpc.trials.create.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      logEvent({
        eventType: "trial_created",
        action: "created",
        entityType: "trial",
        payload: { demoMode: currentDataMode, title: trialName.trim() },
      });
      toast.success("Trial created");
      setCreateTrialOpen(false);
      setTrialName("");
      setProtocolNumber("");
      setTrialStatus("");
      setTrialPhase("");
      setStartDate("");
      setEndDate("");
      setSponsor("");
      setLocation("");
      setDescription("");
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
    return unique.map((site) => ({
      label: site,
      value: site.toLowerCase(),
    }));
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
      return { ...trial, __derivedLocation: derivedLocation };
    });

    if (locationFilter === "all") return withLocations;
    return withLocations.filter((trial) =>
      trial.__derivedLocation.toLowerCase().includes(locationFilter)
    );
  }, [trials, state.teamMembers, locationFilter]);

  // Group trials by status
  const assignedTrials = visibleTrials.filter(t => 
    ["active", "recruiting"].includes(t.status)
  );
  const pausedTrials = visibleTrials.filter(t => t.status === "on-hold");

  const handleCreateTrial = () => {
    setPanelWidth(720);
    setCreateTrialOpen(true);
    logEvent({
      eventType: "feature_used",
      action: "opened",
      entityType: "trial_create_panel",
      payload: { demoMode: currentDataMode },
    });
  };

  const handleSubmitTrial = async () => {
    if (!trialName.trim()) {
      toast.error("Trial name is required");
      return;
    }
    const slug = trialName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
    const randomSuffix = Math.random().toString(36).slice(2, 6);
    const trialId = `${slug || "trial"}-${randomSuffix}`;

    await createTrialMutation.mutateAsync({
      id: trialId,
      title: trialName.trim(),
      protocolNumber: protocolNumber.trim() || undefined,
      phase: trialPhase ? (trialPhase as any) : undefined,
      status: trialStatus ? (trialStatus as any) : "active",
      sponsor: sponsor.trim() || undefined,
      location: location.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      description: description.trim() || undefined,
      enrolledPatients: 0,
      completionPercentage: 0,
      demoMode: currentDataMode,
    });
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      const nextWidth = window.innerWidth - event.clientX;
      const maxWidth = window.innerWidth * 0.75;
      const clamped = Math.min(Math.max(nextWidth, 720), maxWidth);
      setPanelWidth(clamped);
    };

    const handleUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  return (
    <div className="flex-1 bg-background">
      <div className={`fixed inset-0 z-50 ${createTrialOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
        <div
          className={`absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-500 ${createTrialOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setCreateTrialOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 h-full bg-white border-l border-gray-200 flex flex-col transform-gpu transition-[transform,opacity] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
            createTrialOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
          }`}
          style={{ width: `${panelWidth}px`, maxWidth: "75vw" }}
        >
          <div
            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
            onMouseDown={(event) => {
              event.preventDefault();
              isResizingRef.current = true;
            }}
          />
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Create New Trial</h2>
                <p className="text-xs text-gray-500">Add core trial details. You can complete the rest later.</p>
              </div>
              <button
                type="button"
                onClick={() => setCreateTrialOpen(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
              <div className="grid grid-cols-1 gap-5">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Trial Name</label>
                  <Input
                    className="mt-2"
                    placeholder="e.g., Colitis Research Trial"
                    value={trialName}
                    onChange={(e) => setTrialName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Protocol Number</label>
                  <Input
                    className="mt-2"
                    placeholder="e.g., DIAB-2024-001"
                    value={protocolNumber}
                    onChange={(e) => setProtocolNumber(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</label>
                    <Select value={trialStatus} onValueChange={setTrialStatus}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="recruiting">Recruiting</SelectItem>
                        <SelectItem value="on-hold">On hold</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Phase</label>
                    <Select value={trialPhase} onValueChange={setTrialPhase}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder="Select phase" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Phase I">Phase I</SelectItem>
                        <SelectItem value="Phase II">Phase II</SelectItem>
                        <SelectItem value="Phase III">Phase III</SelectItem>
                        <SelectItem value="Phase IV">Phase IV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Start Date</label>
                    <Input
                      className="mt-2"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">End Date</label>
                    <Input
                      className="mt-2"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sponsor</label>
                  <Input
                    className="mt-2"
                    placeholder="e.g., Novo Nordisk"
                    value={sponsor}
                    onChange={(e) => setSponsor(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</label>
                  <Input
                    className="mt-2"
                    placeholder="e.g., Copenhagen, Denmark"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</label>
                  <Textarea
                    className="mt-2 min-h-[120px]"
                    placeholder="Brief trial summary"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 px-6 py-4 flex items-center gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCreateTrialOpen(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleSubmitTrial} disabled={createTrialMutation.isPending}>
                {createTrialMutation.isPending ? "Creating..." : "Create Trial"}
              </Button>
            </div>
          </div>
        </div>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Trial Workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                KS
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
          {/* Assigned to me section */}
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
                Assigned to me
              </button>

              {showAssignedToMe && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {assignedTrials.map((trial) => (
                    <TrialCard key={trial.id} trial={trial} />
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
                    <TrialCard key={trial.id} trial={trial} />
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
