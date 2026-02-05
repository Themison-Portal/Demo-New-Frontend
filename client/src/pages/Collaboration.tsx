/**
 * Collaboration Hub Page
 * Design: Clinical Modernism
 */

import { MessageSquare } from "lucide-react";

export default function Collaboration() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <MessageSquare className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Collaboration Hub
        </h1>
      </div>
      <p className="text-muted-foreground">
        Team communication and collaboration anchored to trial context and documents.
      </p>
    </div>
  );
}
