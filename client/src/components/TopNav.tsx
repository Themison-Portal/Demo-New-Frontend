/**
 * TopNav Component
 * Design: Clinical Modernism - Clean horizontal bar with contextual navigation
 */

import { Bell, ChevronDown, ChevronRight, Home, FileText, File, FlaskConical, LayoutGrid, Users, Building2, Puzzle, Settings as SettingsIcon, User, Brain, Sun, Moon } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { AnalyticsIcon } from "@/components/icons/AnalyticsIcon";
import { BudgetIntelligenceIcon } from "@/components/icons/BudgetIntelligenceIcon";
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
import { useSidebarNav } from "@/contexts/SidebarNavContext";
import { useDemoState } from "@/contexts/DemoStateContext";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { ensureTrialTeamAssignments } from "@/lib/trialTeamAssignments";
import { clearChatSessionsByMode } from "@/lib/chatSessions";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganizationProfile } from "@/hooks/useOrganizationProfile";
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
import { Check } from "lucide-react";

const MODE_SESSION_BOOTSTRAP_KEY_PREFIX = "themison-mode-session-bootstrapped:";

function hasModeSessionBootstrap(mode: "sample" | "full" | "building") {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(`${MODE_SESSION_BOOTSTRAP_KEY_PREFIX}${mode}`) === "1";
  } catch {
    return false;
  }
}

