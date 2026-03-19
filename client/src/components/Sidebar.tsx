/**
 * Sidebar Navigation Component
 * Design: Clinical Modernism - Systematic grid, cool clinical palette, Inter typography
 * Features: Three-state navigation (main menu, trial list, trial detail) with smooth transitions
 */

import { useEffect, useRef, useState } from "react";
import { useDemoState } from "@/contexts/DemoStateContext";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { 
  Home, 
  Brain,
  LayoutGrid, 
  Building, 
  Puzzle, 
  Bell, 
  Settings,
  Search,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  ArrowLeft,
  Upload,
  Download,
  Plus,
  Calendar,
  MessageSquare,
  MoreHorizontal,
  Check,
  X
} from "lucide-react";
import { MessageChatSquare } from "@/components/icons/MessageChatSquare";
import { TrialElements } from "@/components/icons/TrialElements";
import { AnalyticsIcon } from "@/components/icons/AnalyticsIcon";
import { BudgetIntelligenceIcon } from "@/components/icons/BudgetIntelligenceIcon";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { logEvent } from "@/lib/telemetry";
import { HANDOFF_FILENAME, downloadBrowserStateHandoffSnapshot } from "@/lib/browserStateHandoff";
import { useSidebarNav } from "@/contexts/SidebarNavContext";
import { useOrganizationProfile } from "@/hooks/useOrganizationProfile";
import { useOrganizationWorkspaces } from "@/hooks/useOrganizationWorkspaces";
import {
  CHAT_ACTIVE_UPDATED_EVENT,
  CHAT_SESSIONS_UPDATED_EVENT,
  deleteChatSession,
  formatRelativeChatTime,
  getActiveChatSessionId,
  listChatSessions,
  requestOpenChatSession,
  requestNewChatSession,
} from "@/lib/chatSessions";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  hasArrow?: boolean;
  onClick?: () => void;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

interface SidebarChatHistoryItem {
  id: string;
  title: string;
  time: string;
  searchableText: string;
}

