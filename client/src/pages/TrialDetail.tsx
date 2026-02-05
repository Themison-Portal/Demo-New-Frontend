/**
 * TrialDetail Component
 * Design: Clinical Modernism - Clean trial detail view with tabbed navigation
 * Note: This page renders without the standard DashboardLayout (no sidebar)
 */

import { useEffect, useState } from "react";
import { ArrowLeft, LayoutGrid, Calendar, FileText, Users as UsersIcon, UserCheck, Sparkles, Eye, UserPlus, Upload, UserPlus2, Activity, ClipboardList, ChevronDown, User, FolderOpen, Wand2, Bookmark, Bell, Search, Filter, Link2, Plus, Pencil, Share2, ExternalLink, ArrowRight } from "lucide-react";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { TopNav } from "@/components/TopNav";
import { StudySetupWizardEntry } from "@/components/StudySetupWizardEntry";
import Documents from "@/pages/Documents";
import { TaskScaffoldView } from "@/components/TaskScaffoldView";
import { trpc } from "@/lib/trpc";
import { EditableField } from "@/components/EditableField";

export default function TrialDetail() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/trial/:id");
  const [activeTab, setActiveTab] = useState("overview");
  const [isGeneratingScaffold, setIsGeneratingScaffold] = useState(false);
  const [scaffoldGenerated, setScaffoldGenerated] = useState(false);

  // Get trial ID as string and normalize to lowercase for consistency
  const trialId = (params?.id || '').toLowerCase();
  const isValidTrialId = trialId.length > 0;

  // Fetch protocols for this trial (only if valid ID)
  const { data: protocols } = trpc.documents.list.useQuery(
    { trialId },
    { enabled: isValidTrialId }
  );

  // Check if a scaffold already exists for this trial
  const protocolId = protocols?.[0]?.id;
  const { data: existingScaffold } = trpc.studySetupWizard.getScaffold.useQuery(
    { protocolId: protocolId || 0 }, // Use 0 as fallback to satisfy type requirement
    { enabled: !!protocolId && protocolId > 0 } // Only run query if protocolId is valid
  );

  // Redirect if invalid trial ID
  useEffect(() => {
    if (!isValidTrialId) {
      toast.error("Invalid trial ID");
      navigate("/trial-workspace");
    }
  }, [isValidTrialId, navigate]);

  // Prevent body scroll on this page
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Fetch trial data from database
  const { data: trial, isLoading: isLoadingTrial } = trpc.trials.getById.useQuery(
    { id: trialId },
    { enabled: isValidTrialId }
  );

  // Trial update mutation
  const utils = trpc.useUtils();
  const updateTrial = trpc.trials.update.useMutation({
    onSuccess: () => {
      utils.trials.getById.invalidate({ id: trialId });
      utils.trials.list.invalidate(); // Invalidate list to update sidebar navigation
      toast.success("Trial updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update trial: ${error.message}`);
    },
  });

  const teamMembers = [
    { name: "Principal Investigator", role: "PI", initials: "PI" },
    { name: "Coordinator CRC", role: "CRC", initials: "CC" },
    { name: "Nurse CH", role: "Nurse", initials: "NC" },
  ];

  const tabs = [
    { id: "overview", label: "Overview", icon: LayoutGrid },
    { id: "document-hub", label: "Document Hub", icon: FolderOpen },
    { id: "study-setup-wizard", label: "Study Setup Wizard", icon: Wand2 },
    { id: "visit-template", label: "Visit Template", icon: Calendar },
    { id: "bookmarks", label: "Bookmarks", icon: Bookmark },
    { id: "team", label: "Team", icon: UsersIcon },
    { id: "patients", label: "Patients", icon: UserCheck },
    { id: "notifications", label: "Notifications", icon: Bell },
  ];

  const mockBookmarks = [
    {
      id: "edc",
      type: "EDC",
      name: "Medidata Rave",
      url: "https://rave.medidata.com",
      notes: "Primary data capture system for this trial.",
      owner: "Kaleb Sanders",
      updatedAt: "Updated 2d ago",
    },
    {
      id: "ctms",
      type: "CTMS",
      name: "SiteVault CTMS",
      url: "https://sitevault.com",
      notes: "Subject tracking + visit milestones.",
      owner: "Coordinator CRC",
      updatedAt: "Updated 5d ago",
    },
    {
      id: "etmf",
      type: "eTMF",
      name: "Veeva Vault",
      url: "https://veeva.com/vault",
      notes: "Essential documents + regulatory binder.",
      owner: "Nurse CH",
      updatedAt: "Updated 1w ago",
    },
    {
      id: "irt",
      type: "IWRS / IRT",
      name: "4G Clinical",
      url: "https://4gclinical.com",
      notes: "Randomization + drug supply.",
      owner: "PI",
      updatedAt: "Updated 2w ago",
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

  const generateScaffold = trpc.studySetupWizard.generateScaffold.useMutation({
    onSuccess: () => {
      setIsGeneratingScaffold(false);
      setScaffoldGenerated(true);
    },
    onError: (error) => {
      setIsGeneratingScaffold(false);
      console.error("Failed to generate scaffold:", error);
      toast.error("Failed to generate execution plan", {
        description: "Please ensure a protocol has been uploaded and try again.",
      });
    },
  });

  const handleGenerateScaffold = () => {
    if (!protocols || protocols.length === 0) {
      toast.error("No protocol found", {
        description: "Please upload a protocol in the Document Hub first.",
      });
      return;
    }

    setIsGeneratingScaffold(true);
    // Use the first protocol
    if (trial) {
      generateScaffold.mutate({ protocolId: protocols[0].id, trialId: trial.id });
    }
  };

  let mainContent: React.ReactNode = null;
  if (activeTab === "document-hub") {
    mainContent = (
      <div className="px-8">
        <Documents trialId={trialId} />
      </div>
    );
  } else if (activeTab === "study-setup-wizard") {
    mainContent = existingScaffold ? (
      <div className="px-8 h-full">
        <TaskScaffoldView
          phases={existingScaffold.phases || []}
          sections={existingScaffold.sections || []}
          onConfirm={() => console.log("Confirm")}
          onAddTask={() => console.log("Add task")}
          onEditTask={(id) => console.log("Edit task", id)}
          onDeleteTask={(id) => console.log("Delete task", id)}
        />
      </div>
    ) : (
      <div className="px-8">
        <StudySetupWizardEntry
          trialId={trialId}
          onGenerate={handleGenerateScaffold}
          isGenerating={isGeneratingScaffold}
        />
      </div>
    );
  } else if (activeTab === "bookmarks") {
    mainContent = (
      <div className="px-8 h-full">
        <div className="bg-white rounded-xl border border-gray-200 p-6 h-full flex flex-col">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">Trial Systems</h2>
              <p className="text-sm text-gray-500 max-w-2xl">
                Quick access to all external tools used for this trial.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button className="text-sm" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Link
              </Button>
              <Button variant="outline" className="text-sm" size="sm">
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button variant="outline" className="text-sm" size="sm">
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-500 border-b border-gray-200 pb-3">
            {["All", "EDC", "CTMS", "eTMF / eISF", "Sponsor Portal", "Files / Drive", "Safety", "Other"].map((tab) => (
              <button
                key={tab}
                className={`pb-1 ${
                  tab === "All"
                    ? "text-blue-600 border-b-2 border-blue-600"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search systems..."
                className="pl-9 h-10 bg-white border-gray-200"
              />
            </div>
            <Button variant="outline" size="sm" className="text-sm">
              All categories
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="outline" size="sm" className="text-sm">
              Most used
              <ChevronDown className="h-4 w-4 ml-2" />
            </Button>
            <Button variant="outline" size="sm" className="text-sm">
              <Filter className="h-4 w-4 mr-2" />
              Filter
            </Button>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 overflow-y-auto pr-1">
            {mockBookmarks.map((bookmark) => (
              <div
                key={bookmark.id}
                className="rounded-lg border border-gray-200 bg-white overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all"
              >
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-md border border-gray-200 bg-white shadow-sm flex items-center justify-center overflow-hidden">
                      <img
                        src={getFaviconUrl(bookmark.url)}
                        alt={`${bookmark.name} logo`}
                        className="h-6 w-6"
                        loading="lazy"
                      />
                    </div>
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {bookmark.type}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-gray-900">{bookmark.name}</div>
                    <p className="text-sm text-gray-500">{bookmark.notes}</p>
                  </div>
                </div>
                <button className="group w-full flex items-center justify-between px-5 py-3 bg-gray-50 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors">
                  <span>{bookmark.name}</span>
                  <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-blue-600" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  } else {
    mainContent = (
      <div className="flex gap-4">
        {/* Left Column - Main Content */}
        <div className="flex-1 space-y-4">
          {/* Trial Information Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <EditableField
              value={trial?.title || "Untitled Trial"}
              onSave={async (newValue) => {
                await updateTrial.mutateAsync({ id: trialId, title: newValue });
              }}
              className="text-xl font-semibold text-gray-900 mb-2"
            />
            <div className="flex items-center gap-1 text-sm text-gray-500 mb-6">
              <span>Protocol number:</span>
              <EditableField
                value={trial?.protocolNumber || "N/A"}
                onSave={async (newValue) => {
                  await updateTrial.mutateAsync({ id: trialId, protocolNumber: newValue });
                }}
                displayClassName="text-sm text-gray-500"
              />
            </div>
            <div className="space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Description
                </h3>
                <EditableField
                  value={trial?.description || "No description available"}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, description: newValue });
                  }}
                  type="textarea"
                  className="text-sm text-gray-700 leading-relaxed"
                />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Principal Investigator
                </h3>
                <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs" style={{ backgroundColor: '#e6e7eb' }}>
                      <User className="h-3.5 w-3.5 text-gray-600" />
                    </AvatarFallback>
                  </Avatar>
                  <span>Principal Investigator</span>
                </button>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Quick Actions
            </h2>
            <div className="flex flex-wrap gap-3">
              <Button 
                variant="outline" 
                className="flex items-center gap-2 text-sm"
                onClick={() => navigate(`/trial/${trialId}/assistant`)}
              >
                <Sparkles className="h-4 w-4" />
                AI Assistant
              </Button>
              <Button variant="outline" className="flex items-center gap-2 text-sm">
                <Eye className="h-4 w-4" />
                View Protocol
              </Button>
              <Button variant="outline" className="flex items-center gap-2 text-sm">
                <UsersIcon className="h-4 w-4" />
                Manage Team
              </Button>
              <Button variant="outline" className="flex items-center gap-2 text-sm">
                <Upload className="h-4 w-4" />
                Upload Document
              </Button>
              <Button variant="outline" className="flex items-center gap-2 text-sm">
                <UserPlus2 className="h-4 w-4" />
                Sign a New Patient
              </Button>
            </div>
          </div>

          {/* Team Members */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">
              Team Members ({teamMembers.length})
            </h2>
            <div className="space-y-1.5">
              {teamMembers.map((member, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="text-sm" style={{ backgroundColor: '#e6e7eb' }}>
                      <User className="h-5 w-5 text-gray-600" />
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{member.name}</p>
                    <p className="text-xs text-gray-400">{member.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column - Properties Sidebar */}
        <div className="w-80">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-6">
              Properties
            </h2>
            <div className="space-y-5">
              {/* Status */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <img src="/status-active.svg" alt="Active" className="h-5" />
              </div>

              {/* Phase */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Phase</span>
                <EditableField
                  value={trial?.phase || "Not set"}
                  onSave={async (newValue) => {
                    const phase = newValue as "Phase I" | "Phase II" | "Phase III" | "Phase IV";
                    await updateTrial.mutateAsync({ id: trialId, phase });
                  }}
                  type="select"
                  options={[
                    { value: "Phase I", label: "Phase I" },
                    { value: "Phase II", label: "Phase II" },
                    { value: "Phase III", label: "Phase III" },
                    { value: "Phase IV", label: "Phase IV" },
                  ]}
                  className="text-sm font-medium text-gray-900"
                />
              </div>

              {/* Start Date */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Start</span>
                <EditableField
                  value={trial?.startDate ? new Date(trial.startDate).toISOString().split('T')[0] : ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, startDate: newValue });
                  }}
                  type="date"
                  emptyText="Set date"
                  className="text-sm text-gray-900"
                />
              </div>

              {/* End Date */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">End</span>
                <EditableField
                  value={trial?.endDate ? new Date(trial.endDate).toISOString().split('T')[0] : ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, endDate: newValue });
                  }}
                  type="date"
                  emptyText="Set date"
                  className="text-sm text-gray-900"
                />
              </div>

              {/* Sponsor */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Sponsor</span>
                <EditableField
                  value={trial?.sponsor || ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, sponsor: newValue });
                  }}
                  emptyText="Add sponsor"
                  className="text-sm text-gray-900"
                />
              </div>

              {/* Location */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Location</span>
                <EditableField
                  value={trial?.location || ""}
                  onSave={async (newValue) => {
                    await updateTrial.mutateAsync({ id: trialId, location: newValue });
                  }}
                  emptyText="Add location"
                  className="text-sm text-gray-900"
                />
              </div>

              {/* Divider */}
              <div className="border-t border-gray-200 my-4"></div>

              {/* Patients */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Patients</span>
                </div>
                <span className="text-sm font-medium text-gray-900">{trial?.enrolledPatients || 0} / {trial?.targetPatients || 0}</span>
              </div>

              {/* Tasks */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Tasks</span>
                </div>
                <span className="text-sm font-medium text-gray-900">0 pending</span>
              </div>

              {/* Visits */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">Visits</span>
                </div>
                <span className="text-sm font-medium text-gray-900">0 scheduled</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#F9FAFB] overflow-hidden">
      {/* Top Navigation */}
      <TopNav />

      <div className="h-full overflow-y-auto">
        {/* Tabs Navigation Bar - White Floating Panel */}
        <div className="bg-[#F9FAFB] px-8 pt-3 pb-1 sticky top-0 z-40">
          <div className="bg-white rounded-lg border border-gray-200 px-6 py-2 flex items-center gap-6">
            {/* Back Button */}
            <button
              onClick={() => navigate("/trial-workspace")}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors pr-6 border-r border-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>All Trials</span>
            </button>

            {/* Tabs */}
            <div className="flex items-center gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3 py-1 text-xs transition-colors rounded ${
                      activeTab === tab.id
                        ? "text-blue-600 bg-[#F3F4F6]"
                        : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
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

        {/* Main Content */}
        <div className={`${activeTab === "document-hub" || activeTab === "study-setup-wizard" ? "" : "px-8"} pt-4 pb-6`}>
          {mainContent}
        </div>
      </div>
    </div>
  );
}
