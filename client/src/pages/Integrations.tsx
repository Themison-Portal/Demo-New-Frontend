/**
 * Integrations Page
 * Clinical-trial focused integration catalog (coming-soon state)
 */

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ClipboardList,
  Cloud,
  Database,
  Filter,
  FlaskConical,
  FolderOpen,
  Puzzle,
  RadioTower,
  Search,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocation } from "wouter";

type IntegrationCategory =
  | "operations"
  | "data_capture"
  | "documents"
  | "randomization"
  | "safety"
  | "labs"
  | "patient_engagement";

type IntegrationStatus = "coming_soon";
type IntegrationScope = "all_trials" | "trial";
type IntegrationTab = "all" | "edc" | "ctms" | "etmf" | "sponsor" | "safety" | "other";
type SyncDirection = "import" | "export" | "bidirectional";

type IntegrationDef = {
  id: string;
  name: string;
  description: string;
  clinicalValue: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  icon: LucideIcon;
  directions: SyncDirection[];
  scopes: IntegrationScope[];
  tags: string[];
  tab: Exclude<IntegrationTab, "all">;
};

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "calendar-outlook",
    name: "Calendar / Outlook",
    description: "Sync visits, deadlines, and team reminders",
    clinicalValue: "Prevent missed protocol windows with schedule visibility for PI, CRC, and site teams.",
    category: "operations",
    status: "coming_soon",
    icon: Calendar,
    directions: ["bidirectional"],
    scopes: ["all_trials", "trial"],
    tags: ["visit windows", "reminders", "scheduling"],
    tab: "other",
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    description: "Keep trial documents and team workspaces aligned",
    clinicalValue: "Mirror protocol updates and operational SOP docs in your existing collaboration hub.",
    category: "documents",
    status: "coming_soon",
    icon: Cloud,
    directions: ["bidirectional"],
    scopes: ["all_trials", "trial"],
    tags: ["document sync", "collaboration", "sops"],
    tab: "etmf",
  },
  {
    id: "ctms",
    name: "CTMS",
    description: "Auto-import site, startup, and enrollment milestones",
    clinicalValue: "Keep startup and recruitment progress aligned with your source operations system.",
    category: "operations",
    status: "coming_soon",
    icon: Database,
    directions: ["import"],
    scopes: ["all_trials", "trial"],
    tags: ["site activation", "enrollment", "milestones"],
    tab: "ctms",
  },
  {
    id: "edc",
    name: "EDC",
    description: "Link protocol tasks to eCRF and data-capture workflows",
    clinicalValue: "Tie operational tasks to data entry checkpoints and query-resolution timelines.",
    category: "data_capture",
    status: "coming_soon",
    icon: ClipboardList,
    directions: ["bidirectional"],
    scopes: ["all_trials", "trial"],
    tags: ["ecrf", "queries", "data entry"],
    tab: "edc",
  },
  {
    id: "etmf",
    name: "eTMF / eISF",
    description: "Track essential-file readiness and document workflows",
    clinicalValue: "Surface missing or outdated trial docs before monitoring visits and audits.",
    category: "documents",
    status: "coming_soon",
    icon: FolderOpen,
    directions: ["bidirectional"],
    scopes: ["all_trials", "trial"],
    tags: ["essential docs", "inspection readiness", "tmf"],
    tab: "etmf",
  },
  {
    id: "irt-iwrs",
    name: "Sponsor Portal / IRT",
    description: "Align randomization and dispensing checkpoints",
    clinicalValue: "Coordinate dosing tasks with treatment-arm and kit assignment events.",
    category: "randomization",
    status: "coming_soon",
    icon: RadioTower,
    directions: ["import"],
    scopes: ["trial"],
    tags: ["randomization", "dispensing", "kits"],
    tab: "sponsor",
  },
  {
    id: "safety",
    name: "Safety / PV",
    description: "Route SAE/SUSAR timelines into operational workflows",
    clinicalValue: "Keep safety reporting deadlines visible and auditable across study teams.",
    category: "safety",
    status: "coming_soon",
    icon: ShieldAlert,
    directions: ["bidirectional"],
    scopes: ["all_trials", "trial"],
    tags: ["sae", "susar", "reporting"],
    tab: "safety",
  },
  {
    id: "lims",
    name: "Lab / LIMS",
    description: "Sync specimen workflows and processing checkpoints",
    clinicalValue: "Coordinate collection, handling, shipping, and result receipt milestones.",
    category: "labs",
    status: "coming_soon",
    icon: FlaskConical,
    directions: ["import"],
    scopes: ["trial"],
    tags: ["samples", "shipping", "processing"],
    tab: "other",
  },
  {
    id: "epro-ecoa",
    name: "ePRO / eCOA",
    description: "Connect patient-reported outcome schedules and completion",
    clinicalValue: "Track completion and trigger follow-up tasks for missed assessments.",
    category: "patient_engagement",
    status: "coming_soon",
    icon: UserRound,
    directions: ["import"],
    scopes: ["trial"],
    tags: ["patient reporting", "assessments", "compliance"],
    tab: "other",
  },
];

