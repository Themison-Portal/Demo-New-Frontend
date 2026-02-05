import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SidebarProvider } from "./contexts/SidebarContext";
import { DemoStateProvider } from "./contexts/DemoStateContext";
import { SidebarNavProvider } from "./contexts/SidebarNavContext";
import { DashboardLayout } from "./components/DashboardLayout";
import { BreadcrumbItem } from "./components/Breadcrumb";
import { Home, FileText, LayoutGrid, Bell, Building, Settings as SettingsIcon, Puzzle, LucideIcon } from "lucide-react";
import { MessageChatSquare } from "./components/icons/MessageChatSquare";
import { TrialElements } from "./components/icons/TrialElements";
import Overview from "./pages/Overview";
import { TrialWorkspace } from "./pages/TrialWorkspace";
import TrialDetail from "./pages/TrialDetail";
import DocumentAIAssistant from "./pages/DocumentAIAssistant";
import Tasks from "./pages/Tasks";
import Collaboration from "./pages/Collaboration";
import Organization from "./pages/Organization";
import Integrations from "./pages/Integrations";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";

// Icon mapping for each route - matches sidebar navigation icons exactly
const iconMap: Record<string, any> = {
  "/": Home,
  "/workspace": TrialElements,
  "/trial-workspace": TrialElements,
  "/documents": FileText,
  "/tasks": LayoutGrid,
  "/collaboration": MessageChatSquare,
  "/organization": Building,
  "/integrations": Puzzle,
  "/notifications": Bell,
  "/settings": SettingsIcon,
};

// Breadcrumb configuration for each route
const breadcrumbsMap: Record<string, BreadcrumbItem[]> = {
  "/": [
    { label: "Dashboard" },
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
};

function Router() {
  const [location] = useLocation();
  
  // Handle dynamic breadcrumbs for trial detail pages
  let breadcrumbs = breadcrumbsMap[location] || [];
  let breadcrumbIcon = iconMap[location];
  
  // Check if we're on a trial detail page
  if (location.startsWith('/trial/')) {
    if (location.endsWith('/assistant')) {
      const trialId = location.split('/')[2];
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
        <Route path="/" component={Overview} />
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
