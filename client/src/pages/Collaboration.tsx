import { CollaborationHub } from "@/components/collaboration/CollaborationHub";
import { trpc } from "@/lib/trpc";
import { useDemoState } from "@/contexts/DemoStateContext";

export default function Collaboration() {
  const { getCurrentDataMode } = useDemoState();
  const currentDataMode = getCurrentDataMode();
  const { data: trials = [] } = trpc.trials.list.useQuery({ demoMode: currentDataMode });

  const trialIdFromQuery =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("trialId")
      : null;
  const trialId = trialIdFromQuery || trials[0]?.id || "";

  return (
    <div className="flex h-[calc(100vh-72px)] flex-col gap-4 overflow-hidden px-8 pb-4 pt-4">
      <div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">Collaboration Hub</h1>
        <p className="text-sm text-muted-foreground">
          Unified coordination layer for inbox, direct messages, and threads with Themison AI in context.
        </p>
      </div>

      {trialId ? (
        <div className="min-h-0 flex-1">
          <CollaborationHub trialId={trialId} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background p-6 text-sm text-muted-foreground">
          No trial found. Create a trial first to open Collaboration Hub.
        </div>
      )}
    </div>
  );
}
