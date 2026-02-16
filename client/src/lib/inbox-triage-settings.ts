import type {
  InboxAILabel,
  InboxLabelSetting,
  InboxTriageSettings,
} from "@/types/collaboration";

const STORAGE_KEY = "themison-inbox-triage-settings-v1";

const LABEL_ORDER: InboxAILabel[] = [
  "urgent",
  "action_required",
  "lab_alert",
  "safety_report",
  "sponsor_query",
  "system_notification",
  "fyi",
  "protocol_clarification",
  "irb_correspondence",
  "enrollment_update",
  "administrative",
  "draft",
];

const LABEL_DEFAULTS: Record<
  InboxAILabel,
  { displayName: string; color: string; textColor: string; enabled: boolean }
> = {
  urgent: { displayName: "Urgent", color: "#DC2626", textColor: "#DC2626", enabled: true },
  action_required: {
    displayName: "Action Required",
    color: "#EA580C",
    textColor: "#EA580C",
    enabled: true,
  },
  lab_alert: { displayName: "Lab Alert", color: "#DC2626", textColor: "#DC2626", enabled: true },
  safety_report: {
    displayName: "Safety Report",
    color: "#DC2626",
    textColor: "#DC2626",
    enabled: true,
  },
  sponsor_query: {
    displayName: "Sponsor Query",
    color: "#7C3AED",
    textColor: "#7C3AED",
    enabled: true,
  },
  system_notification: {
    displayName: "System Notification",
    color: "#2563EB",
    textColor: "#2563EB",
    enabled: true,
  },
  fyi: { displayName: "FYI", color: "#6B7280", textColor: "#6B7280", enabled: true },
  protocol_clarification: {
    displayName: "Protocol Clarification",
    color: "#059669",
    textColor: "#059669",
    enabled: true,
  },
  irb_correspondence: {
    displayName: "IRB Correspondence",
    color: "#D97706",
    textColor: "#D97706",
    enabled: true,
  },
  enrollment_update: {
    displayName: "Enrollment Update",
    color: "#2563EB",
    textColor: "#2563EB",
    enabled: true,
  },
  administrative: {
    displayName: "Administrative",
    color: "#6B7280",
    textColor: "#6B7280",
    enabled: true,
  },
  draft: { displayName: "Draft", color: "#6B7280", textColor: "#6B7280", enabled: true },
};

function normalizeLabel(input: string): InboxAILabel | null {
  const normalized = String(input || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
  return (LABEL_ORDER as string[]).includes(normalized) ? (normalized as InboxAILabel) : null;
}

export function toInboxLabelText(label: string): string {
  const normalized = normalizeLabel(label);
  if (!normalized) {
    return label
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  return LABEL_DEFAULTS[normalized].displayName;
}

export function withHexAlpha(hex: string, alphaHex: string): string {
  const value = String(hex || "").trim();
  if (!value) return "";
  if (value.startsWith("#")) {
    const cleaned = value.slice(1);
    if (cleaned.length === 3) {
      const expanded = cleaned
        .split("")
        .map((char) => char + char)
        .join("");
      return `#${expanded}${alphaHex}`;
    }
    if (cleaned.length === 6) return `#${cleaned}${alphaHex}`;
    if (cleaned.length === 8) return `#${cleaned.slice(0, 6)}${alphaHex}`;
  }
  return value;
}

export function createDefaultInboxTriageSettings(): InboxTriageSettings {
  return {
    confidenceThreshold: 0.7,
    autoApplyConfidence: 0.7,
    labels: LABEL_ORDER.map((key) => ({
      key,
      displayName: LABEL_DEFAULTS[key].displayName,
      color: LABEL_DEFAULTS[key].color,
      textColor: LABEL_DEFAULTS[key].textColor,
      enabled: LABEL_DEFAULTS[key].enabled,
    })),
  };
}

export function normalizeInboxTriageSettings(
  input?: Partial<InboxTriageSettings> | null
): InboxTriageSettings {
  const defaults = createDefaultInboxTriageSettings();
  if (!input) return defaults;

  const thresholdCandidate = Number(
    input.autoApplyConfidence ?? input.confidenceThreshold
  );
  const confidenceThreshold =
    Number.isFinite(thresholdCandidate) && thresholdCandidate >= 0 && thresholdCandidate <= 1
      ? thresholdCandidate
      : defaults.confidenceThreshold;

  const provided = Array.isArray(input.labels) ? input.labels : [];
  const byKey = new Map<InboxAILabel, Partial<InboxLabelSetting>>();
  for (const item of provided) {
    const key = normalizeLabel(String(item?.key || ""));
    if (!key) continue;
    byKey.set(key, item || {});
  }

  return {
    confidenceThreshold,
    autoApplyConfidence: confidenceThreshold,
    labels: LABEL_ORDER.map((key) => {
      const base = defaults.labels.find((entry) => entry.key === key)!;
      const patch = byKey.get(key);
      return {
        key,
        enabled: typeof patch?.enabled === "boolean" ? patch.enabled : base.enabled,
        displayName:
          typeof patch?.displayName === "string" && patch.displayName.trim()
            ? patch.displayName.trim()
            : base.displayName,
        color:
          typeof patch?.color === "string" && patch.color.trim() ? patch.color.trim() : base.color,
        textColor:
          typeof patch?.textColor === "string" && patch.textColor.trim()
            ? patch.textColor.trim()
            : base.textColor,
        confidenceThreshold:
          typeof patch?.confidenceThreshold === "number" ? patch.confidenceThreshold : undefined,
      };
    }),
  };
}

export function loadInboxTriageSettings(): InboxTriageSettings {
  if (typeof window === "undefined") return createDefaultInboxTriageSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultInboxTriageSettings();
    const parsed = JSON.parse(raw) as Partial<InboxTriageSettings>;
    return normalizeInboxTriageSettings(parsed);
  } catch {
    return createDefaultInboxTriageSettings();
  }
}

export function saveInboxTriageSettings(settings: InboxTriageSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeInboxTriageSettings(settings)));
  } catch {
    // ignore persistence failures in demo mode
  }
}

export function getInboxLabelSetting(
  settings: InboxTriageSettings | null | undefined,
  label: string
): InboxLabelSetting | undefined {
  const normalized = normalizeLabel(label);
  if (!normalized) return undefined;
  const source = settings ?? createDefaultInboxTriageSettings();
  return source.labels.find((entry) => entry.key === normalized);
}
