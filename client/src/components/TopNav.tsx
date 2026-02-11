/**
 * TopNav Component
 * Design: Clinical Modernism - Clean horizontal bar with contextual navigation
 */

import { Bell, ChevronDown, ChevronRight, Home, FileText, File, FlaskConical, LayoutGrid, Users, Building2, Puzzle, Settings as SettingsIcon, User, Brain } from "lucide-react";
import { AnalyticsIcon } from "@/components/icons/AnalyticsIcon";
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
import { toast } from "sonner";
import { useEffect, useState } from "react";
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

export function TopNav() {
  const [location, navigate] = useLocation();
  const { navState, isCollapsed, setIsCollapsed } = useSidebarNav();
  const { state, resetDemo, loadSampleData, loadFullDataset, fullResetLocal, setBuildingMode, getCurrentDataMode } = useDemoState();
  const { profile } = useOrganizationProfile();
  const currentDataMode = getCurrentDataMode();
  const utils = trpc.useUtils();
  
  // Fetch trials from database for breadcrumb display
  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });

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
      } else if (confirmDialog.type === 'sample') {
        await loadSampleMutation.mutateAsync();
        loadSampleData();
        toast.success("Sample data loaded");
      } else if (confirmDialog.type === 'full') {
        await loadFullMutation.mutateAsync();
        loadFullDataset();
        toast.success("Full dataset loaded");
      } else if (confirmDialog.type === 'full-reset') {
        await fullResetMutation.mutateAsync();
        fullResetLocal('building');
        toast.success("All demo modes reset to defaults");
      } else if (confirmDialog.type === 'building') {
        setBuildingMode();
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
    if (location === '/') return { section: 'General', page: 'Dashboard' };
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
    if (location.startsWith('/analytics')) return { section: 'Workspace', sectionHref: '/', page: 'Analytics', pageHref: '/analytics' };
    if (location.startsWith('/organization')) return { section: 'Team & Admin', sectionHref: '/', page: 'Organization', pageHref: '/organization' };
    if (location.startsWith('/integrations')) return { section: 'Team & Admin', sectionHref: '/', page: 'Integrations', pageHref: '/integrations' };
    if (location.startsWith('/notifications')) return { section: 'Team & Admin', sectionHref: '/', page: 'Notifications', pageHref: '/notifications' };
    if (location.startsWith('/settings')) return { section: 'Configuration', sectionHref: '/', page: 'Settings', pageHref: '/settings' };
    return { section: 'General', page: 'Main' };
  };

  // Get breadcrumb icon based on current location
  const getBreadcrumbIcon = () => {
    if (location === '/') return Home;
    if (location.startsWith('/trial/') && location.endsWith('/assistant')) return Brain;
    if (location.startsWith('/trial/')) return FlaskConical;
    if (location.startsWith('/workspace')) return FlaskConical;
    if (location.startsWith('/trial-workspace')) return FlaskConical;
    if (location.startsWith('/documents')) return Brain;
    if (location.startsWith('/tasks')) return LayoutGrid;
    if (location.startsWith('/collaboration')) return Users;
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
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
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
          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
          </Button>

          {/* User Profile Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 h-9 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src="" alt="Kaleb Sanders" />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs" style={{backgroundColor: '#e6e7eb'}}>
                    <User className="h-4 w-4 text-gray-600" />
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium hidden md:inline">Kaleb Sanders</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="font-medium">Kaleb Sanders</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    kaleb.s@themison.com
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
                'Switch to the Sample dataset. Your work in other modes is preserved and can be resumed later. Only Full Reset or Reset to Empty will wipe data.'}
              {confirmDialog.type === 'full' && 
                'Switch to the Full dataset. Your work in other modes is preserved and can be resumed later. Only Full Reset or Reset to Empty will wipe data.'}
              {confirmDialog.type === 'full-reset' && 
                'This will reset all demo modes (sample, full, and building) back to their original default states.'}
              {confirmDialog.type === 'building' &&
                'Switch to Building Mode. Your building-mode data is preserved unless you choose Reset to Empty.'}
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