function markModeSessionBootstrap(mode: "sample" | "full" | "building") {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${MODE_SESSION_BOOTSTRAP_KEY_PREFIX}${mode}`, "1");
  } catch {
    // ignore
  }
}

export function TopNav() {
  const [location, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { navState, isCollapsed, setIsCollapsed } = useSidebarNav();
  const {
    state,
    resetDemo,
    loadSampleData,
    loadFullDataset,
    restoreModeFromDefaultLocal,
    saveCurrentModeAsDefault,
    fullResetLocal,
    setBuildingMode,
    getCurrentDataMode,
  } = useDemoState();
  const { profile } = useOrganizationProfile();
  const currentDataMode = getCurrentDataMode();
  const utils = trpc.useUtils();
  const modeBootstrapInFlightRef = useRef<Record<"sample" | "full" | "building", boolean>>({
    sample: false,
    full: false,
    building: false,
  });

  const runtimeUser = useMemo(() => {
    if (typeof window === "undefined") {
      return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
    }
    try {
      const raw = window.localStorage.getItem("manus-runtime-user-info");
      if (!raw) return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
      const parsed = JSON.parse(raw) as { name?: unknown; email?: unknown };
      return {
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Kaleb Sanders",
        email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : "kaleb.s@azorg.be",
      };
    } catch {
      return { name: "Kaleb Sanders", email: "kaleb.s@azorg.be" };
    }
  }, []);

  const currentMember = useMemo(() => {
    const normalizedRuntimeEmail = runtimeUser.email.toLowerCase();
    const normalizedRuntimeName = runtimeUser.name.toLowerCase();
    const matchedByEmail = state.teamMembers.find(
      (member) => member.email.toLowerCase() === normalizedRuntimeEmail
    );
    if (matchedByEmail) return matchedByEmail;
    const matchedByName = state.teamMembers.find(
      (member) => member.name.toLowerCase() === normalizedRuntimeName
    );
    return matchedByName ?? state.teamMembers[0] ?? null;
  }, [runtimeUser.email, runtimeUser.name, state.teamMembers]);

  const displayName = currentMember?.name || runtimeUser.name;
  const displayEmail = currentMember?.email || runtimeUser.email;
  const displayAvatar = currentMember?.avatar || "";
  
  // Fetch trials from database for breadcrumb display
  const { data: trials = [], isLoading: trialsLoading } = trpc.trials.list.useQuery({
    demoMode: currentDataMode,
  });

  useEffect(() => {
    if (currentDataMode !== "sample") return;
    if (!Array.isArray(trials) || trials.length === 0) return;
    if (!Array.isArray(state.teamMembers) || state.teamMembers.length === 0) return;

    ensureTrialTeamAssignments({
      mode: "sample",
      trials: trials.map((trial) => ({
        id: String(trial?.id || ""),
        location: typeof trial?.location === "string" ? trial.location : null,
      })),
      members: state.teamMembers,
    });
  }, [currentDataMode, state.teamMembers, trials]);

  const resetToEmptyMutation = trpc.demo.resetToEmpty.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate();
      await utils.documents.list.invalidate();
    },
  });

  const loadSampleMutation = trpc.demo.loadSampleData.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate();
      await utils.documents.list.invalidate();
    },
  });

  const loadFullMutation = trpc.demo.loadFullDataset.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate();
      await utils.documents.list.invalidate();
    },
  });
  const loadBuildingMutation = trpc.demo.loadBuildingMode.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate();
      await utils.documents.list.invalidate();
    },
  });
  const saveModeDefaultMutation = trpc.demo.saveModeDefault.useMutation();
  const fullResetMutation = trpc.demo.fullReset.useMutation({
    onSuccess: async () => {
      await utils.trials.list.invalidate();
      await utils.documents.list.invalidate();
    },
  });
  
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'reset' | 'sample' | 'full' | 'full-reset' | 'building' | null;
  }>({ open: false, type: null });

  useEffect(() => {
    toast.dismiss("demo-reset");
  }, [currentDataMode]);

  useEffect(() => {
    if (trialsLoading) return;
    if (hasModeSessionBootstrap(currentDataMode)) return;
    if (modeBootstrapInFlightRef.current[currentDataMode]) return;

    let cancelled = false;
    const targetMode = currentDataMode;
    modeBootstrapInFlightRef.current[targetMode] = true;

    const bootstrapModeFromSavedDefault = async () => {
      try {
        // Do not mutate DB on every browser session.
        // Only trigger mode load when selected mode has no trials yet.
        const modeHasTrials = trials.length > 0;
        if (!modeHasTrials) {
          if (targetMode === "sample") {
            await loadSampleMutation.mutateAsync();
          } else if (targetMode === "full") {
            await loadFullMutation.mutateAsync();
          } else {
            await loadBuildingMutation.mutateAsync();
          }
        }

        if (cancelled) return;
        restoreModeFromDefaultLocal(targetMode);
        if (targetMode === "building") {
          clearChatSessionsByMode({ dataMode: "building" });
        }
        markModeSessionBootstrap(targetMode);
      } catch (error) {
        console.error("Failed to bootstrap mode session", error);
      } finally {
        modeBootstrapInFlightRef.current[targetMode] = false;
      }
    };

    void bootstrapModeFromSavedDefault();

    return () => {
      cancelled = true;
    };
    // The mutation objects (loadBuildingMutation/loadFullMutation/loadSampleMutation)
    // are intentionally excluded from deps. tRPC's `useMutation` returns a new
    // wrapper object on every render, which would re-fire this effect, cancel
    // the in-flight bootstrap before markModeSessionBootstrap(...) runs, and
    // produce an infinite loop (the no-op `loadBuildingMode` path keeps
    // trials.length at 0, so the guard above never short-circuits). Reading
    // `.mutateAsync` through closure is safe because the underlying mutate
    // function reference is stable across re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDataMode, trials.length, trialsLoading, restoreModeFromDefaultLocal]);

  const handleConfirmAction = async () => {
    const needsLoading = confirmDialog.type !== 'building';
    try {
      if (needsLoading) {
        toast.loading("Updating demo data...", { id: "demo-reset" });
      }
      if (confirmDialog.type === 'reset') {
        await resetToEmptyMutation.mutateAsync();
        resetDemo();
        markModeSessionBootstrap("building");
        toast.success("Data reset to empty state");
      } else if (confirmDialog.type === 'sample') {
        await loadSampleMutation.mutateAsync();
        loadSampleData();
        markModeSessionBootstrap("sample");
        toast.success("Sample data loaded");
      } else if (confirmDialog.type === 'full') {
        await loadFullMutation.mutateAsync();
        loadFullDataset();
        markModeSessionBootstrap("full");
        toast.success("Full dataset loaded");
      } else if (confirmDialog.type === 'full-reset') {
        await fullResetMutation.mutateAsync();
        fullResetLocal('sample');
        markModeSessionBootstrap("sample");
        toast.success("All demo modes reset to defaults");
      } else if (confirmDialog.type === 'building') {
        await loadBuildingMutation.mutateAsync();
        setBuildingMode();
        clearChatSessionsByMode({ dataMode: "building" });
        markModeSessionBootstrap("building");
        toast.success("Building mode enabled");
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

  // Get current organization context
  const getCurrentContext = () => {
    // Always show organization name, not trial
    return {
      type: 'organization' as const,
      name: String(profile.name || "").trim() || "Organization",
      id: 'org-1',
    };
  };

  // Get breadcrumb based on current location (returns section, page, and optional subpage)
  const getBreadcrumb = () => {
    if (location === '/') return { section: 'General', page: 'Home' };
    if (location.startsWith('/home2')) return { section: 'General', sectionHref: '/', page: 'Home 2', pageHref: '/home2' };
    if (location.startsWith('/home3')) return { section: 'General', sectionHref: '/', page: 'Home 3', pageHref: '/home3' };
    if (location.startsWith('/home4')) return { section: 'General', sectionHref: '/', page: 'Home 4', pageHref: '/home4' };
    if (location.startsWith('/trial/') && location.endsWith('/assistant')) {
      const trialId = location.split('/')[2]?.toLowerCase();
      const trial = trials.find(t => t.id === trialId);
      const trialName = trial ? (trial.investigationalProduct || trial.title) : 'Trial';
      return {
        section: 'Workspace',
        sectionHref: '/',
        page: trialName,
        pageHref: `/trial/${trialId}`,
        subpage: 'Themison AI',
      };
    }
    if (location.startsWith('/trial/')) {
      // Extract trial ID from URL and normalize to lowercase
      const trialId = location.split('/')[2]?.toLowerCase();
      // Find the trial name from the trials list (database uses 'title' not 'name')
      const trial = trials.find(t => t.id === trialId);
      const trialName = trial ? (trial.investigationalProduct || trial.title) : 'Trial Details';
      return {
        section: 'Trial Workspace',
        sectionHref: '/trial-workspace',
        page: trialName,
        pageHref: `/trial/${trialId}`,
        subpage: 'Overview',
      };
    }
    if (location.startsWith('/workspace')) return { section: 'Workspace', sectionHref: '/', page: 'Trial Workspace', pageHref: '/trial-workspace' };
    if (location.startsWith('/trial-workspace')) return { section: 'Workspace', sectionHref: '/', page: 'Trial Workspace', pageHref: '/trial-workspace' };
    if (location.startsWith('/documents')) {
      const params = new URLSearchParams(window.location.search);
      const trialId = params.get('trialId');
      if (!trialId) {
        return { section: 'Workspace', sectionHref: '/', page: 'Themison AI', pageHref: '/documents' };
      }
      const trial = trials.find(t => t.id === trialId.toLowerCase());
      const trialLabel = trial ? (trial.investigationalProduct || trial.title) : `Trial ${trialId}`;
      return {
        section: 'Workspace',
        sectionHref: '/',
        page: trialLabel,
        pageHref: `/trial/${trialId.toLowerCase()}`,
        subpage: 'Themison AI',
      };
    }
    if (location.startsWith('/tasks')) return { section: 'Workspace', sectionHref: '/', page: 'Task Manager', pageHref: '/tasks' };
    if (location.startsWith('/collaboration')) return { section: 'Workspace', sectionHref: '/', page: 'Collaboration Hub', pageHref: '/collaboration' };
    if (location.startsWith('/budget-intelligence')) return { section: 'Workspace', sectionHref: '/', page: 'Budget Intelligence', pageHref: '/budget-intelligence' };
    if (location.startsWith('/analytics')) return { section: 'Workspace', sectionHref: '/', page: 'Analytics Dashboard', pageHref: '/analytics' };
    if (location.startsWith('/organization')) return { section: 'Team & Admin', sectionHref: '/', page: 'Organization', pageHref: '/organization' };
    if (location.startsWith('/integrations')) return { section: 'Team & Admin', sectionHref: '/', page: 'Integrations', pageHref: '/integrations' };
    if (location.startsWith('/notifications')) return { section: 'Team & Admin', sectionHref: '/', page: 'Notifications', pageHref: '/notifications' };
    if (location.startsWith('/settings')) return { section: 'Configuration', sectionHref: '/', page: 'Settings', pageHref: '/settings' };
    return { section: 'General', page: 'Main' };
  };

  // Get breadcrumb icon based on current location
  const getBreadcrumbIcon = () => {
    if (location === '/') return Home;
    if (location.startsWith('/home2')) return Home;
    if (location.startsWith('/home3')) return Home;
    if (location.startsWith('/home4')) return Home;
    if (location.startsWith('/trial/') && location.endsWith('/assistant')) return Brain;
    if (location.startsWith('/trial/')) return FlaskConical;
    if (location.startsWith('/workspace')) return FlaskConical;
    if (location.startsWith('/trial-workspace')) return FlaskConical;
    if (location.startsWith('/documents')) return Brain;
    if (location.startsWith('/tasks')) return LayoutGrid;
    if (location.startsWith('/collaboration')) return Users;
    if (location.startsWith('/budget-intelligence')) return BudgetIntelligenceIcon;
    if (location.startsWith('/analytics')) return AnalyticsIcon;
    if (location.startsWith('/organization')) return Building2;
    if (location.startsWith('/integrations')) return Puzzle;
    if (location.startsWith('/notifications')) return Bell;
    if (location.startsWith('/settings')) return SettingsIcon;
    return Home;
  };

  const breadcrumb = getBreadcrumb();
  const sidebarOffset = isCollapsed ? 64 : 280;

  return (
    <>
      <header className="h-11 mt-2 bg-transparent border-none flex items-center justify-between pr-4 gap-4 w-full">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs pl-8">
          <div className="flex items-center justify-center w-8 h-8 rounded-[7px] bg-primary/10">
            {(() => {
              const IconComponent = getBreadcrumbIcon();
              return <IconComponent className="h-4 w-4 text-primary" />;
            })()}
          </div>
          {breadcrumb.sectionHref ? (
            <Link href={breadcrumb.sectionHref}>
              <span className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                {breadcrumb.section}
              </span>
            </Link>
          ) : (
            <span className="text-muted-foreground">{breadcrumb.section}</span>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          {breadcrumb.pageHref ? (
            <Link href={breadcrumb.pageHref}>
              <span className="font-medium text-foreground hover:text-foreground/80 transition-colors cursor-pointer">
                {breadcrumb.page}
              </span>
            </Link>
          ) : (
            <span className="font-medium text-foreground">{breadcrumb.page}</span>
          )}
          {breadcrumb.subpage && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium text-foreground">{breadcrumb.subpage}</span>
            </>
          )}
        </div>

        {/* Right: Notifications + User Profile */}
        <div className="flex items-center gap-2">
          {/* Theme Toggle */}
          {toggleTheme && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={toggleTheme}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            >
              {theme === "light" ? (
                <Moon className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Sun className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              )}
            </Button>
          )}

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </Button>

          {/* User Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
                <Avatar className="h-7 w-7 rounded-md">
                  <AvatarImage src={displayAvatar} alt={displayName} className="rounded-md object-cover" />
                  <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-xs" style={{backgroundColor: '#e6e7eb'}}>
                    <User className="h-4 w-4 text-gray-600" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium hidden md:inline">{displayName}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="font-medium">{displayName}</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {displayEmail}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => toast.info("Profile feature coming soon")}>
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info("Settings feature coming soon")}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span>Demo Controls</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem 
                    onClick={() => setConfirmDialog({ open: true, type: 'sample' })}
                    className="flex items-center justify-between"
                  >
                    <span>Load Sample Data</span>
                    {currentDataMode === 'sample' && <Check className="h-4 w-4 ml-4" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setConfirmDialog({ open: true, type: 'full' })}
                    className="flex items-center justify-between"
                  >
                    <span>Load Full Dataset</span>
                    {currentDataMode === 'full' && <Check className="h-4 w-4 ml-4" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="flex items-center justify-between"
                    onClick={() => setConfirmDialog({ open: true, type: 'building' })}
                  >
                    <span>Building Mode</span>
                    {currentDataMode === 'building' && <Check className="h-4 w-4 ml-4" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={async () => {
                      toast.loading("Saving mode default...", { id: "save-mode-default" });
                      try {
                        await saveModeDefaultMutation.mutateAsync({ mode: currentDataMode });
                        saveCurrentModeAsDefault();
                        toast.success(`Saved ${currentDataMode} mode as default`, { id: "save-mode-default" });
                      } catch (error) {
                        console.error(error);
                        toast.error("Failed to save mode default", { id: "save-mode-default" });
                      }
                    }}
                  >
                    Save Current Mode as Default
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setConfirmDialog({ open: true, type: 'reset' })}
                    className="flex items-center justify-between"
                  >
                    <span>Reset to Empty</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setConfirmDialog({ open: true, type: 'full-reset' })}
                    className="flex items-center justify-between"
                  >
                    <span>Full Reset</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => toast.info("Sign out feature coming soon")}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Confirmation Dialogs */}
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ open, type: null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.type === 'reset' && 'Reset to Empty?'}
              {confirmDialog.type === 'sample' && 'Load Sample Data?'}
              {confirmDialog.type === 'full' && 'Load Full Dataset?'}
              {confirmDialog.type === 'full-reset' && 'Full Reset?'}
              {confirmDialog.type === 'building' && 'Switch to Building Mode?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.type === 'reset' && 
                'This will delete all trials, documents, tasks, and activity in building mode. This action cannot be undone.'}
              {confirmDialog.type === 'sample' && 
                'Switch to Sample mode. On first open in a new browser session, Sample starts from its saved default.'}
              {confirmDialog.type === 'full' && 
                'Switch to Full mode. On first open in a new browser session, Full starts from its saved default.'}
              {confirmDialog.type === 'full-reset' && 
                'This will reset all demo modes (sample, full, and building) back to their saved defaults.'}
              {confirmDialog.type === 'building' &&
                'Switch to Building mode. On first open in a new browser session, Building starts from its saved default.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>
              {confirmDialog.type === 'reset' || confirmDialog.type === 'full-reset'
                ? 'Reset'
                : confirmDialog.type === 'building'
                ? 'Switch'
                : 'Load Data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
