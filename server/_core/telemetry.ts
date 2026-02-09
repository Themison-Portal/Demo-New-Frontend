import { aiTrainingExamples, telemetryEvents } from "../../drizzle/schema";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readString(payload: unknown, keys: string[]) {
  if (!isRecord(payload)) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function inferTrialId(input: TelemetryEventInput) {
  if (input.entityType === "trial" && input.entityId) {
    return input.entityId;
  }
  const fromPayload = readString(input.payload, ["trialId", "trial_id"]);
  if (fromPayload) return fromPayload;
  return null;
}

function inferTrainingLabel(input: TelemetryEventInput): "accepted" | "rejected" | "edited" | "unknown" {
  const eventType = String(input.eventType || "").toLowerCase();
  const action = String(input.action || "").toLowerCase();
  const correction = String(input.userCorrection || "").trim();

  if (correction.length > 0) return "edited";
  if (eventType.includes("accept") || action.includes("accept")) return "accepted";
  if (
    eventType.includes("reject") ||
    action.includes("reject") ||
    eventType.includes("dismiss") ||
    action.includes("dismiss")
  ) {
    return "rejected";
  }
  return "unknown";
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

    // Build supervised examples from AI interactions for future training pipelines.
    const shouldCaptureTrainingExample =
      input.aiInvolved === true ||
      Boolean(input.aiOutput) ||
      Boolean(input.userCorrection) ||
      /ai|suggestion|assistant/i.test(String(input.eventType || ""));

    if (shouldCaptureTrainingExample) {
      const label = inferTrainingLabel(input);
      const prompt =
        readString(input.payload, ["query", "prompt", "aiQuery", "question", "message"]) ?? null;
      const response =
        input.aiOutput ??
        readString(input.payload, ["response", "aiResponse", "answer", "suggestion"]) ??
        null;
      const trialId = inferTrialId(input);

      await db.insert(aiTrainingExamples).values({
        sourceEventId: id,
        trialId,
        userId: input.userId ?? null,
        prompt,
        response,
        label,
        correction: input.userCorrection ?? null,
        metadata: isRecord(input.payload) ? input.payload : null,
        createdAt: new Date(),
      });
    }
  } catch (error) {
    // Fail silently by design.
    console.warn("[Telemetry] Failed to log event", error);
  }
}
