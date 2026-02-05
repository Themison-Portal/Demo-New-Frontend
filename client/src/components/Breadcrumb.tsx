/**
 * Breadcrumb Navigation Component
 * Design: Clinical Modernism - Clear navigation hierarchy
 * Features: Icon + breadcrumb trail with separators
 */

import { ChevronRight, Home, LucideIcon } from "lucide-react";
import { Link } from "wouter";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  icon?: LucideIcon;
}

export function Breadcrumb({ items, icon: Icon = Home }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-2 text-sm">
      {/* Icon */}
      <div className="flex items-center justify-center w-8 h-8 bg-blue-50 rounded-lg flex-shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      
      {/* Breadcrumb Trail */}
      <div className="flex items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          
          return (
            <div key={index} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href}>
                  <span className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                    {item.label}
                  </span>
                </Link>
              ) : (
                <span className={isLast ? "text-foreground font-medium" : "text-muted-foreground"}>
                  {item.label}
                </span>
              )}
              
              {!isLast && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
