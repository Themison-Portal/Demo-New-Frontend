/**
 * Sidebar Navigation Component
 * Design: Clinical Modernism - Systematic grid, cool clinical palette, Inter typography
 * Features: Three-state navigation (main menu, trial list, trial detail) with smooth transitions
 */

import { useState } from "react";
import { useDemoState } from "@/contexts/DemoStateContext";
import { useSidebarNav } from "@/contexts/SidebarNavContext";
import { trpc } from "@/lib/trpc";
import { Link, useLocation } from "wouter";
import { 
  Home, 
  FileText, 
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
  Plus,
  Calendar,
  MessageSquare,
  Check
} from "lucide-react";
import { MessageChatSquare } from "@/components/icons/MessageChatSquare";
import { TrialElements } from "@/components/icons/TrialElements";
import { AnalyticsIcon } from "@/components/icons/AnalyticsIcon";
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

export function Sidebar() {
  const [location, navigate] = useLocation();
  const isTrialAssistantRoute = location.startsWith("/trial/") && location.endsWith("/assistant");
  const isDocumentAssistant = location.startsWith("/documents") || isTrialAssistantRoute;
  const trialIdFromQuery = isTrialAssistantRoute
    ? location.split("/")[2]
    : isDocumentAssistant
      ? new URLSearchParams(window.location.search).get("trialId")
      : null;
  const { resetDemo, loadSampleData, loadFullDataset, getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  // Get trials from database
  const { data: dbTrials = [] } = trpc.trials.list.useQuery();
  
  // Map database trials to sidebar format
  const trials = dbTrials.map((trial, index) => ({
    id: trial.id,
    name: trial.title,
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
  const { isCollapsed } = useSidebarNav();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'reset' | 'sample' | 'full' | null;
  }>({ open: false, type: null });

  const handleSearchClick = () => {
    toast.info("Search feature coming soon");
  };



  const handleLoadSampleData = () => {
    setConfirmDialog({ open: false, type: null });
    loadSampleData();
    navigate("/trial-workspace");
    toast.success("Sample data loaded (8 trials)");
  };

  const handleLoadFullDataset = () => {
    setConfirmDialog({ open: false, type: null });
    loadFullDataset();
    navigate("/trial-workspace");
    toast.success("Full dataset loaded (25+ trials)");
  };

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'reset') {
      handleResetDemo();
    } else if (confirmDialog.type === 'sample') {
      handleLoadSampleData();
    } else if (confirmDialog.type === 'full') {
      handleLoadFullDataset();
    }
  };

  const getConfirmDialogContent = () => {
    switch (confirmDialog.type) {
      case 'reset':
        return {
          title: 'Reset to Empty',
          description: 'Are you sure you want to reset all data? This will delete all trials, documents, tasks, and activity. This action cannot be undone.'
        };
      case 'sample':
        return {
          title: 'Load Sample Data',
          description: 'Are you sure you want to load sample data? This will replace all current data with 8 preset trials.'
        };
      case 'full':
        return {
          title: 'Load Full Dataset',
          description: 'Are you sure you want to load the full dataset? This will replace all current data with 25+ preset trials and extensive mock data.'
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
        { label: "Dashboard", icon: Home, href: "/" },
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
        { label: "Document AI Assistant", icon: FileText, href: "/documents" },
        { label: "Task Manager", icon: LayoutGrid, href: "/tasks" },
        { label: "Collaboration Hub", icon: MessageChatSquare, href: "/collaboration" },
        { label: "Analytics", icon: AnalyticsIcon, href: "/analytics" },
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
        {mainMenuSections.map((section, sectionIdx) => (
          <div key={section.title}>
            {sectionIdx > 0 && (
              <div className="my-4 border-t border-sidebar-border" />
            )}
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
                        text-sidebar-foreground hover:bg-[#E6E7EB]
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
                      className={`
                        flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium
                        transition-all duration-150 ease-out cursor-pointer
                        ${
                          isActive
                            ? "bg-gray-100 text-primary"
                            : "text-sidebar-foreground hover:bg-[#E6E7EB]"
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
      </nav>
    </>
  );

  // Mock chat history data
  const mockChatHistory = [
    { id: 1, title: "Protocol amendment review", time: "2h ago" },
    { id: 2, title: "Patient enrollment discussion", time: "Yesterday" },
    { id: 3, title: "Site visit planning", time: "2 days ago" },
  ];

  // Render chat history panel (Document AI Assistant only)
  const renderChatHistoryPanel = () => {
    if (!isDocumentAssistant || !trialIdFromQuery) return null;
    
    const trial = trials.find(t => t.id === trialIdFromQuery);
    if (!trial) return null;

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
        {!isCollapsed && (
          <div className="px-4 pb-4">
            <div className="pl-3">
              <div className="flex items-center gap-3">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: trial.color }}
                />
                <div className="font-semibold text-sidebar-foreground truncate">
                  {trial.name}
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
                <h3 className="text-xs font-semibold tracking-wider text-muted-foreground mb-2">
                  CHAT HISTORY
                </h3>
                <div className="space-y-2">
                  {mockChatHistory.map((chat) => (
                    <div
                      key={chat.id}
                      className="flex items-start gap-3 py-2 pr-2 pl-3 rounded-md cursor-pointer hover:bg-[#E6E7EB] transition-colors"
                      onClick={() => toast.info("Chat history feature coming soon")}
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
                    </div>
                  ))}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs text-primary"
                    onClick={() => toast.info("View all chats feature coming soon")}
                  >
                    View all chats →
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <aside className={`fixed left-0 top-11 h-[calc(100vh-44px)] bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ${
      isCollapsed ? "w-[64px]" : "w-[280px]"
    }`}>


      {/* Dynamic Content Based on Route */}
      <div className="flex-1 flex flex-col min-h-0 transition-opacity duration-500 ease-in-out">
        {(!isDocumentAssistant || !trialIdFromQuery) && (
          <div className="flex-1 flex flex-col min-h-0 animate-in fade-in slide-in-from-left-4 duration-500">
            {renderMainMenu()}
          </div>
        )}
        {isDocumentAssistant && trialIdFromQuery && (
          <div className="flex-1 flex flex-col min-h-0 animate-in fade-in slide-in-from-right-4 duration-500">
            {renderChatHistoryPanel()}
          </div>
        )}
      </div>

      {/* Logo Footer - Fixed at bottom */}
      <div className={`border-t border-sidebar-border p-4 flex-shrink-0 flex items-center ${
        isCollapsed ? "justify-center" : "justify-start"
      }`}>
        {!isCollapsed && (
          <img 
            src="/images/themison-logo.svg" 
            alt="Themison" 
            className="h-3 w-auto"
          />
        )}
        {isCollapsed && (
          <div className="text-primary font-bold text-lg">T</div>
        )}
      </div>

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