const CATALOG_TABS: Array<{ key: IntegrationTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "edc", label: "EDC" },
  { key: "ctms", label: "CTMS" },
  { key: "etmf", label: "eTMF / eISF" },
  { key: "sponsor", label: "Sponsor Portal" },
  { key: "safety", label: "Safety" },
  { key: "other", label: "Other" },
];

const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  operations: "Operations",
  data_capture: "Data Capture",
  documents: "Documents",
  randomization: "Randomization",
  safety: "Safety",
  labs: "Labs",
  patient_engagement: "Patient Engagement",
};

export default function Integrations() {
  const [, setLocation] = useLocation();
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });

  const [integrationsView, setIntegrationsView] = useState<"catalog" | "activity">("catalog");
  const [activeTab, setActiveTab] = useState<IntegrationTab>("all");
  const [trialScope, setTrialScope] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<IntegrationCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | IntegrationStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const uniqueIntegrations = useMemo(
    () => Array.from(new Map(INTEGRATIONS.map((entry) => [entry.id, entry])).values()),
    []
  );

  const integrations = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return uniqueIntegrations.filter((integration) => {
      if (activeTab !== "all" && integration.tab !== activeTab) return false;
      if (trialScope !== "all" && !integration.scopes.includes("trial")) return false;
      if (categoryFilter !== "all" && integration.category !== categoryFilter) return false;
      if (statusFilter !== "all" && integration.status !== statusFilter) return false;
      if (!query) return true;
      const haystack = [
        integration.name,
        integration.description,
        integration.clinicalValue,
        integration.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [activeTab, trialScope, categoryFilter, statusFilter, searchTerm, uniqueIntegrations]);

  const summary = useMemo(
    () => ({
      connected: 0,
      available: 0,
      comingSoon: uniqueIntegrations.length,
    }),
    [uniqueIntegrations.length]
  );

  const trialLabel = useMemo(() => {
    if (trialScope === "all") return "All trials";
    const trial = trials.find((entry) => entry.id.toLowerCase() === trialScope.toLowerCase());
    return trial ? trial.investigationalProduct || trial.title : "Selected trial";
  }, [trialScope, trials]);

  return (
    <div className="px-8 pb-4 pt-4 h-[calc(100vh-72px)] overflow-hidden flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-foreground tracking-tight">Integrations</h1>
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            Coming soon
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect clinical systems to keep protocol, operations, and execution data in sync.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 h-11 pl-5 pr-2 py-0 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors pr-5 border-r border-gray-200"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </button>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setIntegrationsView("catalog")}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                integrationsView === "catalog"
                  ? "text-blue-700 bg-blue-50"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Puzzle className="h-4 w-4" />
              Integration Hub
            </button>
            <button
              type="button"
              onClick={() => setIntegrationsView("activity")}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded whitespace-nowrap transition-colors ${
                integrationsView === "activity"
                  ? "text-blue-700 bg-blue-50"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Activity className="h-4 w-4" />
              Activity
            </button>
          </div>
        </div>

        <div className="ml-auto">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md h-7 px-3 text-xs border bg-primary text-primary-foreground border-primary hover:bg-primary/90"
            onClick={() => toast.message("Integrations are in roadmap mode. Connect flows are coming soon.")}
          >
            Request Integration
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {integrationsView === "catalog" ? (
          <div className="h-full min-h-0 flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Connected</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.connected}</p>
                <p className="text-xs text-gray-500 mt-1">Active integration links</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Available</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.available}</p>
                <p className="text-xs text-gray-500 mt-1">Ready for connection</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Coming soon</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{summary.comingSoon}</p>
                <p className="text-xs text-gray-500 mt-1">Planned connectors</p>
              </div>
            </div>

            <div className="flex-1 min-h-0 bg-white rounded-xl border border-gray-200 p-6 overflow-hidden flex flex-col">
              <div className="pb-3 border-b border-gray-200">
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {CATALOG_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={
                        activeTab === tab.key
                          ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                          : "text-gray-500 hover:text-gray-700 pb-1"
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[260px] flex-1">
                    <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      placeholder="Search systems..."
                      className="pl-9 h-10"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                    />
                    {searchTerm ? (
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setSearchTerm("")}
                        aria-label="Clear search"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>

                  <div className="relative">
                    <select
                      className="h-9 rounded-md border border-gray-200 bg-white px-3 pr-8 text-sm min-w-[124px] appearance-none"
                      value={categoryFilter}
                      onChange={(event) => setCategoryFilter(event.target.value as IntegrationCategory | "all")}
                    >
                      <option value="all">Categories</option>
                      {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 text-sm"
                    onClick={() => setShowAdvancedFilters((value) => !value)}
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Filter
                  </Button>
                </div>

                {showAdvancedFilters ? (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="relative">
                      <select
                        className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 pr-8 text-sm appearance-none"
                        value={trialScope}
                        onChange={(event) => setTrialScope(event.target.value)}
                      >
                        <option value="all">All Trials</option>
                        {trials.map((trial) => (
                          <option key={trial.id} value={trial.id.toLowerCase()}>
                            {(trial.investigationalProduct || trial.title) + " · " + (trial.sponsor || "No sponsor")}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>

                    <div className="relative">
                      <select
                        className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 pr-8 text-sm appearance-none"
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as "all" | IntegrationStatus)}
                      >
                        <option value="all">All Statuses</option>
                        <option value="coming_soon">Coming soon</option>
                      </select>
                      <ChevronDown className="h-4 w-4 text-gray-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                ) : null}

                <p className="mt-3 text-xs text-gray-500">
                  Scope: <span className="font-medium text-gray-700">{trialLabel}</span>
                </p>
              </div>

              <div className="mt-5 flex-1 min-h-0 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {integrations.map((integration) => {
                    const Icon = integration.icon;
                    return (
                      <div
                        key={integration.id}
                        className="group rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-all duration-200"
                      >
                        <div className="h-[88px] bg-gradient-to-b from-[#f4f5f7] to-[#eceff3] p-4 border-b border-gray-100 flex items-start justify-between">
                          <span />
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 group-hover:text-[#2F6FED] transition-colors">
                            <Icon className="h-4 w-4" />
                          </span>
                        </div>

                        <div className="p-4">
                          <h3 className="text-base font-semibold text-foreground mb-2">{integration.name}</h3>
                          <p className="text-xs text-muted-foreground mb-4">{integration.description}</p>

                          <div className="space-y-2">
                            <div className="flex items-baseline justify-between">
                              <span className="text-xs text-muted-foreground">Category</span>
                              <span className="text-sm font-semibold text-foreground">
                                {CATEGORY_LABELS[integration.category]}
                              </span>
                            </div>

                            <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="absolute inset-y-0 left-0 rounded-full w-[10%]" style={{ backgroundColor: "#d9d9d9" }} />
                            </div>
                            <div className="text-xs text-muted-foreground">Integration roadmap pending</div>
                          </div>

                          <div className="mt-4 pt-4 border-t border-border">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Puzzle className="w-3.5 h-3.5" />
                              <span className="line-clamp-2">{integration.clinicalValue}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {integrations.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center text-sm text-gray-500">
                      No integrations match your filters.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full min-h-0 rounded-xl border border-gray-200 bg-white p-5 overflow-y-auto">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Integration Activity</h3>
            </div>
            <div className="mt-4 rounded-lg border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
              Connector provisioning and sync logs will appear here once integrations are enabled.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