export function Sidebar() {
  const [location, navigate] = useLocation();
  const isTrialAssistantRoute = location.startsWith("/trial/") && location.endsWith("/assistant");
  const isDocumentAssistant = location.startsWith("/documents") || isTrialAssistantRoute;
  const trialIdFromQuery = isTrialAssistantRoute
    ? location.split("/")[2]
    : isDocumentAssistant
      ? new URLSearchParams(window.location.search).get("trialId")
      : null;
  const { resetDemo, loadSampleData, loadFullDataset, getCurrentDataMode, getCloneStorageOverridesForMode } =
    useDemoState();
  const currentDataMode = getCurrentDataMode();
  const { profile, organizationInitial: profileInitial } = useOrganizationProfile();
  const {
    activeOrganization,
    otherOrganizations,
    cloneCurrentOrganization,
    switchOrganization,
  } = useOrganizationWorkspaces();
  const organizationName = String(profile.name || "").trim() || activeOrganization?.name || "Organization";
  const organizationLocation = String(profile.location || "").trim() || activeOrganization?.location || "";
  const organizationInitial = profileInitial || activeOrganization?.initial || "O";
  const utils = trpc.useUtils();
  const resetToEmptyMutation = trpc.demo.resetToEmpty.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      await utils.documents.list.invalidate();
    },
  });
  const loadSampleMutation = trpc.demo.loadSampleData.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      await utils.documents.list.invalidate();
    },
  });
  const loadFullMutation = trpc.demo.loadFullDataset.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      await utils.documents.list.invalidate();
    },
  });
  const fullResetMutation = trpc.demo.fullReset.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: currentDataMode });
      await utils.documents.list.invalidate();
    },
  });
  const cloneCurrentDemoToBuildingMutation = trpc.demo.cloneCurrentModeToBuilding.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate({ demoMode: "building" });
      await utils.documents.list.invalidate();
      await utils.map.loadWorkspace.invalidate();
    },
  });
  // Get trials from database
  const { data: dbTrials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });
  
  // Map database trials to sidebar format
  const trials = dbTrials.map((trial, index) => ({
    id: trial.id,
    name: trial.title,
    drug: trial.investigationalProduct || null,
    sponsor: trial.sponsor || 'No sponsor',
    status: trial.status,
    phase: trial.phase || 'Not set',
    enrolled: trial.enrolledPatients || 0,
    target: trial.targetPatients || 0,
    color: getTrialColor(index),
  }));
  
  // Generate consistent colors for trials
  function getTrialColor(index: number) {
    const colors = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#6366F1'];
    return colors[index % colors.length];
  }
  const { isCollapsed, setIsCollapsed } = useSidebarNav();
  const [chatHistoryItems, setChatHistoryItems] = useState<SidebarChatHistoryItem[]>([]);
  const [crossTrialChatHistoryItems, setCrossTrialChatHistoryItems] = useState<SidebarChatHistoryItem[]>([]);
  const [trialChatHistoryByTrial, setTrialChatHistoryByTrial] = useState<Record<string, SidebarChatHistoryItem[]>>({});
  const [activeChatSessionByScope, setActiveChatSessionByScope] = useState<Record<string, string | null>>({});
  const [chatHistorySearch, setChatHistorySearch] = useState("");
  const [chatHistorySearchOpen, setChatHistorySearchOpen] = useState(false);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const chatHistorySearchInputRef = useRef<HTMLInputElement>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'reset' | 'sample' | 'full' | 'building' | null;
  }>({ open: false, type: null });

  useEffect(() => {
    toast.dismiss("demo-reset");
  }, [currentDataMode]);

  useEffect(() => {
    if (chatHistorySearchOpen) {
      window.requestAnimationFrame(() => {
        chatHistorySearchInputRef.current?.focus();
      });
    }
  }, [chatHistorySearchOpen]);

  const handleSearchClick = () => {
    toast.info("Search feature coming soon");
    logEvent({
      eventType: "feature_used",
      action: "clicked",
      entityType: "search",
      payload: { location: "sidebar" },
    });
  };

  const handleDeleteConversation = ({
    sessionId,
    trialScopeId,
    title,
  }: {
    sessionId: string;
    trialScopeId: string | null;
    title: string;
  }) => {
    const removed = deleteChatSession({ sessionId });
    if (!removed) {
      toast.error("Could not delete conversation.");
      return;
    }

    const scopeKey = trialScopeId || "cross-trial";
    setActiveChatSessionByScope((prev) => ({
      ...prev,
      [scopeKey]: prev[scopeKey] === sessionId ? null : prev[scopeKey],
    }));
    if (activeChatSessionId === sessionId) {
      setActiveChatSessionId(null);
      const currentScopeTrialId = trialIdFromQuery || null;
      if (currentScopeTrialId === trialScopeId) {
        requestNewChatSession({
          trialId: currentScopeTrialId,
          dataMode: currentDataMode,
        });
        navigate(currentScopeTrialId ? `/trial/${currentScopeTrialId}/assistant` : "/documents");
      }
    }

    toast.success(`Deleted "${title}"`);
  };

  const handleExportEngineerHandoff = () => {
    const result = downloadBrowserStateHandoffSnapshot();
    if (!result.ok) {
      toast.error("Could not export browser handoff data.");
      return;
    }

    toast.success(`Downloaded ${HANDOFF_FILENAME}. Copy it to client/public/${HANDOFF_FILENAME} before zipping.`);
    logEvent({
      eventType: "feature_used",
      action: "export_browser_handoff",
      entityType: "handoff",
      payload: { filename: HANDOFF_FILENAME, mode: currentDataMode },
    });
  };



  const handleConfirmAction = async () => {
    const needsLoading = confirmDialog.type !== 'building';
    try {
      if (needsLoading) {
        toast.loading("Updating demo data...", { id: "demo-reset" });
      }
      if (confirmDialog.type === 'reset') {
        await resetToEmptyMutation.mutateAsync();
        resetDemo();
        toast.success("Data reset to empty state");
        logEvent({
          eventType: "feature_used",
          action: "reset_to_empty",
          entityType: "demo",
          payload: { mode: currentDataMode },
        });
      } else if (confirmDialog.type === 'sample') {
        await loadSampleMutation.mutateAsync();
        loadSampleData();
        toast.success("Sample data loaded");
        logEvent({
          eventType: "feature_used",
          action: "load_sample_data",
          entityType: "demo",
          payload: { mode: currentDataMode },
        });
      } else if (confirmDialog.type === 'full') {
        await loadFullMutation.mutateAsync();
        loadFullDataset();
        toast.success("Full dataset loaded");
        logEvent({
          eventType: "feature_used",
          action: "load_full_dataset",
          entityType: "demo",
          payload: { mode: currentDataMode },
        });
      }
      setConfirmDialog({ open: false, type: null });
      navigate("/trial-workspace");
    } catch (error) {
      console.error(error);
      toast.error("Demo reset failed. Please try again.");
    } finally {
      if (needsLoading) {
        toast.dismiss("demo-reset");
      }
    }
  };

  const getConfirmDialogContent = () => {
    switch (confirmDialog.type) {
      case 'reset':
        return {
          title: 'Reset to Empty',
          description: 'This will delete all trials, documents, tasks, and activity in building mode. This action cannot be undone.'
        };
      case 'sample':
        return {
          title: 'Load Sample Data',
          description: 'Switch to Sample mode. On first open in a new browser session, Sample starts from its saved default.'
        };
      case 'full':
        return {
          title: 'Load Full Dataset',
          description: 'Switch to Full mode. On first open in a new browser session, Full starts from its saved default.'
        };
      default:
        return { title: '', description: '' };
    }
  };

  const handleResetDemo = () => {
    setConfirmDialog({ open: false, type: null });
    resetDemo();
    navigate("/trial-workspace");
    toast.success("Demo reset to empty state");
  };

  // Main menu navigation sections
  const mainMenuSections: NavSection[] = [
    {
      title: "GENERAL",
      items: [
        { label: "Home", icon: Home, href: "/" },
        { 
          label: "Trial Workspace", 
          icon: TrialElements, 
          href: "/trial-workspace"
        },
      ],
    },
    {
      title: "WORKSPACE",
      items: [
        { label: "Themison AI", icon: Brain, href: "/documents" },
        { label: "Task Manager", icon: LayoutGrid, href: "/tasks" },
        { label: "Collaboration Hub", icon: MessageChatSquare, href: "/collaboration" },
        { label: "Analytics Dashboard", icon: AnalyticsIcon, href: "/analytics" },
        { label: "Budget Intelligence", icon: BudgetIntelligenceIcon, href: "/budget-intelligence" },
      ],
    },
    {
      title: "TEAM & ADMIN",
      items: [
        { label: "Organization", icon: Building, href: "/organization" },
        { label: "Integrations", icon: Puzzle, href: "/integrations" },
        { label: "Notifications", icon: Bell, href: "/notifications" },
      ],
    },
    {
      title: "CONFIGURATION",
      items: [
        { label: "Settings", icon: Settings, href: "/settings" },
      ],
    },
  ];

  // Render main menu
  const renderMainMenu = () => (
    <>
      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto px-3 pt-6 pb-2">
        {mainMenuSections.map((section, index) => (
          <div key={section.title} className={index === 0 ? "" : "mt-6"}>
            {!isCollapsed && (
              <h2 className="px-3 mb-2 text-xs font-semibold tracking-wider text-muted-foreground">
                {section.title}
              </h2>
            )}
            <div className="flex flex-col gap-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href;
                
                if (item.onClick) {
                  return (
                    <div
                      key={item.label}
                      onClick={item.onClick}
                      className={`
                        flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium
                        transition-all duration-150 ease-out cursor-pointer
                        text-sidebar-foreground hover:bg-gray-100
                        ${isCollapsed ? "justify-center" : "justify-between"}
                      `}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {!isCollapsed && <span>{item.label}</span>}
                      </div>
                      {!isCollapsed && item.hasArrow && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  );
                }
                
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      onClick={() => {
                        logEvent({
                          eventType: "feature_used",
                          action: "navigate",
                          entityType: "nav_item",
                          entityId: item.href,
                          payload: { label: item.label },
                        });
                      }}
                      className={`
                        flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium
                        transition-all duration-150 ease-out cursor-pointer
                        ${
                          isActive
                            ? "bg-[#ECEEF1] text-primary"
                            : "text-sidebar-foreground hover:bg-gray-100"
                        }
                        ${isCollapsed ? "justify-center" : ""}
                      `}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {!isCollapsed && <span>{item.label}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {isDocumentAssistant && !trialIdFromQuery && !isCollapsed && (
          <div className="mt-6 border-t border-sidebar-border pt-4">
            <div className="relative mb-2 h-7">
              <div className="absolute inset-0 flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">
                  CONVERSATIONS
                </h3>
                <button
                  type="button"
                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${
                    chatHistorySearchOpen || chatHistorySearch.trim()
                      ? "bg-blue-50 text-blue-600"
                      : "text-muted-foreground hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    if (!chatHistorySearchOpen) {
                      setChatHistorySearchOpen(true);
                      return;
                    }
                    if (chatHistorySearch.trim()) {
                      setChatHistorySearch("");
                    } else {
                      setChatHistorySearchOpen(false);
                    }
                  }}
                  aria-label="Search conversations"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
              </div>
              <div
                className={`absolute right-0 top-0 h-7 overflow-hidden transition-all duration-200 ease-out ${
                  chatHistorySearchOpen ? "w-full opacity-100" : "w-0 opacity-0 pointer-events-none"
                }`}
              >
                <div className="relative h-7">
                  <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input
                    ref={chatHistorySearchInputRef}
                    value={chatHistorySearch}
                    onChange={(event) => setChatHistorySearch(event.target.value)}
                    placeholder="Search conversations"
                    className="h-7 pl-7 pr-8 text-xs bg-white border-gray-200 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-gray-200"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => {
                      setChatHistorySearch("");
                      setChatHistorySearchOpen(false);
                    }}
                    aria-label="Close search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start gap-2 h-8 mb-3 text-xs"
              onClick={() => {
                requestNewChatSession({
                  trialId: null,
                  dataMode: currentDataMode,
                });
                setActiveChatSessionId(null);
                navigate("/documents");
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New cross-trial conversation
            </Button>

            {(() => {
              const normalizedSearch = chatHistorySearch.trim().toLowerCase();
              const filterItems = (items: SidebarChatHistoryItem[]) =>
                normalizedSearch
                  ? items.filter((chat) => chat.searchableText.includes(normalizedSearch))
                  : items;

              const sections: Array<{
                key: string;
                label: string;
                trialId: string | null;
                assistantRoute: string;
                activeSessionId: string | null;
                items: SidebarChatHistoryItem[];
              }> = [];

              const crossTrialItems = filterItems(crossTrialChatHistoryItems);
              if (crossTrialItems.length > 0 || !normalizedSearch) {
                sections.push({
                  key: "cross-trial",
                  label: "Cross-trial",
                  trialId: null,
                  assistantRoute: "/documents",
                  activeSessionId: activeChatSessionByScope["cross-trial"] || null,
                  items: crossTrialItems,
                });
              }

              trials.forEach((trial) => {
                const items = filterItems(trialChatHistoryByTrial[trial.id] || []);
                if (items.length === 0) return;
                sections.push({
                  key: trial.id,
                  label: trial.drug || trial.name,
                  trialId: trial.id,
                  assistantRoute: `/trial/${trial.id}/assistant`,
                  activeSessionId: activeChatSessionByScope[trial.id] || null,
                  items,
                });
              });

              if (sections.length === 0) {
                return (
                  <div className="py-2 px-3 text-xs text-muted-foreground">
                    {normalizedSearch ? "No matching conversations" : "No conversations yet"}
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {sections.map((section) => (
                    <div key={section.key}>
                      <p className="px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {section.label}
                      </p>
                      <div className="mt-1 space-y-1">
                        {section.items.slice(0, normalizedSearch ? 20 : 4).map((chat) => (
                          <button
                            key={chat.id}
                            type="button"
                            className={`w-full flex items-start gap-2 py-1.5 pr-2 pl-3 rounded-md text-left transition-colors ${
                              section.activeSessionId === chat.id
                                ? "bg-[#E6E7EB]"
                                : "hover:bg-[#E6E7EB]"
                            }`}
                            onClick={() => {
                              requestOpenChatSession({
                                trialId: section.trialId,
                                dataMode: currentDataMode,
                                sessionId: chat.id,
                              });
                              setActiveChatSessionByScope((prev) => ({
                                ...prev,
                                [section.key]: chat.id,
                              }));
                              navigate(section.assistantRoute);
                            }}
                          >
                            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs text-sidebar-foreground truncate">{chat.title}</div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">{chat.time}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </nav>
    </>
  );

  useEffect(() => {
    if (!isDocumentAssistant) {
      setChatHistoryItems([]);
      setCrossTrialChatHistoryItems([]);
      setTrialChatHistoryByTrial({});
      setActiveChatSessionId(null);
      setActiveChatSessionByScope({});
      return;
    }

    const mapSessionsToItems = (trialScopeId: string | null) =>
      listChatSessions({
        trialId: trialScopeId,
        dataMode: currentDataMode,
      }).map((session) => ({
        id: session.id,
        title: session.title,
        time: formatRelativeChatTime(session.updatedAt),
        searchableText: `${session.title} ${session.messages
          .map((message) => message.content)
          .join(" ")}`.toLowerCase(),
      }));

    const refreshHistory = () => {
      const crossTrialItems = mapSessionsToItems(null);
      const nextTrialChatHistoryByTrial: Record<string, SidebarChatHistoryItem[]> = {};
      const nextActiveByScope: Record<string, string | null> = {
        "cross-trial": getActiveChatSessionId({
          trialId: null,
          dataMode: currentDataMode,
        }),
      };

      dbTrials.forEach((trial) => {
        const trialItems = mapSessionsToItems(trial.id);
        if (trialItems.length > 0) {
          nextTrialChatHistoryByTrial[trial.id] = trialItems;
        }
        nextActiveByScope[trial.id] = getActiveChatSessionId({
          trialId: trial.id,
          dataMode: currentDataMode,
        });
      });

      setCrossTrialChatHistoryItems(crossTrialItems);
      setTrialChatHistoryByTrial(nextTrialChatHistoryByTrial);
      setActiveChatSessionByScope(nextActiveByScope);

      if (trialIdFromQuery) {
        setChatHistoryItems(nextTrialChatHistoryByTrial[trialIdFromQuery] || []);
        setActiveChatSessionId(nextActiveByScope[trialIdFromQuery] || null);
      } else {
        setChatHistoryItems(crossTrialItems);
        setActiveChatSessionId(nextActiveByScope["cross-trial"] || null);
      }
    };

    refreshHistory();

    const handleStorage = () => refreshHistory();
    const handleCustomUpdate = () => refreshHistory();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleCustomUpdate as EventListener);
    window.addEventListener(CHAT_ACTIVE_UPDATED_EVENT, handleCustomUpdate as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CHAT_SESSIONS_UPDATED_EVENT, handleCustomUpdate as EventListener);
      window.removeEventListener(CHAT_ACTIVE_UPDATED_EVENT, handleCustomUpdate as EventListener);
    };
  }, [isDocumentAssistant, trialIdFromQuery, currentDataMode, dbTrials]);

  // Render chat history panel (Themison AI only)
  const renderChatHistoryPanel = () => {
    if (!isDocumentAssistant) return null;

    const trial = trialIdFromQuery ? trials.find((item) => item.id === trialIdFromQuery) : null;

    const normalizedSearch = chatHistorySearch.trim().toLowerCase();
    const filteredChatHistory = normalizedSearch
      ? chatHistoryItems.filter((chat) => chat.searchableText.includes(normalizedSearch))
      : chatHistoryItems;
    const chatHistoryPreview = filteredChatHistory.slice(0, normalizedSearch ? 20 : 3);
    const assistantRoute = trialIdFromQuery
      ? isTrialAssistantRoute
        ? `/trial/${trialIdFromQuery}/assistant`
        : `/documents?trialId=${encodeURIComponent(trialIdFromQuery)}`
      : "/documents";

    return (
      <>
        {/* Back Button */}
        {!isCollapsed && (
          <div className="px-4 py-4">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/')}
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Button>
          </div>
        )}

        {/* Trial Header */}
        {!isCollapsed && trialIdFromQuery && trial && (
          <div className="px-4 pb-4">
            <div className="pl-3">
              <div className="flex items-center gap-3">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: trial.color }}
                />
                <div className="font-semibold text-sidebar-foreground truncate">
                  {trial.drug || trial.name}
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 pl-6">
                {trial.sponsor}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 pl-6">
                {trial.phase} · {trial.status}
              </div>
            </div>
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {/* Chat History */}
          {!isCollapsed && (
            <div className="pb-4">
              <div className="border-t border-sidebar-border pt-4">
                <div className="relative mb-2 h-7">
                  <div className="absolute inset-0 flex items-center justify-between">
                    <h3 className="text-xs font-semibold tracking-wider text-muted-foreground">
                      CHAT HISTORY
                    </h3>
                    <button
                      type="button"
                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors ${
                        chatHistorySearchOpen || normalizedSearch
                          ? "bg-blue-50 text-blue-600"
                          : "text-muted-foreground hover:bg-gray-100"
                      }`}
                      onClick={() => {
                        if (!chatHistorySearchOpen) {
                          setChatHistorySearchOpen(true);
                          return;
                        }
                        if (chatHistorySearch.trim()) {
                          setChatHistorySearch("");
                        } else {
                          setChatHistorySearchOpen(false);
                        }
                      }}
                      aria-label="Search chats"
                    >
                      <Search className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div
                    className={`absolute right-0 top-0 h-7 overflow-hidden transition-all duration-200 ease-out ${
                      chatHistorySearchOpen ? "w-full opacity-100" : "w-0 opacity-0 pointer-events-none"
                    }`}
                  >
                    <div className="relative h-7">
                      <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <Input
                        ref={chatHistorySearchInputRef}
                        value={chatHistorySearch}
                        onChange={(event) => setChatHistorySearch(event.target.value)}
                        placeholder="Search chats"
                        className="h-7 pl-7 pr-8 text-xs bg-white border-gray-200 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-gray-200"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => {
                          setChatHistorySearch("");
                          setChatHistorySearchOpen(false);
                        }}
                        aria-label="Close search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 h-8 mb-2 text-xs"
                  onClick={() => {
                    const scopeTrialId = trialIdFromQuery || null;
                    requestNewChatSession({
                      trialId: scopeTrialId,
                      dataMode: currentDataMode,
                    });
                    setActiveChatSessionId(null);
                    setActiveChatSessionByScope((prev) => ({
                      ...prev,
                      [scopeTrialId || "cross-trial"]: null,
                    }));
                    setChatHistorySearch("");
                    setChatHistorySearchOpen(false);
                    navigate(assistantRoute);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New conversation
                </Button>
                <div className="space-y-2">
                  {trialIdFromQuery ? (
                    <>
                      {chatHistoryPreview.length === 0 ? (
                        <div className="py-2 pr-2 pl-3 text-xs text-muted-foreground">
                          {normalizedSearch ? "No matching chats" : "No chats yet"}
                        </div>
                      ) : (
                        chatHistoryPreview.map((chat) => (
                          <div
                            key={chat.id}
                            className={`group relative flex items-start gap-3 py-2 pr-8 pl-3 rounded-md cursor-pointer transition-colors ${
                              activeChatSessionId === chat.id
                                ? "bg-[#E6E7EB]"
                                : "hover:bg-[#E6E7EB]"
                            }`}
                            onClick={() => {
                              requestOpenChatSession({
                                trialId: trialIdFromQuery,
                                dataMode: currentDataMode,
                                sessionId: chat.id,
                              });
                              setActiveChatSessionId(chat.id);
                              setActiveChatSessionByScope((prev) => ({
                                ...prev,
                                [trialIdFromQuery]: chat.id,
                              }));
                              navigate(assistantRoute);
                            }}
                          >
                            <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-sidebar-foreground truncate">
                                {chat.title}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {chat.time}
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="absolute right-2 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label="Conversation options"
                                  title="Conversation options"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    requestOpenChatSession({
                                      trialId: trialIdFromQuery,
                                      dataMode: currentDataMode,
                                      sessionId: chat.id,
                                    });
                                    setActiveChatSessionId(chat.id);
                                    setActiveChatSessionByScope((prev) => ({
                                      ...prev,
                                      [trialIdFromQuery]: chat.id,
                                    }));
                                    navigate(assistantRoute);
                                  }}
                                >
                                  Open conversation
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-600"
                                  onSelect={() => {
                                    handleDeleteConversation({
                                      sessionId: chat.id,
                                      trialScopeId: trialIdFromQuery || null,
                                      title: chat.title,
                                    });
                                  }}
                                >
                                  Delete conversation
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ))
                      )}
                    </>
                  ) : (
                    (() => {
                      const filterItems = (items: SidebarChatHistoryItem[]) =>
                        normalizedSearch
                          ? items.filter((chat) => chat.searchableText.includes(normalizedSearch))
                          : items;

                      const sections: Array<{
                        key: string;
                        label: string;
                        trialId: string | null;
                        assistantRoute: string;
                        activeSessionId: string | null;
                        items: SidebarChatHistoryItem[];
                      }> = [];

                      sections.push({
                        key: "cross-trial",
                        label: "Cross-trial",
                        trialId: null,
                        assistantRoute: "/documents",
                        activeSessionId: activeChatSessionByScope["cross-trial"] || null,
                        items: filterItems(crossTrialChatHistoryItems),
                      });

                      trials.forEach((entry) => {
                        const items = filterItems(trialChatHistoryByTrial[entry.id] || []);
                        if (items.length === 0) return;
                        sections.push({
                          key: entry.id,
                          label: entry.drug || entry.name,
                          trialId: entry.id,
                          assistantRoute: `/trial/${entry.id}/assistant`,
                          activeSessionId: activeChatSessionByScope[entry.id] || null,
                          items,
                        });
                      });

                      const hasItems = sections.some((section) => section.items.length > 0);
                      if (!hasItems) {
                        return (
                          <div className="py-2 pr-2 pl-3 text-xs text-muted-foreground">
                            {normalizedSearch ? "No matching chats" : "No chats yet"}
                          </div>
                        );
                      }

                      return (
                        <div className="mt-4 space-y-3">
                          {sections.map((section) => (
                            <div key={section.key}>
                              <p className="px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                                {section.label}
                              </p>
                              <div className="mt-1 space-y-1">
                                {section.items.slice(0, normalizedSearch ? 20 : 4).map((chat) => (
                                  <div
                                    key={chat.id}
                                    className={`group relative w-full flex items-start gap-2 py-1.5 pr-8 pl-3 rounded-md text-left transition-colors cursor-pointer ${
                                      section.activeSessionId === chat.id
                                        ? "bg-[#E6E7EB]"
                                        : "hover:bg-[#E6E7EB]"
                                    }`}
                                    onClick={() => {
                                      requestOpenChatSession({
                                        trialId: section.trialId,
                                        dataMode: currentDataMode,
                                        sessionId: chat.id,
                                      });
                                      setActiveChatSessionByScope((prev) => ({
                                        ...prev,
                                        [section.key]: chat.id,
                                      }));
                                      if (section.trialId === null) {
                                        setActiveChatSessionId(chat.id);
                                      }
                                      navigate(section.assistantRoute);
                                    }}
                                  >
                                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs text-sidebar-foreground truncate">{chat.title}</div>
                                      <div className="text-[11px] text-muted-foreground mt-0.5">{chat.time}</div>
                                    </div>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          className="absolute right-2 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100"
                                          onClick={(event) => event.stopPropagation()}
                                          aria-label="Conversation options"
                                          title="Conversation options"
                                        >
                                          <MoreHorizontal className="h-3.5 w-3.5" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                                        <DropdownMenuItem
                                          onSelect={() => {
                                            requestOpenChatSession({
                                              trialId: section.trialId,
                                              dataMode: currentDataMode,
                                              sessionId: chat.id,
                                            });
                                            setActiveChatSessionByScope((prev) => ({
                                              ...prev,
                                              [section.key]: chat.id,
                                            }));
                                            if (section.trialId === null) {
                                              setActiveChatSessionId(chat.id);
                                            }
                                            navigate(section.assistantRoute);
                                          }}
                                        >
                                          Open conversation
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          className="text-red-600 focus:text-red-600"
                                          onSelect={() => {
                                            handleDeleteConversation({
                                              sessionId: chat.id,
                                              trialScopeId: section.trialId,
                                              title: chat.title,
                                            });
                                          }}
                                        >
                                          Delete conversation
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                  {trialIdFromQuery ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs text-primary"
                      onClick={() => {
                        requestNewChatSession({
                          trialId: trialIdFromQuery,
                          dataMode: currentDataMode,
                        });
                        navigate(assistantRoute);
                      }}
                    >
                      View all chats →
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <aside className={`fixed left-0 top-0 h-screen bg-white flex flex-col transition-all duration-300 z-10 ${
      isCollapsed ? "w-[64px]" : "w-[280px]"
    }`}>
      {/* Organization Header */}
      <div className={`h-11 px-3 mt-2 flex items-center ${isCollapsed ? "justify-center" : "justify-between"}`}>
        {!isCollapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-8 text-sm font-medium px-2">
                <div className="w-5 h-5 rounded bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">
                  {organizationInitial}
                </div>
                <span className="text-sm">{organizationName}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Switch Organization</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-primary flex items-center justify-center text-primary-foreground text-xs font-semibold">
                    {organizationInitial}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{organizationName}</span>
                    <span className="text-xs text-muted-foreground">
                      {organizationLocation || "Current Organization"}
                    </span>
                  </div>
                </div>
                <Check className="ml-auto h-4 w-4 text-primary" />
              </DropdownMenuItem>
              {otherOrganizations.length ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Other Organizations</DropdownMenuLabel>
                  {otherOrganizations.map((organization) => (
                    <DropdownMenuItem
                      key={organization.id}
                      onSelect={() => {
                        switchOrganization(organization.id);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center text-white text-xs font-semibold">
                          {organization.initial}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{organization.name}</span>
                          {organization.location ? (
                            <span className="text-xs text-muted-foreground">{organization.location}</span>
                          ) : null}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  toast.loading("Creating demo copy...", { id: "organization-clone" });
                  const cloneId = cloneCurrentOrganization({
                    snapshotOverrides: getCloneStorageOverridesForMode("building"),
                  });
                  if (!cloneId) {
                    toast.error("Could not create organization copy.", { id: "organization-clone" });
                    return;
                  }

                  try {
                    if (currentDataMode === "sample" || currentDataMode === "full") {
                      await cloneCurrentDemoToBuildingMutation.mutateAsync({ sourceMode: currentDataMode });
                    }
                    toast.success("Created a demo copy in building mode. Switch to it from the organization list.", {
                      id: "organization-clone",
                    });
                  } catch (error) {
                    console.error(error);
                    toast.warning("Organization copy created, but demo data copy failed. It still appears in the list.", {
                      id: "organization-clone",
                    });
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  <span>Create copy of current</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportEngineerHandoff}>
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  <span>Export engineer handoff</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-md p-2 text-sidebar-foreground hover:bg-gray-100"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <PanelLeftClose className="h-4 w-4 text-sidebar-foreground" />
          ) : (
            <PanelLeft className="h-4 w-4 text-sidebar-foreground" />
          )}
        </Button>
      </div>


      {/* Dynamic Content Based on Route */}
      <div className="flex-1 flex flex-col min-h-0 transition-opacity duration-500 ease-in-out">
        {!isDocumentAssistant && (
          <div className="flex-1 flex flex-col min-h-0 animate-in fade-in slide-in-from-left-4 duration-500">
            {renderMainMenu()}
          </div>
        )}
        {isDocumentAssistant && (
          <div className="flex-1 flex flex-col min-h-0 animate-in fade-in slide-in-from-right-4 duration-500">
            {renderChatHistoryPanel()}
          </div>
        )}
      </div>

      {/* Logo Footer - Fixed at bottom */}
      {!isCollapsed && (
        <div className="p-4 flex-shrink-0 flex items-center justify-start">
          <img 
            src="/images/themison-logo.svg" 
            alt="Themison" 
            className="h-3 w-auto"
          />
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ open, type: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{getConfirmDialogContent().title}</AlertDialogTitle>
            <AlertDialogDescription>
              {getConfirmDialogContent().description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
