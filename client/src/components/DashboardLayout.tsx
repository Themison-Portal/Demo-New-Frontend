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
    <div className="min-h-screen bg-white">
      {/* Sidebar and Content */}
      <div className="flex">
        {/* Collapsible Sidebar */}
        <Sidebar />
        
        {/* Main Content Area */}
        <main className={`relative z-20 h-screen bg-[#F7F8FB] flex-1 overflow-hidden transition-all duration-300 rounded-tl-2xl rounded-bl-2xl mr-0 border border-[#D6DCE5] border-r-0 shadow-[-4px_0_12px_rgba(15,23,42,0.05)] ${
          isCollapsed ? "ml-[64px]" : "ml-[280px]"
        }`}>
          <div className="px-0">
            <TopNav />
          </div>
          <div className="h-[calc(100vh-56px)] overflow-auto pb-2">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
