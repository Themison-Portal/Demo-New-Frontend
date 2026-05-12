import { useEffect, useRef } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import AuthCallback from "@/pages/AuthCallback";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthBanner } from "./auth/AuthBanner";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SidebarProvider } from "./contexts/SidebarContext";
import { DemoStateProvider } from "./contexts/DemoStateContext";
import { SidebarNavProvider } from "./contexts/SidebarNavContext";
import { DashboardLayout } from "./components/DashboardLayout";
import { BreadcrumbItem } from "./components/Breadcrumb";
import { Home, FileText, LayoutGrid, Bell, Building, Settings as SettingsIcon, Puzzle, LucideIcon } from "lucide-react";
import { MessageChatSquare } from "./components/icons/MessageChatSquare";
import { TrialElements } from "./components/icons/TrialElements";
import { AnalyticsIcon } from "./components/icons/AnalyticsIcon";
import { BudgetIntelligenceIcon } from "./components/icons/BudgetIntelligenceIcon";
import Overview from "./pages/Overview";
import Home2 from "./pages/Home2";
import Home3 from "./pages/Home3";
import Home4 from "./pages/Home4";
import { TrialWorkspace } from "./pages/TrialWorkspace";
import TrialDetail from "./pages/TrialDetail";
import DocumentAIAssistant from "./pages/DocumentAIAssistant";
import Tasks from "./pages/Tasks";
import Collaboration from "./pages/Collaboration";
import Analytics from "./pages/Analytics";
import Analytics2 from "./pages/Analytics2";
import AnalyticsHidden from "./pages/AnalyticsHidden";
import BudgetIntelligence from "./pages/BudgetIntelligence";
import Organization from "./pages/Organization";
import Integrations from "./pages/Integrations";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";
import { logEvent } from "./lib/telemetry";

// Icon mapping for each route - matches sidebar navigation icons exactly
const iconMap: Record<string, any> = {
  "/": Home,
  "/workspace": TrialElements,
  "/trial-workspace": TrialElements,
  "/documents": FileText,
  "/tasks": LayoutGrid,
  "/collaboration": MessageChatSquare,
  "/analytics": AnalyticsIcon,
  "/analytics2": AnalyticsIcon,
  "/analytics-hidden": AnalyticsIcon,
  "/budget-intelligence": BudgetIntelligenceIcon,
  "/organization": Building,
  "/integrations": Puzzle,
  "/notifications": Bell,
  "/settings": SettingsIcon,
  "/home2": Home,
  "/home3": Home,
  "/home4": Home,
};

// Breadcrumb configuration for each route
const breadcrumbsMap: Record<string, BreadcrumbItem[]> = {
  "/": [
    { label: "Home" },
  ],
  "/workspace": [
    { label: "Clinical Hub", href: "/" },
    { label: "Trial Workspace" },
  ],
  "/trial-workspace": [
    { label: "Clinical Hub", href: "/" },
    { label: "Trial Workspace" },
  ],
  "/documents": [
    { label: "Workspace", href: "/" },
    { label: "Document Assistant" },
  ],
  "/tasks": [
    { label: "Workspace", href: "/" },
    { label: "Task Manager" },
  ],
  "/collaboration": [
    { label: "Workspace", href: "/" },
    { label: "Collaboration Hub" },
  ],
  "/analytics": [
    { label: "Workspace", href: "/" },
    { label: "Analytics Dashboard" },
  ],
  "/analytics2": [
    { label: "Workspace", href: "/" },
    { label: "Analytics Dashboard 2" },
  ],
  "/analytics-hidden": [
    { label: "Workspace", href: "/" },
    { label: "Analytics Dashboard" },
  ],
  "/budget-intelligence": [
    { label: "Workspace", href: "/" },
    { label: "Budget Intelligence" },
  ],
  "/organization": [
    { label: "Team & Admin", href: "/" },
    { label: "Organization" },
  ],
  "/integrations": [
    { label: "Team & Admin", href: "/" },
    { label: "Integrations" },
  ],
  "/notifications": [
    { label: "Team & Admin", href: "/" },
    { label: "Notifications" },
  ],
  "/settings": [
    { label: "Configuration", href: "/" },
    { label: "Settings" },
  ],
  "/home2": [
    { label: "General", href: "/" },
    { label: "Home 2" },
  ],
  "/home3": [
    { label: "General", href: "/" },
    { label: "Home 3" },
  ],
  "/home4": [
    { label: "General", href: "/" },
    { label: "Home 4" },
  ],
};

