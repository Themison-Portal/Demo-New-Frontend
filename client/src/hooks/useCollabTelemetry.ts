import { useCallback } from "react";
import { collabApi } from "@/lib/apiClient";
import type { CollaborationLayer } from "@/types/collaboration";

export function useCollabTelemetry(trialId?: string) {
    const track = useCallback(
        async (input: {
            layer: CollaborationLayer;
            eventType: string;
            eventData?: Record<string, unknown>;
            aiInvolved?: boolean;
            aiModel?: string;
            aiLatencyMs?: number;
            aiAccepted?: boolean;
        }) => {
            if (!trialId) return;
            await collabApi.logCollabEvent({
                trialId,
                layer: input.layer,
                eventType: input.eventType,
                eventData: input.eventData,
                aiInvolved: input.aiInvolved,
                aiModel: input.aiModel,
                aiLatencyMs: input.aiLatencyMs,
                aiAccepted: input.aiAccepted,
            });
        },
        [trialId]
    );

    return { track };
}
