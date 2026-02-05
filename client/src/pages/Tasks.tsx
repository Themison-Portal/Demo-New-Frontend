/**
 * Task Manager Page
 * Design: Clinical Modernism
 */

import { CheckSquare } from "lucide-react";

export default function Tasks() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <CheckSquare className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Task Manager
        </h1>
      </div>
      <p className="text-muted-foreground">
        Organize, track, and coordinate trial execution tasks across your team.
      </p>
    </div>
  );
}
