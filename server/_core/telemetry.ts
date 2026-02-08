import { telemetryEvents } from "../../drizzle/schema";
import { getDb } from "../db";

export type TelemetryEventInput = {
  eventType: string;
  action: string;
  sessionId?: string;
  userId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: unknown;
  durationMs?: number | null;
  aiInvolved?: boolean;
  aiOutput?: string | null;
  aiSources?: unknown;
  userCorrection?: string | null;
  timestamp?: Date;
};

function fallbackId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getId() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return fallbackId();
}

export async function logTelemetryEvent(input: TelemetryEventInput) {
  const db = await getDb();
  if (!db) return;

  const id = getId();
  const timestamp = input.timestamp ?? new Date();
  const sessionId = input.sessionId ?? fallbackId();

  try {
    await db.insert(telemetryEvents).values({
      id,
      eventType: input.eventType,
      action: input.action,
      sessionId,
      userId: input.userId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? null,
      durationMs: input.durationMs ?? null,
      aiInvolved: input.aiInvolved ?? false,
      aiOutput: input.aiOutput ?? null,
      aiSources: input.aiSources ?? null,
      userCorrection: input.userCorrection ?? null,
      timestamp,
      createdAt: new Date(),
    });
  } catch (error) {
    // Fail silently by design.
    console.warn("[Telemetry] Failed to log event", error);
  }
}
