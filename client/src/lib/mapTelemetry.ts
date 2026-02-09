import type { TelemetryEventType } from "@/types/map";
import { mapApi } from "./mapClient";

export async function trackMapEvent(
  mapId: string,
  trialId: string,
  eventType: TelemetryEventType,
  options?: {
    targetId?: string;
    targetType?: "task" | "phase" | "dependency" | "map";
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await mapApi.logTelemetry({
      mapId,
      trialId,
      eventType,
      targetId: options?.targetId,
      targetType: options?.targetType,
      payload: options?.payload ?? {},
    });
  } catch (error) {
    // Never block user interactions because telemetry failed.
    console.error("[map.telemetry] capture failed", error);
  }
}

export const mapTelemetry = {
  taskAccepted: (mapId: string, trialId: string, taskId: string, aiConfidence?: number) =>
    trackMapEvent(mapId, trialId, "task.accepted", {
      targetId: taskId,
      targetType: "task",
      payload: { aiConfidence: aiConfidence ?? null },
    }),

  taskRejected: (mapId: string, trialId: string, taskId: string, reason: string) =>
    trackMapEvent(mapId, trialId, "task.rejected", {
      targetId: taskId,
      targetType: "task",
      payload: { reason },
    }),

  taskModified: (
    mapId: string,
    trialId: string,
    taskId: string,
    fieldsChanged: string[],
    oldValues: Record<string, unknown>
  ) =>
    trackMapEvent(mapId, trialId, "task.modified", {
      targetId: taskId,
      targetType: "task",
      payload: { fieldsChanged, oldValues },
    }),

  statusChanged: (mapId: string, trialId: string, taskId: string, fromStatus: string, toStatus: string) =>
    trackMapEvent(mapId, trialId, "kanban.card_moved", {
      targetId: taskId,
      targetType: "task",
      payload: { fromStatus, toStatus },
    }),

  viewSwitched: (mapId: string, trialId: string, fromView: string, toView: string, timeInViewMs: number) =>
    trackMapEvent(mapId, trialId, "view.switched", {
      targetType: "map",
      payload: { fromView, toView, timeInViewMs },
    }),

  mapLaunched: (
    mapId: string,
    trialId: string,
    stats: { totalTasks: number; acceptedPct: number; modifiedPct: number; timeInWizardMs: number }
  ) =>
    trackMapEvent(mapId, trialId, "map.launched", {
      targetId: mapId,
      targetType: "map",
      payload: stats,
    }),
};
