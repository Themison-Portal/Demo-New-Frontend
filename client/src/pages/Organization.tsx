/**
 * Organization Page
 * Design: Clinical Modernism
 */

import { Building2 } from "lucide-react";

export default function Organization() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Building2 className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Organization
        </h1>
      </div>
      <p className="text-muted-foreground">
        Manage your organization settings, team members, and site information.
      </p>
    </div>
  );
}
