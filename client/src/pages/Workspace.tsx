/**
 * Trial Workspace Page
 * Design: Clinical Modernism
 */

import { FolderOpen } from "lucide-react";

export default function Workspace() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <FolderOpen className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Trial Workspace
        </h1>
      </div>
      <p className="text-muted-foreground">
        Manage your clinical trial workspaces and access trial-specific information.
      </p>
    </div>
  );
}
