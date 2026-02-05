/**
 * Dashboard Layout Component
 * Design: Clinical Modernism - Asymmetric sidebar-dominant layout
 * Features: Persistent sidebar with content area using 8px grid system
 */

import { LucideIcon } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";
import { Breadcrumb, BreadcrumbItem } from "./Breadcrumb";
import { useSidebarNav } from "@/contexts/SidebarNavContext";

interface DashboardLayoutProps {
  children: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  breadcrumbIcon?: LucideIcon;
}

export function DashboardLayout({ children, breadcrumbs, breadcrumbIcon }: DashboardLayoutProps) {
  const { isCollapsed } = useSidebarNav();
  
  return (
    <div className="min-h-screen bg-background">
      {/* Fixed Top Bar - Always visible */}
      <TopNav />
      
      {/* Sidebar and Content Below Top Bar */}
      <div className="flex pt-12">
        {/* Collapsible Sidebar */}
        <Sidebar />
        
        {/* Main Content Area */}
        <main className={`h-[calc(100vh-48px)] overflow-auto bg-[#F9FAFB] flex-1 transition-all duration-300 ${
          isCollapsed ? "ml-[64px]" : "ml-[280px]"
        }`}>
          {children}
        </main>
      </div>
    </div>
  );
}
