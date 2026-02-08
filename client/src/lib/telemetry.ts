type TelemetryEventInput = {
  eventType: string;
  action: string;
  sessionId?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown> | unknown;
  durationMs?: number;
  aiInvolved?: boolean;
  aiOutput?: string;
  aiSources?: unknown;
  userCorrection?: string;
};

const SESSION_KEY = "themison_session_id";

function generateSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId() {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = generateSessionId();
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return generateSessionId();
  }
}

export function logEvent(input: TelemetryEventInput) {
  const sessionId = input.sessionId ?? getSessionId();
  const payload = {
    ...input,
    sessionId,
  };

  // fire-and-forget
  try {
    void fetch("/api/trpc/telemetry.logEvent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ json: payload }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
