import { useEffect } from "react";
import { getCollaborationStore } from "@/stores/collaborationStore";

/**
 * Polling-based realtime updates.
 * Mirrors existing map realtime behavior until websocket/realtime channels are added.
 */
export function useRealtimeCollab(trialId?: string) {
  useEffect(() => {
    const store = getCollaborationStore();
    if (!trialId) return;

    store.subscribeToUpdates(trialId);
    return () => {
      store.unsubscribe();
    };
  }, [trialId]);
}
