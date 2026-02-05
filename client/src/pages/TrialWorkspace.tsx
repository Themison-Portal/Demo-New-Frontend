/**
 * TrialWorkspace Page Component
 * Design: Clinical Modernism - Card-based trial overview with filters and status grouping
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { TrialCard } from "@/components/TrialCard";
import { trpc } from "@/lib/trpc";

export function TrialWorkspace() {
  const [locationFilter, setLocationFilter] = useState<"all" | "copenhagen">("all");
  const [showAssignedToMe, setShowAssignedToMe] = useState(true);
  const [showPaused, setShowPaused] = useState(true);

  // Fetch trials from database
  const { data: trials = [], isLoading } = trpc.trials.list.useQuery();

  // Group trials by status
  const assignedTrials = trials.filter(t => 
    ["active", "recruiting"].includes(t.status)
  );
  const pausedTrials = trials.filter(t => t.status === "on-hold");

  const handleCreateTrial = () => {
    toast.info("Create New Trial feature coming soon");
  };

  return (
    <div className="flex-1 bg-background">
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Trial Workspace</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                KS
              </div>
              Assigned to me
              <ChevronDown className="w-4 h-4" />
            </Button>
            <Button onClick={handleCreateTrial} variant="outline" size="sm" className="gap-2">
              <Plus className="w-4 h-4" />
              Create New Trial
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="inline-flex items-center bg-gray-200 rounded-lg p-0.5" style={{backgroundColor: '#f0f0f0'}}>
            <button
              onClick={() => setLocationFilter("all")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                locationFilter === "all"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-gray-600 hover:text-foreground"
              }`}
            >
              All Locations
            </button>
            <button
              onClick={() => setLocationFilter("copenhagen")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                locationFilter === "copenhagen"
                  ? "bg-white text-foreground shadow-sm"
                  : "text-gray-600 hover:text-foreground"
              }`}
            >
              Copenhagen
            </button>
          </div>
        </div>

        {/* Trial Cards Grid */}
        <div className="space-y-8">
          {/* Assigned to me section */}
          {assignedTrials.length > 0 && (
            <div>
              <button
                onClick={() => setShowAssignedToMe(!showAssignedToMe)}
                className="flex items-center gap-2 mb-4 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showAssignedToMe ? "" : "-rotate-90"
                  }`}
                />
                Assigned to me
              </button>

              {showAssignedToMe && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {assignedTrials.map((trial) => (
                    <TrialCard key={trial.id} trial={trial} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Paused section */}
          {pausedTrials.length > 0 && (
            <div>
              <button
                onClick={() => setShowPaused(!showPaused)}
                className="flex items-center gap-2 mb-4 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    showPaused ? "" : "-rotate-90"
                  }`}
                />
                Paused
              </button>

              {showPaused && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pausedTrials.map((trial) => (
                    <TrialCard key={trial.id} trial={trial} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {trials.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
                <Plus className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">No trials yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Get started by creating your first trial
              </p>
              <Button onClick={handleCreateTrial} className="gap-2">
                <Plus className="w-4 h-4" />
                Create New Trial
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
