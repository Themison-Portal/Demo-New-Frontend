import { useEffect } from "react";
import { CollaborationHub } from "@/components/collaboration/CollaborationHub";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";
import { logEvent } from "@/lib/telemetry";

export default function Collaboration() {
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });

  const trialIdFromQuery =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("trialId")
      : null;
  const fallbackTrialIdByMode: Record<"sample" | "full" | "building", string> = {
    sample: "sample-workspace",
    full: "full-workspace",
    building: "building-workspace",
  };
  const trialId =
    currentDataMode === "building"
      ? fallbackTrialIdByMode.building
      : trialIdFromQuery || trials[0]?.id || fallbackTrialIdByMode[currentDataMode];

  useEffect(() => {
    logEvent({
      eventType: "feature_used",
      action: "open_collaboration_context",
      entityType: "trial",
      entityId: trialId,
      payload: {
        demoMode: currentDataMode,
        source:
          currentDataMode === "building"
            ? "building_workspace_pinned"
            : trialIdFromQuery
          ? "query_param"
          : trials[0]?.id
            ? "default_first_trial"
            : `${currentDataMode}_workspace_fallback`,
      },
    });
  }, [currentDataMode, trialId, trialIdFromQuery, trials]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-8 pb-1 pt-4">
      <div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">Collaboration Hub</h1>
        <p className="text-sm text-muted-foreground">
          Unified coordination layer for inbox, direct messages, and threads with Themison AI in context.
        </p>
      </div>

      <div className="min-h-0 flex-1">
        <CollaborationHub trialId={trialId} dataMode={currentDataMode} />
      </div>
    </div>
  );
}