function Router() {
  const [location] = useLocation();
  const lastLocationRef = useRef<string | null>(null);
  const lastTimestampRef = useRef<number>(Date.now());
  const locationPath = location.split("?")[0];

  useEffect(() => {
    const now = Date.now();
    const previousLocation = lastLocationRef.current;
    const durationMs = previousLocation ? now - lastTimestampRef.current : undefined;

    logEvent({
      eventType: "page_viewed",
      action: "viewed",
      entityType: "page",
      entityId: location,
      durationMs,
      payload: previousLocation ? { from: previousLocation } : undefined,
    });

    lastLocationRef.current = location;
    lastTimestampRef.current = now;
  }, [location]);

  const isEmbeddedTaskModal =
    locationPath === "/tasks" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embeddedTaskModal") === "1";

  if (isEmbeddedTaskModal) {
    return <Tasks />;
  }

  // Auth0 redirect callback — render outside the dashboard chrome so the
  // spinner is full-screen and the URL `?code=&state=` is processed cleanly
  // by Auth0Provider's useEffect before we navigate elsewhere.
  if (locationPath === "/auth/callback") {
    return <AuthCallback />;
  }

  // Handle dynamic breadcrumbs for trial detail pages
  let breadcrumbs = breadcrumbsMap[locationPath] || [];
  let breadcrumbIcon = iconMap[locationPath];
  
  // Check if we're on a trial detail page
  if (locationPath.startsWith('/trial/')) {
    if (locationPath.endsWith('/assistant')) {
      const trialId = locationPath.split('/')[2];
      breadcrumbs = [
        { label: "Workspace", href: "/" },
        { label: "Trial Workspace", href: "/trial-workspace" },
        { label: trialId ? `Trial ${trialId}` : "Trial" },
        { label: "Document AI Assistant" },
      ];
      breadcrumbIcon = FileText;
    } else {
    breadcrumbs = [
      { label: "Clinical Hub", href: "/" },
      { label: "Trial Workspace", href: "/trial-workspace" },
      { label: "Trial Details" },
    ];
    breadcrumbIcon = TrialElements;
    }
  }

  return (
    <DashboardLayout breadcrumbs={breadcrumbs} breadcrumbIcon={breadcrumbIcon}>
      <Switch>
        <Route path="/">
          {() => <Home4 />}
        </Route>
        <Route path="/home2" component={Home2} />
        <Route path="/home3" component={Home3} />
        <Route path="/home4" component={Overview} />
        <Route path="/workspace" component={TrialWorkspace} />
        <Route path="/trial-workspace" component={TrialWorkspace} />
        <Route path="/trial/:id/assistant">{(params) => (
          <DocumentAIAssistant trialId={params.id} />
        )}</Route>
        <Route path="/trial/:id" component={TrialDetail} />
        <Route path="/documents">{() => {
          // Extract trialId from query params
          const params = new URLSearchParams(window.location.search);
          const trialId = params.get('trialId') || undefined;
          return <DocumentAIAssistant trialId={trialId} />;
        }}</Route>
        <Route path="/tasks" component={Tasks} />
        <Route path="/collaboration" component={Collaboration} />
        <Route path="/analytics">{() => <Analytics />}</Route>
        <Route path="/analytics2">{() => <Analytics2 />}</Route>
        <Route path="/analytics-hidden">{() => <AnalyticsHidden />}</Route>
        <Route path="/budget-intelligence" component={BudgetIntelligence} />
        <Route path="/organization" component={Organization} />
        <Route path="/integrations" component={Integrations} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/settings" component={Settings} />
        <Route path="/404" component={NotFound} />
        {/* Final fallback route */}
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <SidebarProvider>
          <SidebarNavProvider>
            <DemoStateProvider>
              <TooltipProvider>
                <Toaster />
                {/*
                 * Minimum viable Auth0 login surface — fixed-position
                 * banner showing Sign in / Sign out + user email. Move
                 * into the Sidebar/Topbar in a follow-up when those
                 * components get touched.
                 */}
                <AuthBanner />
                <Router />
              </TooltipProvider>
            </DemoStateProvider>
          </SidebarNavProvider>
        </SidebarProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
