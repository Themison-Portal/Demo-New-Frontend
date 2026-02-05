/**
 * Integrations Page
 * Design: Clinical Modernism
 */

import { Puzzle } from "lucide-react";

export default function Integrations() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Puzzle className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Integrations
        </h1>
      </div>
      <p className="text-muted-foreground">
        Connect Themison with your existing clinical trial systems and tools.
      </p>
    </div>
  );
}
